import { seedAuth } from './seed-auth.mjs';
import { seedMongo } from './seed-mongo.mjs';
import { seedVectors } from './seed-vectors.mjs';

try {
  console.log('[1/3] MySQL: bcrypt password hashes');
  await seedAuth();
  console.log('[2/3] MongoDB: collections, validator, indexes, intake forms');
  await seedMongo();
  console.log('[3/3] PostgreSQL + pgvector: embeddings for relief items and SOS reports');
  await seedVectors();
  console.log('\nDone. Start the app with: npm run dev');
} catch (e) {
  console.error('\nSeed failed:', e.message);
  process.exit(1);
}
