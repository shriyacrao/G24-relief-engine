import 'server-only';
import { MongoClient, type Db, type Document } from 'mongodb';
import intakeSchema from '../../../database/mongo/intake_forms.schema.json';

/**
 * MongoDB holds the data that does not fit a fixed relational shape:
 *   intake_forms   - one victim/casualty intake document per SOS. Household
 *                    members, injuries, needs and disaster-specific details
 *                    vary from case to case, so they are stored as nested
 *                    documents instead of many sparse SQL tables.
 *   field_activity - append-only audit log of every action taken in the app
 *                    (free-form metadata per action type).
 */
const globalForMongo = globalThis as unknown as {
  __reliefMongo?: Promise<MongoClient>;
  __reliefMongoSetup?: Promise<void>;
};

function client(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing environment variable MONGODB_URI (see .env.example)');
  return (globalForMongo.__reliefMongo ??= new MongoClient(uri, { serverSelectionTimeoutMS: 4000 }).connect());
}

export async function mongoDb(): Promise<Db> {
  const db = (await client()).db(process.env.MONGODB_DB ?? 'relief_engine');
  await (globalForMongo.__reliefMongoSetup ??= ensureMongoSetup(db).catch((e) => {
    globalForMongo.__reliefMongoSetup = undefined;
    throw e;
  }));
  return db;
}

/** JSON-schema validator: database-level validation for intake documents
 *  (kept in database/mongo/intake_forms.schema.json so scripts and docs share it) */
export const intakeValidator: Document = intakeSchema;

async function ensureMongoSetup(db: Db): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  if (!existing.has('intake_forms')) {
    await db.createCollection('intake_forms', { validator: intakeValidator, validationLevel: 'strict' });
  } else {
    await db.command({ collMod: 'intake_forms', validator: intakeValidator, validationLevel: 'strict' });
  }
  const intake = db.collection('intake_forms');
  await intake.createIndexes([
    // one intake form per SOS (partial: drafts have sos_id = null)
    { key: { sos_id: 1 }, name: 'uq_sos_id', unique: true, partialFilterExpression: { sos_id: { $type: 'number' } } },
    // geospatial queries ($geoNear: cases near a shelter)
    { key: { location: '2dsphere' }, name: 'geo_location' },
    // multikey index: "which cases need X"
    { key: { needs: 1 }, name: 'mk_needs' },
    { key: { disaster_type: 1, created_at: -1 }, name: 'type_created' },
    { key: { 'household.injuries': 1 }, name: 'mk_injuries' },
  ]);

  if (!existing.has('field_activity')) await db.createCollection('field_activity');
  await db.collection('field_activity').createIndexes([
    { key: { at: -1 }, name: 'at_desc' },
    { key: { 'actor.user_id': 1, at: -1 }, name: 'actor_at' },
    { key: { entity: 1, entity_id: 1 }, name: 'entity' },
  ]);
}
