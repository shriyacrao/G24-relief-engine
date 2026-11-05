import { SignJWT, jwtVerify } from 'jose';
import type { SessionUser } from './types';

/** Signed (HS256) JWT stored in an httpOnly cookie. Edge-safe: used by middleware too. */
export const SESSION_COOKIE = 'relief_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // one 8-hour shift

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to a random string of 32+ characters');
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.uid))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    const { uid, name, email, role, shelterId } = payload as unknown as SessionUser;
    if (!uid || !role) return null;
    return { uid, name, email, role, shelterId: shelterId ?? null };
  } catch {
    return null;
  }
}
