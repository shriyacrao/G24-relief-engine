import 'server-only';
import type { Pool } from 'mysql2/promise';
import { query } from '@/lib/db/mysql';
import { mongoDb } from '@/lib/db/mongo';
import { parseLatLong } from '@/lib/vector/pgvector';
import {
  pipelineActivity, PIPELINE_AGE_BANDS, PIPELINE_BY_DISASTER, PIPELINE_INJURIES, PIPELINE_NEEDS, casesNear, runIntakeAggregations,
} from './intake';
import type { SessionUser } from '@/lib/types';

/* ------------------------------ dashboard ------------------------------ */

export async function dashboard(db: Pool, user: SessionUser) {
  const isCoord = user.role === 'Relief Coordinator';
  const [shelters, openSos, lowStock, urgencyMix, mine] = await Promise.all([
    query(db, 'SELECT * FROM v_shelter_directory ORDER BY occupancy_pct DESC'),
    query(db, 'SELECT * FROM v_open_sos_priority ORDER BY priority_rank DESC, hours_waiting DESC LIMIT 8'),
    query(db, 'SELECT * FROM v_low_stock ORDER BY shortfall DESC'),
    query(db, `SELECT urgency_level, status, COUNT(*) AS n, SUM(people_count) AS people
                 FROM VICTIM_SOS WHERE status <> 'resolved'
                GROUP BY urgency_level, status`),
    query(db, `SELECT COUNT(*) AS reported, SUM(status = 'resolved') AS resolved, COALESCE(SUM(people_count),0) AS people
                 FROM VICTIM_SOS WHERE reported_by = ?`, [user.uid]),
  ]);

  let coord: Record<string, unknown> | null = null;
  if (isCoord) {
    const [kpi] = await query(db, `
      SELECT (SELECT COUNT(*) FROM SUPPLY_RESERVATION WHERE status = 'pending')              AS pending_reservations,
             (SELECT COUNT(*) FROM DISTRIBUTION_LOG   WHERE status = 'dispatched')           AS on_the_road,
             (SELECT COUNT(*) FROM LOGISTICS_VEHICLE  WHERE status = 'available')            AS vehicles_available,
             (SELECT COUNT(*) FROM STOCK_ALERT        WHERE is_resolved = FALSE)             AS open_alerts,
             (SELECT COUNT(*) FROM DISTRIBUTION_LOG   WHERE status = 'delivered'
                                                        AND dispatch_time >= NOW() - INTERVAL 1 DAY) AS delivered_24h`);
    const attention = await query(db, `
      SELECT 'LOW STOCK' AS alert_type, CONCAT(shelter, ' - ', item_name) AS detail FROM v_low_stock
      UNION ALL SELECT 'SHELTER FULL', name FROM SHELTER WHERE status = 'full'
      UNION ALL SELECT 'VEHICLE IN MAINTENANCE', registration_no FROM LOGISTICS_VEHICLE WHERE status = 'maintenance'`);
    coord = { kpi, attention };
  }

  let topNeeds: unknown[] = [];
  try {
    topNeeds = await (await mongoDb()).collection('intake_forms').aggregate(PIPELINE_NEEDS.concat([{ $limit: 6 }])).toArray();
  } catch { /* MongoDB down: dashboard still works from MySQL */ }

  return { shelters, openSos, lowStock, urgencyMix, mine: mine[0], coord, topNeeds };
}

/* --------------------------- shelters page --------------------------- */

export async function sheltersOverview(db: Pool) {
  const shelters = await query<Record<string, unknown> & { shelter_id: number; lat_long: string }>(db, 'SELECT * FROM v_shelter_directory ORDER BY name');
  const stock = await query<{ shelter_id: number; category: string; units: number; low_lines: number }>(db, `
    SELECT shelter_id, category, SUM(quantity_available) AS units,
           SUM(quantity_available <= reorder_threshold) AS low_lines
      FROM v_shelter_item_stock GROUP BY shelter_id, category`);
  const result = [];
  for (const s of shelters) {
    const ll = parseLatLong(s.lat_long);
    let nearby = null;
    if (ll) nearby = await casesNear(ll.lat, ll.lon, 5).catch(() => null); // MongoDB $geoNear
    result.push({ ...s, stock: stock.filter((x) => x.shelter_id === s.shelter_id), nearby });
  }
  return result;
}

/* --------------------------- analytics page --------------------------- */

/** Each report carries its SQL so the demo can show the query next to the result */
export const SQL_REPORTS: { id: string; title: string; concept: string; sql: string }[] = [
  {
    id: 'category_totals',
    title: 'Stock by category (categories holding 300+ units)',
    concept: 'JOIN + GROUP BY + HAVING + aggregate',
    sql: `SELECT r.category, COUNT(DISTINCT st.shelter_id) AS shelters_stocking,
       SUM(st.quantity_available) AS total_qty
  FROM STOCK st JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
 GROUP BY r.category
HAVING SUM(st.quantity_available) > 300
 ORDER BY total_qty DESC`,
  },
  {
    id: 'shelter_rank',
    title: 'Shelters ranked by free beds',
    concept: 'Window functions RANK() / SUM() OVER',
    sql: `SELECT name, capacity - current_occupancy AS free_beds,
       RANK() OVER (ORDER BY capacity - current_occupancy DESC) AS free_rank,
       SUM(current_occupancy) OVER () AS total_sheltered
  FROM SHELTER`,
  },
  {
    id: 'nearest_two',
    title: 'Two nearest shelters with room for every unmatched SOS',
    concept: 'CTE + ROW_NUMBER() + stored function (Haversine)',
    sql: `WITH open_sos AS (
  SELECT sos_id, urgency_level, people_count, lat_long
    FROM VICTIM_SOS WHERE status = 'unmatched'
), candidates AS (
  SELECT o.sos_id, o.urgency_level, s.name AS shelter,
         ROUND(fn_distance_km(o.lat_long, s.lat_long), 2) AS dist_km,
         fn_shelter_free_beds(s.shelter_id) AS free_beds,
         ROW_NUMBER() OVER (PARTITION BY o.sos_id
                            ORDER BY fn_distance_km(o.lat_long, s.lat_long)) AS rn
    FROM open_sos o
    JOIN SHELTER s ON s.status = 'active'
                  AND s.capacity - s.current_occupancy >= o.people_count
)
SELECT sos_id, urgency_level, shelter, dist_km, free_beds, rn AS choice_no
  FROM candidates WHERE rn <= 2
 ORDER BY fn_urgency_rank(urgency_level) DESC, sos_id, rn`,
  },
  {
    id: 'waiting',
    title: 'How long open SOS have been waiting',
    concept: 'Date functions + AVG / MAX + GROUP BY',
    sql: `SELECT urgency_level, COUNT(*) AS open_sos,
       ROUND(AVG(TIMESTAMPDIFF(HOUR, reported_at, NOW())), 1) AS avg_hours_waiting,
       MAX(TIMESTAMPDIFF(HOUR, reported_at, NOW())) AS max_hours_waiting
  FROM VICTIM_SOS WHERE status <> 'resolved'
 GROUP BY urgency_level
 ORDER BY fn_urgency_rank(urgency_level) DESC`,
  },
  {
    id: 'below_avg',
    title: 'Stock lines below the average for the same item',
    concept: 'Correlated subquery',
    sql: `SELECT sh.name AS shelter, r.item_name, st.quantity_available
  FROM STOCK st
  JOIN SHELTER sh ON sh.shelter_id = st.shelter_id
  JOIN RESOURCE_ITEM r ON r.item_id = st.item_id
 WHERE st.quantity_available <
       (SELECT AVG(s2.quantity_available) FROM STOCK s2 WHERE s2.item_id = st.item_id)
 ORDER BY r.item_name, st.quantity_available`,
  },
  {
    id: 'unsupplied',
    title: 'Open SOS with no supplies reserved yet',
    concept: 'NOT EXISTS subquery',
    sql: `SELECT v.sos_id, v.urgency_level, v.people_count, v.description
  FROM VICTIM_SOS v
 WHERE v.status <> 'resolved'
   AND NOT EXISTS (SELECT 1 FROM SUPPLY_RESERVATION sr WHERE sr.sos_id = v.sos_id)
 ORDER BY fn_urgency_rank(v.urgency_level) DESC`,
  },
  {
    id: 'vehicle_use',
    title: 'Vehicle utilisation',
    concept: 'LEFT JOIN + COUNT / SUM + COALESCE',
    sql: `SELECT lv.registration_no, lv.type, lv.status,
       COUNT(d.log_id) AS trips,
       COALESCE(SUM(d.quantity_dispatched), 0) AS units_moved
  FROM LOGISTICS_VEHICLE lv
  LEFT JOIN DISTRIBUTION_LOG d ON d.vehicle_id = lv.vehicle_id
 GROUP BY lv.vehicle_id, lv.registration_no, lv.type, lv.status
 ORDER BY trips DESC, lv.registration_no`,
  },
  {
    id: 'volunteers',
    title: 'Field activity per team member',
    concept: 'View v_volunteer_activity (LEFT JOIN + GROUP BY)',
    sql: `SELECT name, role, home_shelter, sos_reported, sos_resolved, people_reported, last_report_at
  FROM v_volunteer_activity
 ORDER BY sos_reported DESC, name`,
  },
];

export const MONGO_REPORTS = () => [
  { id: 'needs', title: 'Most requested needs', concept: '$match → $unwind → $group → $sort', pipeline: PIPELINE_NEEDS },
  { id: 'ageBands', title: 'People by age band', concept: '$unwind household → $bucket with $cond counters', pipeline: PIPELINE_AGE_BANDS },
  { id: 'injuries', title: 'Injury types reported', concept: 'double $unwind → $group', pipeline: PIPELINE_INJURIES },
  { id: 'byDisaster', title: 'Cases by disaster type (vulnerable people)', concept: '$project with $filter → $group with $avg', pipeline: PIPELINE_BY_DISASTER },
  { id: 'activity', title: 'Field activity, last 7 days (audit log)', concept: '$dateToString → $group → $addToSet', pipeline: pipelineActivity() },
];

export async function analytics(db: Pool) {
  const sql = await Promise.all(
    SQL_REPORTS.map(async (r) => ({ ...r, rows: await query(db, r.sql) })),
  );
  let mongo: Record<string, unknown[]> = {};
  let mongoError: string | null = null;
  try {
    mongo = await runIntakeAggregations();
  } catch (e) {
    mongoError = (e as Error).message;
  }
  return {
    sql,
    mongo: MONGO_REPORTS().map((r) => ({ id: r.id, title: r.title, concept: r.concept, pipeline: JSON.stringify(r.pipeline, null, 2), rows: mongo[r.id] ?? [] })),
    mongoError,
  };
}
