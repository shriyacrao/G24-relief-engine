// Replaces the placeholder password hashes from 02_dml_advanced.sql with real bcrypt hashes.
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { coordinatorPool, need } from './lib.mjs';

export async function seedAuth() {
  const password = need('SEED_USER_PASSWORD');
  const pool = coordinatorPool();
  try {
    const [rows] = await pool.query(`SELECT user_id, email FROM APP_USER WHERE password_hash LIKE '$2b$10$placeholder%'`);
    for (const r of rows) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE APP_USER SET password_hash = ? WHERE user_id = ?', [hash, r.user_id]);
      console.log(`  bcrypt hash set for ${r.email}`);
    }
    if (!rows.length) console.log('  no placeholder hashes left - nothing to do');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('[seed:auth]');
  seedAuth().catch((e) => { console.error(e.message); process.exit(1); });
}
