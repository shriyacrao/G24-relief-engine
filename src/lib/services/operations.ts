import 'server-only';
import type { Pool } from 'mysql2/promise';
import { callWithOut, query } from '@/lib/db/mysql';
import { HttpError } from '@/lib/api';
import { embed, itemEmbeddingText } from '@/lib/vector/embed';
import { upsertItemVector } from '@/lib/vector/pgvector';
import { addTimelineNote } from './intake';
import { logActivity } from './activity';
import type { SessionUser } from '@/lib/types';

/* ============================ INVENTORY ============================ */

export async function listStock(db: Pool, filters: { shelter?: number; category?: string; health?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.shelter) { where.push('shelter_id = ?'); params.push(filters.shelter); }
  if (filters.category && filters.category !== 'all') { where.push('category = ?'); params.push(filters.category); }
  const rows = await query<Record<string, unknown> & { health: string }>(
    db,
    `SELECT *,
            CASE WHEN quantity_available = 0 THEN 'OUT'
                 WHEN quantity_available <= reorder_threshold THEN 'LOW'
                 WHEN quantity_available <= reorder_threshold * 2 THEN 'WATCH'
                 ELSE 'OK' END AS health
       FROM v_shelter_item_stock
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY shelter_name, category, item_name`,
    params,
  );
  return filters.health && filters.health !== 'all' ? rows.filter((r) => r.health === filters.health) : rows;
}

export async function listAlerts(db: Pool) {
  return query(
    db,
    `SELECT a.alert_id, a.stock_id, a.quantity_at_alert, a.reorder_threshold, a.alert_time, a.is_resolved,
            s.shelter_name, s.item_name, s.unit, s.quantity_available AS quantity_now
       FROM STOCK_ALERT a
       JOIN v_shelter_item_stock s ON s.stock_id = a.stock_id
      ORDER BY a.is_resolved, a.alert_time DESC
      LIMIT 50`,
  );
}

export async function purgeResolvedAlerts(db: Pool, user: SessionUser) {
  const [res] = await db.query('DELETE FROM STOCK_ALERT WHERE is_resolved = TRUE');
  await logActivity(user, 'alert.purge', 'STOCK_ALERT', null, { deleted: (res as { affectedRows: number }).affectedRows });
  return { deleted: (res as { affectedRows: number }).affectedRows };
}

export async function restock(db: Pool, user: SessionUser, itemId: number, shelterId: number, qty: number) {
  await db.query('CALL sp_restock(?, ?, ?)', [itemId, shelterId, qty]);
  await logActivity(user, 'stock.restock', 'STOCK', `${itemId}@${shelterId}`, { qty });
  return { ok: true };
}

export async function transfer(db: Pool, user: SessionUser, itemId: number, from: number, to: number, qty: number) {
  await db.query('CALL sp_transfer_stock(?, ?, ?, ?)', [itemId, from, to, qty]);
  await logActivity(user, 'stock.transfer', 'STOCK', itemId, { from, to, qty });
  return { ok: true };
}

export async function updateThreshold(db: Pool, user: SessionUser, stockId: number, threshold: number) {
  const [res] = await db.query('UPDATE STOCK SET reorder_threshold = ? WHERE stock_id = ?', [threshold, stockId]);
  if ((res as { affectedRows: number }).affectedRows === 0) throw new HttpError(404, 'Stock line not found');
  await logActivity(user, 'stock.threshold', 'STOCK', stockId, { threshold });
  return { ok: true };
}

export async function listItems(db: Pool) {
  return query(db, 'SELECT item_id, item_name, category, unit, usage_notes FROM RESOURCE_ITEM ORDER BY category, item_name');
}

/** New catalogue item: MySQL row + its embedding in pgvector (item_embeddings) */
export async function createItem(db: Pool, user: SessionUser, item: { item_name: string; category: string; unit: string; usage_notes: string }) {
  const [res] = await db.query('INSERT INTO RESOURCE_ITEM (item_name, category, unit, usage_notes) VALUES (?, ?, ?, ?)', [
    item.item_name, item.category, item.unit, item.usage_notes,
  ]);
  const itemId = (res as { insertId: number }).insertId;
  let vectorIndexed = true;
  try {
    const text = itemEmbeddingText(item);
    await upsertItemVector(await embed(text), { item_id: itemId, item_name: item.item_name, category: item.category, unit: item.unit }, text);
  } catch (e) {
    vectorIndexed = false;
    console.warn('[items] vector indexing skipped:', (e as Error).message);
  }
  await logActivity(user, 'item.create', 'RESOURCE_ITEM', itemId, item);
  return { item_id: itemId, vector_indexed: vectorIndexed };
}

/* ======================== RESERVATIONS / DISPATCH ======================= */

export async function reserve(db: Pool, user: SessionUser, sosId: number, itemId: number, shelterId: number, qty: number) {
  // sp_reserve_supply: transaction; trg_reservation_bi locks the STOCK row and
  // rejects over-reservation, trg_reservation_ai deducts the stock
  const out = await callWithOut(db, 'sp_reserve_supply', [sosId, itemId, shelterId, qty], ['reservation_id']);
  const reservationId = Number(out.reservation_id);
  await addTimelineNote(sosId, user, `Reserved ${qty} of item #${itemId} at shelter #${shelterId} (reservation #${reservationId})`).catch(() => false);
  await logActivity(user, 'reservation.create', 'SUPPLY_RESERVATION', reservationId, { sosId, itemId, shelterId, qty });
  return { reservation_id: reservationId };
}

export async function cancelReservation(db: Pool, user: SessionUser, reservationId: number) {
  await db.query('CALL sp_cancel_reservation(?)', [reservationId]);
  await logActivity(user, 'reservation.cancel', 'SUPPLY_RESERVATION', reservationId);
  return { ok: true };
}

export async function dispatchBoard(db: Pool) {
  const [open, active, recent, vehicles] = await Promise.all([
    query(db, `SELECT *, quantity_reserved - quantity_dispatched AS remaining
                 FROM v_reservation_detail
                WHERE status IN ('pending','committed') AND quantity_reserved > quantity_dispatched
                ORDER BY priority_rank DESC, created_at ASC`),
    query(db, `SELECT * FROM v_dispatch_overview WHERE dispatch_status = 'dispatched' ORDER BY dispatch_time`),
    query(db, `SELECT * FROM v_dispatch_overview WHERE dispatch_status <> 'dispatched' ORDER BY dispatch_time DESC LIMIT 15`),
    query(db, `SELECT lv.*, COUNT(d.log_id) AS trips, COALESCE(SUM(d.quantity_dispatched),0) AS units_moved
                 FROM LOGISTICS_VEHICLE lv
                 LEFT JOIN DISTRIBUTION_LOG d ON d.vehicle_id = lv.vehicle_id
                GROUP BY lv.vehicle_id ORDER BY lv.status, lv.registration_no`),
  ]);
  return { open, active, recent, vehicles };
}

export async function approveDispatch(db: Pool, user: SessionUser, reservationId: number, vehicleId: number | null, qty: number) {
  // trg_distribution_bi checks: reservation open, qty <= remaining, vehicle available, approver is a coordinator
  const out = await callWithOut(db, 'sp_approve_dispatch', [reservationId, vehicleId, user.uid, qty], ['log_id']);
  const logId = Number(out.log_id);
  await logActivity(user, 'dispatch.approve', 'DISTRIBUTION_LOG', logId, { reservationId, vehicleId, qty });
  return { log_id: logId };
}

export async function completeDelivery(db: Pool, user: SessionUser, logId: number) {
  await db.query('CALL sp_complete_delivery(?)', [logId]);
  await logActivity(user, 'dispatch.deliver', 'DISTRIBUTION_LOG', logId);
  return { ok: true };
}

export async function cancelDispatch(db: Pool, user: SessionUser, logId: number) {
  const [res] = await db.query(`UPDATE DISTRIBUTION_LOG SET status = 'cancelled' WHERE log_id = ? AND status = 'dispatched'`, [logId]);
  if ((res as { affectedRows: number }).affectedRows === 0) throw new HttpError(409, 'Only a dispatch that is still on the road can be cancelled');
  await logActivity(user, 'dispatch.cancel', 'DISTRIBUTION_LOG', logId);
  return { ok: true };
}

export async function setVehicleStatus(db: Pool, user: SessionUser, vehicleId: number, status: 'available' | 'maintenance') {
  const rows = await query<{ status: string }>(db, 'SELECT status FROM LOGISTICS_VEHICLE WHERE vehicle_id = ?', [vehicleId]);
  if (!rows[0]) throw new HttpError(404, 'Vehicle not found');
  if (rows[0].status === 'in_transit') {
    const active = await query<{ n: number }>(db, `SELECT COUNT(*) AS n FROM DISTRIBUTION_LOG WHERE vehicle_id = ? AND status = 'dispatched'`, [vehicleId]);
    if (active[0].n > 0) throw new HttpError(409, 'Vehicle is on an active dispatch; deliver or cancel it first');
  }
  await db.query('UPDATE LOGISTICS_VEHICLE SET status = ? WHERE vehicle_id = ?', [status, vehicleId]);
  await logActivity(user, 'vehicle.status', 'LOGISTICS_VEHICLE', vehicleId, { status });
  return { ok: true };
}

export async function addVehicle(db: Pool, user: SessionUser, v: { registration_no: string; type: string; capacity_kg: number }) {
  const [res] = await db.query('INSERT INTO LOGISTICS_VEHICLE (registration_no, type, capacity_kg) VALUES (?, ?, ?)', [
    v.registration_no.toUpperCase(), v.type, v.capacity_kg,
  ]);
  const id = (res as { insertId: number }).insertId;
  await logActivity(user, 'vehicle.create', 'LOGISTICS_VEHICLE', id, v);
  return { vehicle_id: id };
}
