import 'server-only';
import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import type { Role } from '@/lib/types';

/**
 * Three connection pools, one per MySQL login:
 *   auth        -> relief_auth       (SELECT on APP_USER / SHELTER only, used at login)
 *   coordinator -> relief_coord_app  (MySQL role relief_coordinator)
 *   volunteer   -> relief_vol_app    (MySQL role field_volunteer)
 * The API picks the pool from the signed-in user's role, so the database
 * itself refuses anything that role is not allowed to do.
 * All credentials come from environment variables.
 */
type PoolName = 'auth' | 'coordinator' | 'volunteer';

const globalForPools = globalThis as unknown as { __reliefPools?: Partial<Record<PoolName, Pool>> };
const pools = (globalForPools.__reliefPools ??= {});

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

function createPool(name: PoolName): Pool {
  const prefix = name === 'auth' ? 'MYSQL_AUTH' : name === 'coordinator' ? 'MYSQL_COORD' : 'MYSQL_VOL';
  return mysql.createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: process.env.MYSQL_DATABASE ?? 'disaster_relief',
    user: required(`${prefix}_USER`),
    password: required(`${prefix}_PASSWORD`),
    connectionLimit: 8,
    decimalNumbers: true,
    timezone: 'Z',
    namedPlaceholders: false,
  });
}

export function getPool(name: PoolName): Pool {
  return (pools[name] ??= createPool(name));
}

export function poolForRole(role: Role): Pool {
  return getPool(role === 'Relief Coordinator' ? 'coordinator' : 'volunteer');
}

/** SELECT helper - returns rows typed as T[] */
export async function query<T = Record<string, unknown>>(pool: Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

/**
 * CALL a stored procedure that has OUT parameters.
 * Uses one connection so the session variables (@out) are visible to the follow-up SELECT.
 * Example: callWithOut(pool, 'sp_reserve_supply', [1, 6, 2, 5], ['reservation_id'])
 */
export async function callWithOut(
  pool: Pool,
  procedure: string,
  inParams: unknown[],
  outNames: string[],
): Promise<Record<string, unknown>> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    const inMarks = inParams.map(() => '?');
    const outVars = outNames.map((n) => `@out_${n}`);
    await conn.query(`CALL ${procedure}(${[...inMarks, ...outVars].join(', ')})`, inParams);
    if (!outNames.length) return {};
    const [rows] = await conn.query(`SELECT ${outNames.map((n) => `@out_${n} AS ${n}`).join(', ')}`);
    return (rows as Record<string, unknown>[])[0] ?? {};
  } finally {
    conn.release();
  }
}

/** CALL a stored procedure that returns a result set */
export async function callResultSet<T = Record<string, unknown>>(pool: Pool, procedure: string, params: unknown[]): Promise<T[]> {
  const marks = params.map(() => '?').join(', ');
  const [result] = await pool.query(`CALL ${procedure}(${marks})`, params);
  // mysql2 returns [rows, ResultSetHeader] for CALL
  return (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : []) as T[];
}
