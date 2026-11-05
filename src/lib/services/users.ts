import 'server-only';
import bcrypt from 'bcryptjs';
import type { Pool } from 'mysql2/promise';
import { getPool, query } from '@/lib/db/mysql';
import { logActivity } from './activity';
import type { Role, SessionUser } from '@/lib/types';

const BCRYPT_ROUNDS = 10;

/** Login: runs on the least-privileged `relief_auth` MySQL account */
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const rows = await query<{ user_id: number; name: string; email: string; role: Role; shelter_id: number | null; password_hash: string }>(
    getPool('auth'),
    'SELECT user_id, name, email, role, shelter_id, password_hash FROM APP_USER WHERE email = ? LIMIT 1',
    [email.trim().toLowerCase()],
  );
  const u = rows[0];
  // compare against a dummy hash when the user does not exist -> same timing either way
  const hash = u?.password_hash ?? '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.5tHt7z4FZzN6m5G5vR6yP2iSm4yW';
  const ok = await bcrypt.compare(password, hash).catch(() => false);
  if (!u || !ok) return null;
  return { uid: u.user_id, name: u.name, email: u.email, role: u.role, shelterId: u.shelter_id };
}

export async function listTeam(db: Pool) {
  return query(
    db,
    `SELECT u.user_id, u.name, u.role, u.email, u.phone, u.shelter_id,
            a.home_shelter, a.sos_reported, a.sos_resolved, a.people_reported, a.last_report_at
       FROM APP_USER u
       JOIN v_volunteer_activity a ON a.user_id = u.user_id
      ORDER BY u.role, u.name`,
  );
}

export async function createUser(
  db: Pool,
  actor: SessionUser,
  input: { name: string; email: string; phone?: string | null; role: Role; shelter_id?: number | null; password: string },
) {
  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS); // never store plain text
  const [res] = await db.query(
    'INSERT INTO APP_USER (name, role, email, phone, password_hash, shelter_id) VALUES (?, ?, ?, ?, ?, ?)',
    [input.name, input.role, input.email.trim().toLowerCase(), input.phone || null, hash, input.shelter_id ?? null],
  );
  const id = (res as { insertId: number }).insertId;
  await logActivity(actor, 'user.create', 'APP_USER', id, { role: input.role });
  return { user_id: id };
}

export async function reassignUser(db: Pool, actor: SessionUser, userId: number, shelterId: number | null) {
  await db.query('UPDATE APP_USER SET shelter_id = ? WHERE user_id = ?', [shelterId, userId]);
  await logActivity(actor, 'user.reassign', 'APP_USER', userId, { shelterId });
  return { ok: true };
}
