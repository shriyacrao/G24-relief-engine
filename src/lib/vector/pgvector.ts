import 'server-only';
import { Pool } from 'pg';

/**
 * Vector database: PostgreSQL + pgvector (database `relief_vectors`).
 *   sos_embeddings  - one row per SOS   (sos_id  = MySQL VICTIM_SOS.sos_id)
 *   item_embeddings - one row per item  (item_id = MySQL RESOURCE_ITEM.item_id)
 * 384-d vectors, HNSW index with vector_cosine_ops, cosine distance `<=>`.
 * Search logic lives in SQL functions (database/vector/pgvector_setup.sql);
 * this module only calls them. Credentials come from environment variables.
 */
const g = globalThis as unknown as { __reliefPg?: Pool };

export function pg(): Pool {
  if (!g.__reliefPg) {
    if (!process.env.PG_PASSWORD) throw new Error('Missing environment variable PG_PASSWORD (see .env.example)');
    g.__reliefPg = new Pool({
      host: process.env.PG_HOST ?? '127.0.0.1',
      port: Number(process.env.PG_PORT ?? 5432),
      database: process.env.PG_DATABASE ?? 'relief_vectors',
      user: process.env.PG_USER ?? 'relief_vector_app',
      password: process.env.PG_PASSWORD,
      max: 6,
      connectionTimeoutMillis: 4000,
    });
  }
  return g.__reliefPg;
}

/** pgvector text format: '[0.1,0.2,...]' */
export const toVector = (v: number[]) => `[${v.join(',')}]`;

export function parseLatLong(ll?: string | null): { lat: number; lon: number } | null {
  if (!ll) return null;
  const [a, b] = ll.split(',').map((x) => Number(x.trim()));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lon: b };
}

export interface SosVectorRow {
  sos_id: number;
  urgency: string;
  status: string;
  people_count: number;
  reported_at: Date;
  lat?: number | null;
  lon?: number | null;
  disaster_type?: string | null;
  source_text: string;
}

export async function upsertSosVector(vector: number[], r: SosVectorRow): Promise<void> {
  await pg().query(
    `INSERT INTO sos_embeddings (sos_id, embedding, urgency, status, people_count, reported_at, lat, lon, disaster_type, source_text)
     VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (sos_id) DO UPDATE SET
       embedding = EXCLUDED.embedding, urgency = EXCLUDED.urgency, status = EXCLUDED.status,
       people_count = EXCLUDED.people_count, reported_at = EXCLUDED.reported_at, lat = EXCLUDED.lat,
       lon = EXCLUDED.lon, disaster_type = EXCLUDED.disaster_type, source_text = EXCLUDED.source_text,
       embedded_at = now()`,
    [r.sos_id, toVector(vector), r.urgency, r.status, r.people_count, r.reported_at, r.lat ?? null, r.lon ?? null, r.disaster_type ?? null, r.source_text],
  );
}

/** Mirror MySQL status / urgency changes so vector filters stay correct */
export async function setSosVectorMeta(sosId: number, patch: { status?: string; urgency?: string }): Promise<void> {
  try {
    await pg().query(
      `UPDATE sos_embeddings SET status = COALESCE($2, status), urgency = COALESCE($3, urgency) WHERE sos_id = $1`,
      [sosId, patch.status ?? null, patch.urgency ?? null],
    );
  } catch (e) {
    console.warn('[pgvector] metadata sync skipped:', (e as Error).message);
  }
}

export async function deleteSosVector(sosId: number): Promise<void> {
  try {
    await pg().query('DELETE FROM sos_embeddings WHERE sos_id = $1', [sosId]);
  } catch (e) {
    console.warn('[pgvector] delete skipped:', (e as Error).message);
  }
}

export async function upsertItemVector(vector: number[], item: { item_id: number; item_name: string; category: string; unit: string }, sourceText: string) {
  await pg().query(
    `INSERT INTO item_embeddings (item_id, embedding, item_name, category, unit, source_text)
     VALUES ($1, $2::vector, $3, $4, $5, $6)
     ON CONFLICT (item_id) DO UPDATE SET embedding = EXCLUDED.embedding, item_name = EXCLUDED.item_name,
       category = EXCLUDED.category, unit = EXCLUDED.unit, source_text = EXCLUDED.source_text, embedded_at = now()`,
    [item.item_id, toVector(vector), item.item_name, item.category, item.unit, sourceText],
  );
}

/* ----------------------------- searches ----------------------------- */

export async function searchSos(vector: number[], k: number, status: string | null, minSim: number) {
  const { rows } = await pg().query<{ sos_id: number; similarity: number }>(
    'SELECT * FROM search_sos($1::vector, $2, $3, $4)', [toVector(vector), k, status, minSim]);
  return rows;
}

export async function findDuplicateSos(vector: number[], lat: number, lon: number, radiusKm = 3, hours = 72, minSim = 0.55, k = 3) {
  const { rows } = await pg().query<{
    sos_id: number; similarity: number; distance_km: number; urgency: string; status: string; people_count: number; source_text: string;
  }>('SELECT * FROM find_duplicate_sos($1::vector, $2, $3, $4, $5, $6, $7)', [toVector(vector), lat, lon, radiusKm, hours, minSim, k]);
  return rows;
}

export async function similarSos(sosId: number, k = 4, minSim = 0.3) {
  const { rows } = await pg().query<{
    sos_id: number; similarity: number; urgency: string; status: string; people_count: number; source_text: string;
  }>('SELECT * FROM similar_sos($1, $2, $3)', [sosId, k, minSim]);
  return rows;
}

export async function recommendItems(vectors: number[][], labels: string[], perQuery = 3, minFirst = 0.2, minRest = 0.35, k = 5) {
  const { rows } = await pg().query<{
    item_id: number; item_name: string; category: string; unit: string; similarity: number; matched_on: string;
  }>(
    'SELECT * FROM recommend_items($1::text[]::vector[], $2::text[], $3, $4, $5, $6)',
    [vectors.map(toVector), labels, perQuery, minFirst, minRest, k],
  );
  return rows;
}
