import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { Pool } from 'mysql2/promise';
import { SESSION_COOKIE, verifySession } from './session';
import { poolForRole } from './db/mysql';
import type { Role, SessionUser } from './types';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** Throws 401/403 unless a user with one of the roles is signed in */
export async function requireUser(roles?: Role[]): Promise<{ user: SessionUser; db: Pool }> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Please sign in');
  if (roles && !roles.includes(user.role)) throw new HttpError(403, `This action needs the ${roles.join(' / ')} role`);
  return { user, db: poolForRole(user.role) };
}

export const COORDINATOR_ONLY: Role[] = ['Relief Coordinator'];

/**
 * Turns any error into a JSON response.
 * MySQL errors are mapped so that database-level validation (CHECK constraints,
 * trigger SIGNALs, FK rules, privilege checks) shows up as a readable message.
 */
export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    const msg = e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const err = e as { errno?: number; sqlMessage?: string; code?: string | number; message?: string; errInfo?: unknown };
  if (err?.errno) {
    const db = { errno: err.errno, code: err.code };
    switch (err.errno) {
      case 1644: // SIGNAL SQLSTATE '45000' from a trigger / procedure
        return NextResponse.json({ error: err.sqlMessage, source: 'trigger/procedure', db }, { status: 409 });
      case 3819: // CHECK constraint violated
        return NextResponse.json({ error: `Rejected by database CHECK constraint: ${err.sqlMessage}`, source: 'constraint', db }, { status: 400 });
      case 1062:
        return NextResponse.json({ error: `Duplicate value: ${err.sqlMessage}`, source: 'unique', db }, { status: 409 });
      case 1451:
      case 1452:
        return NextResponse.json({ error: `Foreign key rule: ${err.sqlMessage}`, source: 'foreign key', db }, { status: 409 });
      case 1142:
      case 1143:
      case 1370:
        return NextResponse.json({ error: `Database denied this for your role: ${err.sqlMessage}`, source: 'privilege', db }, { status: 403 });
    }
  }
  if (err?.code === 121) {
    return NextResponse.json({ error: 'MongoDB schema validation failed for the intake form', source: 'mongo validator' }, { status: 400 });
  }
  console.error('[api]', e);
  return NextResponse.json({ error: err?.sqlMessage ?? err?.message ?? 'Unexpected server error' }, { status: 500 });
}

/** Wrap a route handler body: JSON success or mapped error */
export async function handle<T>(fn: () => Promise<T>, status = 200): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data, { status });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export function intParam(v: string | null | undefined, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
}
