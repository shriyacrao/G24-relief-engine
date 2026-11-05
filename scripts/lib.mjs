// Shared helpers for the seed scripts (plain Node ESM, reads .env.local)
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) dotenv.config({ path: p });
}

export function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} - copy .env.example to .env.local and fill it in`);
  return v;
}

/** Coordinator pool: seeding runs with the same least-privilege account the app uses */
export function coordinatorPool() {
  return mysql.createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: process.env.MYSQL_DATABASE ?? 'disaster_relief',
    user: need('MYSQL_COORD_USER'),
    password: need('MYSQL_COORD_PASSWORD'),
    decimalNumbers: true,
    connectionLimit: 4,
  });
}

export async function mongo() {
  const client = await new MongoClient(need('MONGODB_URI'), { serverSelectionTimeoutMS: 5000 }).connect();
  return { client, db: client.db(process.env.MONGODB_DB ?? 'relief_engine') };
}

export const intakeValidator = JSON.parse(fs.readFileSync(path.join(root, 'database/mongo/intake_forms.schema.json'), 'utf8'));

export async function ensureMongo(db) {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  if (!names.has('intake_forms')) await db.createCollection('intake_forms', { validator: intakeValidator, validationLevel: 'strict' });
  else await db.command({ collMod: 'intake_forms', validator: intakeValidator, validationLevel: 'strict' });
  await db.collection('intake_forms').createIndexes([
    { key: { sos_id: 1 }, name: 'uq_sos_id', unique: true, partialFilterExpression: { sos_id: { $type: 'number' } } },
    { key: { location: '2dsphere' }, name: 'geo_location' },
    { key: { needs: 1 }, name: 'mk_needs' },
    { key: { disaster_type: 1, created_at: -1 }, name: 'type_created' },
    { key: { 'household.injuries': 1 }, name: 'mk_injuries' },
  ]);
  if (!names.has('field_activity')) await db.createCollection('field_activity');
  await db.collection('field_activity').createIndexes([
    { key: { at: -1 }, name: 'at_desc' },
    { key: { 'actor.user_id': 1, at: -1 }, name: 'actor_at' },
    { key: { entity: 1, entity_id: 1 }, name: 'entity' },
  ]);
}

/** PostgreSQL + pgvector (database relief_vectors, created by database/vector/pgvector_setup.sql) */
export function pgPool() {
  return new pg.Pool({
    host: process.env.PG_HOST ?? '127.0.0.1',
    port: Number(process.env.PG_PORT ?? 5432),
    database: process.env.PG_DATABASE ?? 'relief_vectors',
    user: process.env.PG_USER ?? 'relief_vector_app',
    password: need('PG_PASSWORD'),
    max: 4,
  });
}

export const toVector = (v) => `[${v.join(',')}]`;

let extractor;
export async function embed(text) {
  if (!extractor) {
    const { pipeline, env } = await import('@xenova/transformers');
    if (process.env.EMBEDDING_MODEL_DIR) {
      env.localModelPath = path.resolve(root, process.env.EMBEDDING_MODEL_DIR);
      env.allowRemoteModels = false;
    }
    console.log('  loading embedding model (first run downloads ~23 MB)...');
    extractor = await pipeline('feature-extraction', process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  }
  const out = await extractor(text.trim().slice(0, 2000), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

export function sosText(description, needs = [], disasterType) {
  const parts = [description.trim()];
  if (disasterType) parts.push(`Disaster: ${disasterType.replace('_', ' ')}`);
  if (needs.length) parts.push(`Needs: ${needs.join(', ')}`);
  return parts.join('. ');
}

export function parseLatLong(ll) {
  if (!ll) return null;
  const [lat, lon] = ll.split(',').map((x) => Number(x.trim()));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
