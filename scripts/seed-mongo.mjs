// Creates MongoDB collections (validator + indexes) and an intake form for every
// SOS row that does not have one yet, then links it via VICTIM_SOS.intake_doc_ref.
import { pathToFileURL } from 'node:url';
import { ObjectId } from 'mongodb';
import { coordinatorPool, ensureMongo, mongo, parseLatLong } from './lib.mjs';

const P = (age, gender, extra = {}) => ({ age, gender, injuries: [], medical_needs: [], is_pregnant: false, mobility: 'ok', ...extra });

// Intake details for the sample SOS in 02_dml_advanced.sql, matched by a phrase in the description
const PROFILES = [
  {
    match: 'rooftop', disaster_type: 'flood', address_text: 'Ejipura main road, near Koramangala',
    needs: ['baby food', 'medicines', 'evacuation', 'drinking water'],
    details: { water_level_ft: 6, roof_access: true, boat_needed: true },
    household: [P(38, 'male'), P(34, 'female'), P(66, 'female', { medical_needs: ['blood pressure tablets'], mobility: 'limited' }), P(7, 'male'), P(1, 'female', { medical_needs: ['fever'] })],
  },
  {
    match: 'Elderly couple', disaster_type: 'flood', address_text: 'Kathriguppe, Banashankari 3rd Stage',
    needs: ['drinking water', 'medicines'], details: { water_level_ft: 2, roof_access: false },
    household: [P(74, 'male', { medical_needs: ['insulin'], mobility: 'limited' }), P(69, 'female', { medical_needs: ['blood pressure tablets'], mobility: 'limited' })],
  },
  {
    match: 'Landslide', disaster_type: 'landslide', address_text: 'Village road off Hennur-Bagalur road',
    needs: ['tarpaulin / roof cover', 'blankets', 'food'], details: { road_blocked: true, houses_damaged: 2 },
    household: [P(45, 'male', { injuries: ['bruises'] }), P(41, 'female'), P(19, 'female'), P(15, 'male'), P(70, 'male', { mobility: 'limited' }), P(10, 'female')],
  },
  {
    match: 'high fever and leg injury', disaster_type: 'flood', address_text: 'Yelahanka Old Town, behind bus stand',
    needs: ['first aid', 'ambulance', 'medicines'], details: { water_level_ft: 3 },
    household: [P(9, 'male', { injuries: ['leg injury'], medical_needs: ['fever'], mobility: 'immobile' }), P(35, 'female'), P(40, 'male')],
  },
  {
    match: 'rice for two days', disaster_type: 'flood', address_text: 'Jayanagar 9th Block',
    needs: ['drinking water', 'food'], details: { water_level_ft: 1 },
    household: [P(52, 'male'), P(48, 'female')],
  },
  {
    match: 'apartment block', disaster_type: 'flood', address_text: 'Apartment complex, Koramangala 6th Block',
    needs: ['shelter bed', 'blankets', 'drinking water', 'evacuation'], details: { water_level_ft: 4, roof_access: false, boat_needed: true },
    household: [P(42, 'male'), P(39, 'female'), P(12, 'female'), P(8, 'male'), P(67, 'female', { mobility: 'limited' }), P(30, 'male'), P(28, 'female'), P(3, 'male'), P(55, 'male', { injuries: ['cut on hand'] }), P(50, 'female')],
  },
  {
    match: 'hospital annex', disaster_type: 'other', address_text: 'Hospital annex, Yelahanka New Town',
    needs: ['hygiene kit'], details: { situation: 'Power outage, generator failed' },
    household: [P(30, 'female'), P(27, 'female'), P(45, 'male'), P(60, 'male', { medical_needs: ['dialysis'] }), P(33, 'female'), P(25, 'male'), P(38, 'female'), P(52, 'male')],
  },
  {
    match: 'Pregnant woman', disaster_type: 'flood', address_text: 'Whitefield, near ITPL back gate',
    needs: ['evacuation', 'medicines', 'first aid'], details: { water_level_ft: 5, roof_access: true, boat_needed: true },
    household: [P(29, 'female', { is_pregnant: true, medical_needs: ['prenatal check'] }), P(10, 'male'), P(6, 'female'), P(3, 'male')],
  },
  {
    match: 'Collapsed wall', disaster_type: 'building_collapse', address_text: 'Yelahanka market road',
    needs: ['shelter bed', 'first aid'], details: { people_trapped: 0, heavy_equipment: false },
    household: [P(36, 'male', { injuries: ['head cut'] }), P(33, 'female', { injuries: ['bruises'] }), P(11, 'female'), P(5, 'male')],
  },
];

function profileFor(description, people) {
  const p = PROFILES.find((x) => description.toLowerCase().includes(x.match.toLowerCase()));
  if (p) return p;
  return { disaster_type: 'other', needs: [], details: {}, household: Array.from({ length: Math.max(1, people) }, () => P(null, 'unspecified')) };
}

export async function seedMongo() {
  const pool = coordinatorPool();
  const { client, db } = await mongo();
  try {
    await ensureMongo(db);
    console.log('  collections, $jsonSchema validator and indexes ready');
    const intake = db.collection('intake_forms');
    const activity = db.collection('field_activity');
    const [rows] = await pool.query(
      `SELECT v.sos_id, v.description, v.people_count, v.lat_long, v.reported_at, v.intake_doc_ref, v.urgency_level,
              u.user_id, u.name, u.role
         FROM VICTIM_SOS v JOIN APP_USER u ON u.user_id = v.reported_by ORDER BY v.sos_id`);
    let created = 0;
    for (const r of rows) {
      if (await intake.findOne({ sos_id: r.sos_id })) continue;
      const ll = parseLatLong(r.lat_long) ?? { lat: 12.9716, lon: 77.5946 };
      const prof = profileFor(r.description ?? '', r.people_count);
      const _id = new ObjectId();
      const at = new Date(r.reported_at);
      await intake.insertOne({
        _id,
        sos_id: r.sos_id,
        status: 'linked',
        disaster_type: prof.disaster_type,
        location: { type: 'Point', coordinates: [ll.lon, ll.lat] },
        address_text: prof.address_text,
        reporter: { user_id: r.user_id, name: r.name },
        household: prof.household,
        needs: prof.needs,
        details: prof.details,
        timeline: [{ at, by: { user_id: r.user_id, name: r.name }, note: 'Intake form filed' }],
        created_at: at,
        updated_at: at,
      });
      // keep the paper-scan reference if there was one, otherwise point to the Mongo document
      if (!r.intake_doc_ref || !r.intake_doc_ref.startsWith('mongo:')) {
        await pool.query('UPDATE VICTIM_SOS SET intake_doc_ref = ? WHERE sos_id = ?', [`mongo:intake_forms/${_id.toHexString()}`, r.sos_id]);
      }
      await activity.insertOne({ at, actor: { user_id: r.user_id, name: r.name, role: r.role }, action: 'sos.register', entity: 'VICTIM_SOS', entity_id: r.sos_id, meta: { urgency: r.urgency_level, people: r.people_count, backfilled: true } });
      created++;
    }
    console.log(`  ${created} intake forms created (${rows.length} SOS rows total)`);
  } finally {
    await client.close();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('[seed:mongo]');
  seedMongo().catch((e) => { console.error(e.message); process.exit(1); });
}
