// Integration tests - run against a live stack:
//   npm run build && npm start      (in one terminal)
//   npm test                        (in another)
// Uses the seeded sample data. Every test that changes data cleans up after itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { coordinatorPool, mongo, intakeValidator, pgPool } from '../scripts/lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Relief@123';
let coordCookie, volCookie, pool, m, vec;

async function call(path, { cookie, method, body } = {}) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}
async function login(email) {
  const r = await call('/api/auth/login', { body: { email, password: PASSWORD } });
  assert.equal(r.status, 200, `login ${email}`);
  return r.headers.get('set-cookie').split(';')[0];
}
const conn = (user, password) => mysql.createConnection({
  host: process.env.MYSQL_HOST ?? '127.0.0.1', port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE ?? 'disaster_relief', user, password,
});
const qty = async (item, shelter) =>
  (await pool.query('SELECT quantity_available q FROM STOCK WHERE item_id=? AND shelter_id=?', [item, shelter]))[0][0]?.q;

before(async () => {
  pool = coordinatorPool();
  vec = pgPool();
  m = await mongo();
  coordCookie = await login('ananya.sharma@relief.org');
  volCookie = await login('meera.iyer@relief.org');
});
after(async () => { await pool.end(); await vec.end(); await m.client.close(); });

/* ---------------- authentication & authorization ---------------- */

test('TC01 wrong password is rejected', async () => {
  const r = await call('/api/auth/login', { body: { email: 'meera.iyer@relief.org', password: 'nope' } });
  assert.equal(r.status, 401);
});

test('TC02 API refuses requests without a session', async () => {
  assert.equal((await call('/api/sos')).status, 401);
});

test('TC03 volunteer cannot call coordinator APIs (app-level RBAC)', async () => {
  const r = await call('/api/inventory', { cookie: volCookie });
  assert.equal(r.status, 403);
});

test('TC04 volunteer MySQL account cannot UPDATE STOCK (DB-level RBAC)', async () => {
  const c = await conn(process.env.MYSQL_VOL_USER, process.env.MYSQL_VOL_PASSWORD);
  await assert.rejects(c.query('UPDATE STOCK SET quantity_available = 0 WHERE stock_id = 1'), (e) => e.errno === 1142);
  await c.end();
});

test('TC05 auth MySQL account can only read APP_USER/SHELTER', async () => {
  const c = await conn(process.env.MYSQL_AUTH_USER, process.env.MYSQL_AUTH_PASSWORD);
  await assert.rejects(c.query('SELECT * FROM STOCK'), (e) => e.errno === 1142);
  await c.end();
});

test('TC06 passwords are stored as bcrypt hashes', async () => {
  const [rows] = await pool.query('SELECT password_hash FROM APP_USER');
  for (const r of rows) assert.match(r.password_hash, /^\$2[aby]\$10\$/);
});

/* ---------------- database-level validation ---------------- */

test('TC07 CHECK constraint rejects an invalid email', async () => {
  await assert.rejects(
    pool.query(`INSERT INTO APP_USER (name, role, email, password_hash) VALUES ('X','Field Volunteer','not-an-email','h')`),
    (e) => e.errno === 3819);
});

test('TC08 CHECK constraint rejects occupancy above capacity', async () => {
  await assert.rejects(pool.query('UPDATE SHELTER SET current_occupancy = capacity + 1 WHERE shelter_id = 1'), (e) => e.errno === 3819);
});

test('TC09 MongoDB $jsonSchema rejects an invalid intake form', async () => {
  await assert.rejects(
    m.db.collection('intake_forms').insertOne({ status: 'draft', disaster_type: 'meteor', household: [], needs: [], created_at: new Date() }),
    (e) => e.code === 121);
  assert.ok(intakeValidator.$jsonSchema);
});

/* ---------------- triggers & transactions ---------------- */

test('TC10 trigger blocks over-reservation', async () => {
  const r = await call('/api/reservations', { cookie: coordCookie, body: { sos_id: 4, item_id: 4, shelter_id: 4, quantity: 99999 } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Insufficient stock/);
});

test('TC11 reservation deducts stock; cancelling returns it (triggers)', async () => {
  const before = await qty(1, 2);
  const r = await call('/api/reservations', { cookie: coordCookie, body: { sos_id: 1, item_id: 1, shelter_id: 2, quantity: 7 } });
  assert.equal(r.status, 201);
  assert.equal(await qty(1, 2), before - 7);
  const c = await call(`/api/reservations/${r.data.reservation_id}/cancel`, { cookie: coordCookie, method: 'POST' });
  assert.equal(c.status, 200);
  assert.equal(await qty(1, 2), before);
});

test('TC12 trigger: only a Relief Coordinator can approve a dispatch', async () => {
  const [[res]] = await pool.query(`SELECT reservation_id FROM v_reservation_detail
     WHERE status IN ('pending','committed') AND quantity_reserved > quantity_dispatched LIMIT 1`);
  await assert.rejects(pool.query('CALL sp_approve_dispatch(?, NULL, 3, 1, @x)', [res.reservation_id]), /Relief Coordinator/);
});

test('TC13 failed transfer rolls back the whole transaction', async () => {
  const a = await qty(1, 5), b = await qty(1, 1);
  const r = await call('/api/inventory/transfer', { cookie: coordCookie, body: { item_id: 1, from_shelter: 5, to_shelter: 1, quantity: 999999 } });
  assert.equal(r.status, 400);
  assert.equal(await qty(1, 5), a);
  assert.equal(await qty(1, 1), b);
});

test('TC14 SOS with active reservations cannot be deleted (trigger)', async () => {
  const [[row]] = await pool.query(`SELECT sos_id FROM SUPPLY_RESERVATION WHERE status IN ('pending','committed') LIMIT 1`);
  const r = await call(`/api/sos/${row.sos_id}`, { cookie: coordCookie, method: 'DELETE' });
  assert.equal(r.status, 409);
});

/* ---------------- cross-database flow ---------------- */

test('TC15 new SOS is written to MySQL, MongoDB and pgvector, and delete cleans all three', async () => {
  const r = await call('/api/sos', {
    cookie: volCookie,
    body: {
      urgency: 'low', description: 'Integration test report - tree fell on a shed, two people need blankets',
      people_count: 2, lat: 12.95, lon: 77.6, disaster_type: 'cyclone', needs: ['blankets'],
      household: [{ age: 40 }, { age: 38 }], auto_match: false,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.sos_id;
  const [[sql]] = await pool.query('SELECT intake_doc_ref, status FROM VICTIM_SOS WHERE sos_id = ?', [id]);
  assert.equal(sql.status, 'unmatched');
  assert.match(sql.intake_doc_ref, /^mongo:intake_forms\//);
  const doc = await m.db.collection('intake_forms').findOne({ sos_id: id });
  assert.equal(doc.status, 'linked');
  assert.equal(r.data.vector_indexed, true);
  const { rows } = await vec.query('SELECT status, vector_dims(embedding) AS dims FROM sos_embeddings WHERE sos_id = $1', [id]);
  assert.equal(rows[0].dims, 384);
  assert.equal(rows[0].status, 'unmatched');

  const d = await call(`/api/sos/${id}`, { cookie: coordCookie, method: 'DELETE' });
  assert.equal(d.status, 200);
  assert.equal(await m.db.collection('intake_forms').countDocuments({ sos_id: id }), 0);
  assert.equal((await vec.query('SELECT 1 FROM sos_embeddings WHERE sos_id = $1', [id])).rowCount, 0);
});

test('TC16 invalid SOS input is rejected before touching the database', async () => {
  const r = await call('/api/sos', { cookie: volCookie, body: { urgency: 'extreme', description: 'x', people_count: 0, lat: 200, lon: 0, disaster_type: 'flood', household: [] } });
  assert.equal(r.status, 400);
});

/* ---------------- vector search ---------------- */

test('TC17 semantic search finds a report that keyword search cannot', async () => {
  const r = await call('/api/search?q=' + encodeURIComponent('kid burning up with temperature'), { cookie: volCookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.fulltext.length, 0, 'no keyword overlap expected');
  assert.ok(r.data.semantic.length > 0);
  assert.match(r.data.semantic[0].description, /fever/i);
});

test('TC18 duplicate detection flags a nearby similar open report', async () => {
  const r = await call('/api/sos/duplicates', { cookie: volCookie, body: { description: 'Family stuck on roof, flood water rising, baby needs food', lat: 12.933, lon: 77.62 } });
  assert.equal(r.status, 200);
  assert.ok(r.data.some((d) => d.sos_id === 1));
});

test('TC19 recommendations combine vector relevance with SQL stock lookup', async () => {
  const r = await call('/api/sos/1/insights', { cookie: coordCookie });
  assert.equal(r.status, 200);
  const names = r.data.recommendations.map((x) => x.item_name);
  assert.ok(names.includes('Baby Food'), names.join(', '));
  for (const rec of r.data.recommendations) for (const s of rec.shelters) assert.ok(s.quantity_available >= 1);
});

/* ---------------- NoSQL aggregation ---------------- */

test('TC20 MongoDB aggregations return grouped results', async () => {
  const r = await call('/api/analytics', { cookie: coordCookie });
  assert.equal(r.status, 200);
  const needs = r.data.mongo.find((x) => x.id === 'needs');
  assert.ok(needs.rows.length > 0);
  assert.ok(r.data.sql.every((x) => Array.isArray(x.rows)));
});

/* ---------------- pgvector specifics ---------------- */

test('TC21 pgvector uses the HNSW index for unfiltered kNN', async () => {
  const c = await vec.connect();
  try {
    await c.query('SET enable_seqscan = off'); // tiny demo table: force the planner to show the index path
    const { rows } = await c.query(
      `EXPLAIN SELECT sos_id FROM sos_embeddings ORDER BY embedding <=> (SELECT embedding FROM sos_embeddings LIMIT 1) LIMIT 5`);
    assert.ok(rows.map((r) => r['QUERY PLAN']).join('\n').includes('idx_sos_emb_hnsw'));
  } finally {
    c.release();
  }
});

test('TC22 vector app role cannot drop tables (least privilege)', async () => {
  await assert.rejects(vec.query('DROP TABLE item_embeddings'), (e) => e.code === '42501');
});
