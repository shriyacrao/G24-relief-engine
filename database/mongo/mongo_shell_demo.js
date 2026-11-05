// =====================================================================
// MongoDB part - Disaster Response & Smart Relief Logistics Engine (G24)
// Run in mongosh:   mongosh "mongodb://127.0.0.1:27017/relief_engine" database/mongo/mongo_shell_demo.js
// (Collections, validator and indexes are also created automatically by
//  `npm run seed` and by the app on first use.)
// =====================================================================
db = db.getSiblingDB('relief_engine');

print('\n--- 1. Collections ---');
printjson(db.getCollectionNames());

print('\n--- 2. $jsonSchema validator on intake_forms ---');
printjson(db.getCollectionInfos({ name: 'intake_forms' })[0].options.validator.$jsonSchema.required);

print('\n--- 3. Indexes ---');
db.intake_forms.getIndexes().forEach((i) => print(`  ${i.name}: ${JSON.stringify(i.key)}${i.unique ? ' UNIQUE' : ''}`));
db.field_activity.getIndexes().forEach((i) => print(`  ${i.name}: ${JSON.stringify(i.key)}`));

print('\n--- 4. One intake document ---');
printjson(db.intake_forms.findOne({ sos_id: 1 }));

print('\n--- 5. Validation test (expected to FAIL: disaster_type not in enum) ---');
try {
  db.intake_forms.insertOne({ status: 'draft', disaster_type: 'meteor', location: { type: 'Point', coordinates: [77.6, 12.9] },
    reporter: { user_id: 1, name: 'x' }, household: [{}], needs: [], created_at: new Date() });
} catch (e) { print('  rejected: ' + e.message.split('\n')[0]); }

print('\n--- 6. Multikey index query: cases that need medicines ---');
db.intake_forms.find({ needs: 'medicines' }, { sos_id: 1, needs: 1, _id: 0 }).forEach(printjson);
print('  plan: ' + db.intake_forms.find({ needs: 'medicines' }).explain().queryPlanner.winningPlan.inputStage?.indexName);

print('\n--- 7. Aggregation: most requested needs ($unwind -> $group -> $sort) ---');
db.intake_forms.aggregate([
  { $match: { status: 'linked' } },
  { $unwind: '$needs' },
  { $group: { _id: '$needs', cases: { $sum: 1 }, people: { $sum: { $size: '$household' } } } },
  { $sort: { cases: -1 } },
]).forEach(printjson);

print('\n--- 8. Aggregation: people by age band ($unwind household -> $bucket) ---');
db.intake_forms.aggregate([
  { $unwind: '$household' },
  { $bucket: {
      groupBy: { $ifNull: ['$household.age', -1] },
      boundaries: [-1, 0, 5, 18, 60, 121], default: 'unknown',
      output: {
        people: { $sum: 1 },
        injured: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$household.injuries', []] } }, 0] }, 1, 0] } },
        limited_mobility: { $sum: { $cond: [{ $in: ['$household.mobility', ['limited', 'immobile']] }, 1, 0] } },
      } } },
]).forEach(printjson);

print('\n--- 9. Aggregation: vulnerable people per disaster type ($filter inside $project) ---');
db.intake_forms.aggregate([
  { $project: { disaster_type: 1, members: { $size: '$household' },
      vulnerable: { $size: { $filter: { input: '$household', as: 'm', cond: { $or: [
        { $lt: [{ $ifNull: ['$$m.age', 30] }, 5] }, { $gte: [{ $ifNull: ['$$m.age', 30] }, 60] },
        { $eq: ['$$m.is_pregnant', true] }, { $in: ['$$m.mobility', ['limited', 'immobile']] } ] } } } } } },
  { $group: { _id: '$disaster_type', cases: { $sum: 1 }, people: { $sum: '$members' }, vulnerable: { $sum: '$vulnerable' } } },
  { $sort: { cases: -1 } },
]).forEach(printjson);

print('\n--- 10. Geospatial: cases within 5 km of Koramangala Indoor Stadium ($geoNear, 2dsphere) ---');
db.intake_forms.aggregate([
  { $geoNear: { near: { type: 'Point', coordinates: [77.6245, 12.9352] }, distanceField: 'distance_m', maxDistance: 5000, spherical: true } },
  { $project: { _id: 0, sos_id: 1, disaster_type: 1, distance_m: { $round: ['$distance_m', 0] }, people: { $size: '$household' } } },
]).forEach(printjson);

print('\n--- 11. Update: field note appended with $push ---');
printjson(db.intake_forms.updateOne({ sos_id: 1 }, { $push: { timeline: { at: new Date(), by: { user_id: 3, name: 'Meera Iyer' }, note: 'mongosh demo note' } } }));

print('\n--- 12. Audit log: actions per person per day ---');
db.field_activity.aggregate([
  { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$at' } }, actor: '$actor.name' }, actions: { $sum: 1 } } },
  { $sort: { '_id.day': -1, actions: -1 } },
]).forEach(printjson);
