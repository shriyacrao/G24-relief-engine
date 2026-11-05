import 'server-only';
import { ObjectId, type Document } from 'mongodb';
import { mongoDb } from '@/lib/db/mongo';
import type { IntakeForm, SessionUser } from '@/lib/types';

export const INTAKE_REF_PREFIX = 'mongo:intake_forms/';

export async function intakeCollection() {
  return (await mongoDb()).collection<IntakeForm>('intake_forms');
}

export async function createDraftIntake(doc: Omit<IntakeForm, '_id' | 'sos_id' | 'status' | 'created_at' | 'updated_at' | 'timeline'>, user: SessionUser) {
  const col = await intakeCollection();
  const now = new Date();
  const _id = new ObjectId();
  await col.insertOne({
    ...doc,
    _id,
    sos_id: null,
    status: 'draft',
    timeline: [{ at: now, by: { user_id: user.uid, name: user.name }, note: 'Intake form filed' }],
    created_at: now,
    updated_at: now,
  });
  return _id;
}

export async function linkIntake(id: ObjectId, sosId: number) {
  const col = await intakeCollection();
  await col.updateOne({ _id: id }, { $set: { sos_id: sosId, status: 'linked', updated_at: new Date() } });
}

export async function deleteIntakeById(id: ObjectId) {
  const col = await intakeCollection();
  await col.deleteOne({ _id: id });
}

export async function getIntakeForSos(sosId: number) {
  const col = await intakeCollection();
  return col.findOne({ sos_id: sosId });
}

export async function getIntakesForSos(ids: number[]) {
  if (!ids.length) return new Map<number, IntakeForm>();
  const col = await intakeCollection();
  const docs = await col.find({ sos_id: { $in: ids } }, { projection: { sos_id: 1, disaster_type: 1, needs: 1, household: 1 } }).toArray();
  return new Map(docs.map((d) => [d.sos_id as number, d as IntakeForm]));
}

export async function addTimelineNote(sosId: number, user: SessionUser, note: string) {
  const col = await intakeCollection();
  const res = await col.updateOne(
    { sos_id: sosId },
    {
      $push: { timeline: { at: new Date(), by: { user_id: user.uid, name: user.name }, note } },
      $set: { updated_at: new Date() },
    },
  );
  return res.matchedCount > 0;
}

export async function deleteIntakeForSos(sosId: number) {
  const col = await intakeCollection();
  await col.deleteOne({ sos_id: sosId });
}

/* ------------------------------------------------------------------ *
 *  NoSQL aggregation pipelines (used by the dashboard / analytics)    *
 * ------------------------------------------------------------------ */

/** Most requested needs across all intake forms ($unwind + $group) */
export const PIPELINE_NEEDS: Document[] = [
  { $match: { status: 'linked' } },
  { $unwind: '$needs' },
  { $group: { _id: '$needs', cases: { $sum: 1 }, people: { $sum: { $size: '$household' } } } },
  { $sort: { cases: -1, _id: 1 } },
  { $limit: 10 },
];

/** Casualty profile by age band ($unwind household + $bucket) */
export const PIPELINE_AGE_BANDS: Document[] = [
  { $match: { status: 'linked' } },
  { $unwind: '$household' },
  {
    $bucket: {
      groupBy: { $ifNull: ['$household.age', -1] },
      boundaries: [-1, 0, 5, 18, 60, 121],
      default: 'unknown',
      output: {
        people: { $sum: 1 },
        injured: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$household.injuries', []] } }, 0] }, 1, 0] } },
        needs_medical: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$household.medical_needs', []] } }, 0] }, 1, 0] } },
        limited_mobility: { $sum: { $cond: [{ $in: ['$household.mobility', ['limited', 'immobile']] }, 1, 0] } },
      },
    },
  },
  {
    $project: {
      _id: 0,
      age_band: {
        $switch: {
          branches: [
            { case: { $eq: ['$_id', -1] }, then: 'age not given' },
            { case: { $eq: ['$_id', 0] }, then: '0-4 (infant)' },
            { case: { $eq: ['$_id', 5] }, then: '5-17 (child)' },
            { case: { $eq: ['$_id', 18] }, then: '18-59 (adult)' },
            { case: { $eq: ['$_id', 60] }, then: '60+ (elderly)' },
          ],
          default: 'unknown',
        },
      },
      people: 1, injured: 1, needs_medical: 1, limited_mobility: 1,
    },
  },
];

/** Injury types reported ($unwind twice) */
export const PIPELINE_INJURIES: Document[] = [
  { $match: { status: 'linked' } },
  { $unwind: '$household' },
  { $unwind: '$household.injuries' },
  { $group: { _id: { $toLower: '$household.injuries' }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 8 },
];

/** Cases by disaster type with vulnerable-people counts ($group + $project) */
export const PIPELINE_BY_DISASTER: Document[] = [
  { $match: { status: 'linked' } },
  {
    $project: {
      disaster_type: 1,
      members: { $size: '$household' },
      vulnerable: {
        $size: {
          $filter: {
            input: '$household',
            as: 'm',
            cond: {
              $or: [
                { $lt: [{ $ifNull: ['$$m.age', 30] }, 5] },
                { $gte: [{ $ifNull: ['$$m.age', 30] }, 60] },
                { $eq: ['$$m.is_pregnant', true] },
                { $in: ['$$m.mobility', ['limited', 'immobile']] },
              ],
            },
          },
        },
      },
    },
  },
  {
    $group: {
      _id: '$disaster_type',
      cases: { $sum: 1 },
      people: { $sum: '$members' },
      vulnerable: { $sum: '$vulnerable' },
      avg_household: { $avg: '$members' },
    },
  },
  { $sort: { cases: -1 } },
];

/** Field activity per day and action (on the audit log) */
export const pipelineActivity = (days = 7): Document[] => [
  { $match: { at: { $gte: new Date(Date.now() - days * 24 * 3600 * 1000) } } },
  {
    $group: {
      _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$at' } }, actor: '$actor.name' },
      actions: { $sum: 1 },
      kinds: { $addToSet: '$action' },
    },
  },
  { $sort: { '_id.day': -1, actions: -1 } },
  { $limit: 20 },
];

export async function runIntakeAggregations() {
  const db = await mongoDb();
  const intake = db.collection('intake_forms');
  const [needs, ageBands, injuries, byDisaster, activity] = await Promise.all([
    intake.aggregate(PIPELINE_NEEDS).toArray(),
    intake.aggregate(PIPELINE_AGE_BANDS).toArray(),
    intake.aggregate(PIPELINE_INJURIES).toArray(),
    intake.aggregate(PIPELINE_BY_DISASTER).toArray(),
    db.collection('field_activity').aggregate(pipelineActivity()).toArray(),
  ]);
  return { needs, ageBands, injuries, byDisaster, activity };
}

/** $geoNear: open intake cases within `radiusKm` of a point (e.g. a shelter) */
export async function casesNear(lat: number, lon: number, radiusKm: number) {
  const intake = await intakeCollection();
  const rows = await intake
    .aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lon, lat] },
          distanceField: 'distance_m',
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: { status: 'linked' },
        },
      },
      {
        $group: {
          _id: null,
          cases: { $sum: 1 },
          people: { $sum: { $size: '$household' } },
          nearest_m: { $min: '$distance_m' },
          needs: { $push: '$needs' },
        },
      },
      {
        $project: {
          _id: 0, cases: 1, people: 1, nearest_m: { $round: ['$nearest_m', 0] },
          top_needs: {
            $slice: [{ $setUnion: [{ $reduce: { input: '$needs', initialValue: [], in: { $concatArrays: ['$$value', '$$this'] } } }, []] }, 4],
          },
        },
      },
    ])
    .toArray();
  return rows[0] ?? { cases: 0, people: 0, nearest_m: null, top_needs: [] };
}
