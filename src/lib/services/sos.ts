import 'server-only';
import type { Pool } from 'mysql2/promise';
import { callResultSet, callWithOut, query } from '@/lib/db/mysql';
import { HttpError } from '@/lib/api';
import { embed, sosEmbeddingText } from '@/lib/vector/embed';
import {
  deleteSosVector, findDuplicateSos, parseLatLong, recommendItems, searchSos, setSosVectorMeta, similarSos, upsertSosVector,
} from '@/lib/vector/pgvector';
import {
  INTAKE_REF_PREFIX, addTimelineNote, createDraftIntake, deleteIntakeById, deleteIntakeForSos, getIntakeForSos, linkIntake,
} from './intake';
import { logActivity } from './activity';
import type { DisasterType, HouseholdMember, SessionUser, Urgency } from '@/lib/types';

export interface SosRow {
  sos_id: number;
  urgency_level: Urgency;
  status: 'unmatched' | 'matched' | 'resolved';
  reported_at: string;
  intake_doc_ref: string | null;
  description: string;
  people_count: number;
  lat_long: string | null;
  reported_by: number;
  reporter_name?: string | null;
  matched_shelter_id: number | null;
  shelter_name: string | null;
  hours_waiting: number;
  priority_rank: number;
}

const SOS_SELECT = (withReporter: boolean) => `
  SELECT v.sos_id, v.urgency_level, v.status, v.reported_at, v.intake_doc_ref, v.description,
         v.people_count, v.lat_long, v.reported_by, v.matched_shelter_id,
         d.name AS shelter_name,
         TIMESTAMPDIFF(HOUR, v.reported_at, NOW()) AS hours_waiting,
         fn_urgency_rank(v.urgency_level) AS priority_rank
         ${withReporter ? ', u.name AS reporter_name' : ''}
    FROM VICTIM_SOS v
    LEFT JOIN v_shelter_directory d ON d.shelter_id = v.matched_shelter_id
    ${withReporter ? 'LEFT JOIN APP_USER u ON u.user_id = v.reported_by' : ''}`;

export interface SosFilters {
  status?: string;
  urgency?: string;
  mine?: boolean;
  q?: string; // MySQL FULLTEXT search on description
}

export async function listSos(db: Pool, user: SessionUser, f: SosFilters) {
  const isCoord = user.role === 'Relief Coordinator';
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status && f.status !== 'all') {
    if (f.status === 'open') where.push(`v.status <> 'resolved'`);
    else { where.push('v.status = ?'); params.push(f.status); }
  }
  if (f.urgency && f.urgency !== 'all') { where.push('v.urgency_level = ?'); params.push(f.urgency); }
  if (f.mine) { where.push('v.reported_by = ?'); params.push(user.uid); }
  let relevance = '';
  if (f.q && f.q.trim()) {
    where.push('MATCH(v.description) AGAINST (? IN NATURAL LANGUAGE MODE)');
    params.push(f.q.trim());
  }
  if (f.q && f.q.trim()) relevance = 'MATCH(v.description) AGAINST (? IN NATURAL LANGUAGE MODE) DESC, ';
  const sql = `${SOS_SELECT(isCoord)}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${relevance}(v.status = 'resolved'), fn_urgency_rank(v.urgency_level) DESC, v.reported_at ASC
    LIMIT 200`;
  if (relevance) params.push(f.q!.trim());
  return query<SosRow>(db, sql, params);
}

export async function getSos(db: Pool, user: SessionUser, sosId: number) {
  const rows = await query<SosRow>(db, `${SOS_SELECT(user.role === 'Relief Coordinator')} WHERE v.sos_id = ?`, [sosId]);
  if (!rows[0]) throw new HttpError(404, `SOS #${sosId} not found`);
  return rows[0];
}

export async function getSosDetail(db: Pool, user: SessionUser, sosId: number) {
  const sos = await getSos(db, user, sosId);
  const [intake, reservations, dispatches] = await Promise.all([
    getIntakeForSos(sosId).catch(() => null),
    query(db, `SELECT * FROM v_reservation_detail WHERE sos_id = ? ORDER BY reservation_id`, [sosId]),
    user.role === 'Relief Coordinator'
      ? query(db, `SELECT * FROM v_dispatch_overview WHERE sos_id = ? ORDER BY dispatch_time DESC`, [sosId])
      : Promise.resolve([]),
  ]);
  return { sos, intake, reservations, dispatches };
}

/* --------------------------- registration --------------------------- */

export interface RegisterSosInput {
  urgency: Urgency;
  description: string;
  people_count: number;
  lat: number;
  lon: number;
  address_text?: string;
  disaster_type: DisasterType;
  needs: string[];
  household: HouseholdMember[];
  details?: Record<string, unknown>;
  auto_match?: boolean;
}

/**
 * Cross-database write (saga with compensation):
 *   1. MongoDB  : insert intake form as a draft
 *   2. MySQL    : CALL sp_register_sos(...)  (system of record; validation by CHECKs)
 *                 -> on failure the Mongo draft is deleted again
 *   3. MongoDB  : link the draft to the new sos_id
 *   4. pgvector : embed the description and upsert the row (best-effort;
 *                 `npm run seed:vectors` re-indexes anything missed)
 */
export async function registerSos(db: Pool, user: SessionUser, input: RegisterSosInput) {
  const latLong = `${input.lat.toFixed(6)},${input.lon.toFixed(6)}`;

  const intakeId = await createDraftIntake(
    {
      disaster_type: input.disaster_type,
      location: { type: 'Point', coordinates: [input.lon, input.lat] },
      address_text: input.address_text,
      reporter: { user_id: user.uid, name: user.name },
      household: input.household,
      needs: input.needs,
      details: input.details ?? {},
    },
    user,
  );

  let sosId: number;
  try {
    const out = await callWithOut(
      db,
      'sp_register_sos',
      [user.uid, input.urgency, input.description, input.people_count, latLong, `${INTAKE_REF_PREFIX}${intakeId.toHexString()}`],
      ['sos_id'],
    );
    sosId = Number(out.sos_id);
    if (!sosId) throw new Error('sp_register_sos returned no id');
  } catch (e) {
    await deleteIntakeById(intakeId).catch(() => undefined); // compensate
    throw e;
  }
  await linkIntake(intakeId, sosId);

  let vectorIndexed = true;
  try {
    const vector = await embed(sosEmbeddingText(input.description, input.needs, input.disaster_type));
    await upsertSosVector(vector, {
      sos_id: sosId,
      urgency: input.urgency,
      status: 'unmatched',
      people_count: input.people_count,
      reported_at: new Date(),
      lat: input.lat,
      lon: input.lon,
      disaster_type: input.disaster_type,
      source_text: input.description,
    });
  } catch (e) {
    vectorIndexed = false;
    console.warn('[sos] vector indexing skipped:', (e as Error).message);
  }

  await logActivity(user, 'sos.register', 'VICTIM_SOS', sosId, { urgency: input.urgency, people: input.people_count, vectorIndexed });

  let match: { shelter_name: string | null; error?: string } | null = null;
  if (input.auto_match) {
    try {
      const m = await matchSos(db, user, sosId);
      match = { shelter_name: m.shelter_name };
    } catch (e) {
      match = { shelter_name: null, error: (e as { sqlMessage?: string; message: string }).sqlMessage ?? (e as Error).message };
    }
  }
  return { sos_id: sosId, intake_id: intakeId.toHexString(), vector_indexed: vectorIndexed, match };
}

/* ------------------------------ actions ----------------------------- */

export async function matchSos(db: Pool, user: SessionUser, sosId: number) {
  await db.query('CALL sp_match_sos(?)', [sosId]); // transaction + row locks inside the procedure
  const sos = await getSos(db, user, sosId);
  await setSosVectorMeta(sosId, { status: 'matched' });
  await addTimelineNote(sosId, user, `Matched to shelter: ${sos.shelter_name}`).catch(() => false);
  await logActivity(user, 'sos.match', 'VICTIM_SOS', sosId, { shelter_id: sos.matched_shelter_id });
  return sos;
}

export async function resolveSos(db: Pool, user: SessionUser, sosId: number) {
  await db.query('CALL sp_resolve_sos(?)', [sosId]);
  await setSosVectorMeta(sosId, { status: 'resolved' });
  await addTimelineNote(sosId, user, 'SOS resolved - occupants discharged, pending reservations released').catch(() => false);
  await logActivity(user, 'sos.resolve', 'VICTIM_SOS', sosId);
  return getSos(db, user, sosId);
}

export async function deleteSos(db: Pool, user: SessionUser, sosId: number) {
  const [res] = await db.query('DELETE FROM VICTIM_SOS WHERE sos_id = ?', [sosId]); // trg_sos_bd guards active reservations
  if ((res as { affectedRows: number }).affectedRows === 0) throw new HttpError(404, `SOS #${sosId} not found`);
  await Promise.all([deleteIntakeForSos(sosId).catch(() => undefined), deleteSosVector(sosId)]);
  await logActivity(user, 'sos.delete', 'VICTIM_SOS', sosId);
  return { deleted: sosId };
}

export async function autoMatchAll(db: Pool, user: SessionUser) {
  const out = await callWithOut(db, 'sp_auto_match_unmatched', [], ['matched', 'failed']);
  const rows = await query<{ sos_id: number; status: string; urgency_level: string }>(db, 'SELECT sos_id, status, urgency_level FROM VICTIM_SOS');
  await Promise.all(rows.map((r) => setSosVectorMeta(r.sos_id, { status: r.status, urgency: r.urgency_level })));
  await logActivity(user, 'sos.auto_match', 'VICTIM_SOS', null, out);
  return { matched: Number(out.matched), failed: Number(out.failed) };
}

/** Escalate unmatched SOS waiting longer than N hours by one urgency level */
export async function escalateStale(db: Pool, user: SessionUser, hours: number) {
  const before = await query<{ sos_id: number }>(
    db,
    `SELECT sos_id FROM VICTIM_SOS WHERE status = 'unmatched' AND urgency_level <> 'critical'
       AND TIMESTAMPDIFF(HOUR, reported_at, NOW()) >= ?`,
    [hours],
  );
  const [res] = await db.query(
    `UPDATE VICTIM_SOS
        SET urgency_level = CASE urgency_level
                              WHEN 'low' THEN 'medium' WHEN 'medium' THEN 'high'
                              WHEN 'high' THEN 'critical' ELSE urgency_level END
      WHERE status = 'unmatched' AND TIMESTAMPDIFF(HOUR, reported_at, NOW()) >= ?`,
    [hours],
  );
  if (before.length) {
    const rows = await query<{ sos_id: number; urgency_level: string }>(
      db, `SELECT sos_id, urgency_level FROM VICTIM_SOS WHERE sos_id IN (${before.map(() => '?').join(',')})`, before.map((b) => b.sos_id));
    await Promise.all(rows.map((r) => setSosVectorMeta(r.sos_id, { urgency: r.urgency_level })));
  }
  await logActivity(user, 'sos.escalate', 'VICTIM_SOS', null, { hours, changed: (res as { changedRows: number }).changedRows });
  return { escalated: (res as { changedRows: number }).changedRows, sos_ids: before.map((b) => b.sos_id) };
}

/* -------------------------- vector features ------------------------- */

/**
 * Duplicate detection before a new SOS is filed (one SQL function in pgvector):
 * cosine similarity >= 0.55 AND within 3 km (Haversine) AND last 72 h AND still open.
 */
export async function findPossibleDuplicates(input: { description: string; needs?: string[]; disaster_type?: string; lat: number; lon: number }) {
  const vector = await embed(sosEmbeddingText(input.description, input.needs, input.disaster_type));
  const rows = await findDuplicateSos(vector, input.lat, input.lon, 3, 72, 0.55, 3);
  return rows.map((r) => ({
    sos_id: r.sos_id, score: Number(r.similarity.toFixed(3)), distance_km: Number(r.distance_km.toFixed(2)),
    urgency: r.urgency, status: r.status, people_count: r.people_count, text: r.source_text,
  }));
}

/** "Similar past cases": neighbours of the SOS's own stored vector, excluding itself */
export async function similarCases(sos: SosRow, limit = 4) {
  const rows = await similarSos(sos.sos_id, limit, 0.3);
  return rows.map((r) => ({
    sos_id: r.sos_id, score: Number(r.similarity.toFixed(3)), urgency: r.urgency, status: r.status, people_count: r.people_count, text: r.source_text,
  }));
}

const PER_PERSON: Record<string, number> = { litre: 6, kg: 1.5, piece: 1, strip: 1, pack: 3 };
function suggestQty(unit: string, people: number) {
  if (unit === 'kit') return Math.max(1, Math.ceil(people / 4));
  return Math.max(1, Math.ceil((PER_PERSON[unit] ?? 1) * people));
}

/**
 * Hybrid recommendation (vector DB + SQL):
 *   1. pgvector : which relief items are semantically relevant to this SOS?
 *                 Multi-query retrieval - the description, every stated need and
 *                 every medical need / injury from the MongoDB intake form are
 *                 embedded separately and sent in ONE call to recommend_items(),
 *                 which runs a LATERAL kNN per query vector and keeps each item's
 *                 best score (max-fusion). A long description no longer hides a
 *                 short but important need such as "baby food".
 *   2. MySQL    : CALL sp_nearest_stock(item, sos location) - which shelters
 *                 actually hold that item, nearest first?
 */
export async function recommendSupplies(db: Pool, sos: SosRow, intake?: { needs?: string[]; household?: HouseholdMember[] } | null) {
  const extra = new Set<string>();
  for (const n of intake?.needs ?? []) extra.add(n.toLowerCase());
  for (const m of intake?.household ?? []) {
    for (const x of [...(m.medical_needs ?? []), ...(m.injuries ?? [])]) extra.add(x.toLowerCase());
  }
  const queries = [sos.description, ...Array.from(extra).slice(0, 12)];
  const labels = ['description', ...queries.slice(1)];
  const vectors = await Promise.all(queries.map((q) => embed(q)));
  const items = await recommendItems(vectors, labels, 3, 0.2, 0.35, 5);
  const out = [];
  for (const it of items) {
    const shelters = await callResultSet<{ shelter_id: number; shelter_name: string; quantity_available: number; distance_km: number | null }>(
      db, 'sp_nearest_stock', [it.item_id, sos.lat_long, 1, 3]);
    out.push({
      item_id: it.item_id, item_name: it.item_name, category: it.category, unit: it.unit,
      relevance: Number(it.similarity.toFixed(3)), matched_on: it.matched_on,
      suggested_qty: suggestQty(it.unit, sos.people_count), shelters,
    });
  }
  return out;
}

/** Semantic search over all SOS reports; SQL rows are re-read so data is current */
export async function semanticSearch(db: Pool, user: SessionUser, q: string, status?: string) {
  const vector = await embed(q);
  const hits = await searchSos(vector, 10, status ?? 'all', 0.18);
  if (!hits.length) return [];
  const ids = hits.map((h) => h.sos_id);
  const rows = await query<SosRow>(
    db, `${SOS_SELECT(user.role === 'Relief Coordinator')} WHERE v.sos_id IN (${ids.map(() => '?').join(',')})`, ids);
  const byId = new Map(rows.map((r) => [r.sos_id, r]));
  return hits
    .filter((h) => byId.has(h.sos_id))
    .map((h) => ({ ...byId.get(h.sos_id)!, score: Number(h.similarity.toFixed(3)) }));
}

export async function fulltextSearch(db: Pool, user: SessionUser, q: string, status?: string) {
  const params: unknown[] = [q, q];
  let extra = '';
  if (status === 'open') extra = ` AND v.status <> 'resolved'`;
  else if (status && status !== 'all') { extra = ' AND v.status = ?'; params.push(status); }
  const sql = `SELECT * FROM (
      ${SOS_SELECT(user.role === 'Relief Coordinator').replace('SELECT v.sos_id', 'SELECT MATCH(v.description) AGAINST (? IN NATURAL LANGUAGE MODE) AS score, v.sos_id')}
      WHERE MATCH(v.description) AGAINST (? IN NATURAL LANGUAGE MODE) ${extra}
    ) t ORDER BY score DESC LIMIT 10`;
  return query<SosRow & { score: number }>(db, sql, params);
}

export { parseLatLong };
