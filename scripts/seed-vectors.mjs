// (Re)builds the pgvector tables from MySQL (+ intake needs from MongoDB).
// Safe to run any time: primary keys are the SQL ids, so it upserts.
//   node scripts/seed-vectors.mjs            -> upsert everything
//   node scripts/seed-vectors.mjs --recreate -> empty both tables first
import { pathToFileURL } from 'node:url';
import { coordinatorPool, embed, mongo, parseLatLong, pgPool, sosText, toVector } from './lib.mjs';

export async function seedVectors({ recreate = process.argv.includes('--recreate') } = {}) {
  const pool = coordinatorPool();
  const pg = pgPool();
  let client;
  try {
    const { rows: ext } = await pg.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    if (!ext.length) throw new Error('pgvector extension missing - run database/vector/pgvector_setup.sql first');
    console.log(`  pgvector ${ext[0].extversion} ready`);
    if (recreate) {
      await pg.query('DELETE FROM sos_embeddings');
      await pg.query('DELETE FROM item_embeddings');
      console.log('  tables emptied (--recreate)');
    }

    const [items] = await pool.query('SELECT item_id, item_name, category, unit, usage_notes FROM RESOURCE_ITEM');
    for (const it of items) {
      const text = `${it.item_name} (${it.category}). ${it.usage_notes ?? ''}`.trim();
      await pg.query(
        `INSERT INTO item_embeddings (item_id, embedding, item_name, category, unit, source_text)
         VALUES ($1, $2::vector, $3, $4, $5, $6)
         ON CONFLICT (item_id) DO UPDATE SET embedding = EXCLUDED.embedding, item_name = EXCLUDED.item_name,
           category = EXCLUDED.category, unit = EXCLUDED.unit, source_text = EXCLUDED.source_text, embedded_at = now()`,
        [it.item_id, toVector(await embed(text)), it.item_name, it.category, it.unit, text]);
    }
    console.log(`  item_embeddings: ${items.length} rows`);

    let intakeBySos = new Map();
    try {
      const m = await mongo();
      client = m.client;
      const docs = await m.db.collection('intake_forms').find({ status: 'linked' }, { projection: { sos_id: 1, needs: 1, disaster_type: 1 } }).toArray();
      intakeBySos = new Map(docs.map((d) => [d.sos_id, d]));
    } catch (e) {
      console.warn('  MongoDB unavailable, embedding descriptions only:', e.message);
    }

    const [sos] = await pool.query('SELECT sos_id, urgency_level, status, people_count, reported_at, lat_long, description FROM VICTIM_SOS');
    let n = 0;
    for (const s of sos) {
      if (!s.description) continue;
      const doc = intakeBySos.get(s.sos_id);
      const loc = parseLatLong(s.lat_long);
      await pg.query(
        `INSERT INTO sos_embeddings (sos_id, embedding, urgency, status, people_count, reported_at, lat, lon, disaster_type, source_text)
         VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (sos_id) DO UPDATE SET embedding = EXCLUDED.embedding, urgency = EXCLUDED.urgency, status = EXCLUDED.status,
           people_count = EXCLUDED.people_count, reported_at = EXCLUDED.reported_at, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
           disaster_type = EXCLUDED.disaster_type, source_text = EXCLUDED.source_text, embedded_at = now()`,
        [s.sos_id, toVector(await embed(sosText(s.description, doc?.needs ?? [], doc?.disaster_type))), s.urgency_level, s.status,
          s.people_count, new Date(s.reported_at), loc?.lat ?? null, loc?.lon ?? null, doc?.disaster_type ?? null, s.description]);
      n++;
    }
    // remove vectors whose SOS no longer exists in MySQL
    const ids = sos.map((s) => s.sos_id);
    const { rowCount } = await pg.query('DELETE FROM sos_embeddings WHERE NOT (sos_id = ANY($1::int[]))', [ids]);
    console.log(`  sos_embeddings: ${n} rows${rowCount ? `, ${rowCount} orphan(s) removed` : ''}`);
  } finally {
    await pool.end();
    await pg.end();
    if (client) await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('[seed:vectors]');
  seedVectors().catch((e) => { console.error(e.message); process.exit(1); });
}
