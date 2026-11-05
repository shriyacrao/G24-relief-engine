import 'server-only';
import { mongoDb } from '@/lib/db/mongo';
import type { SessionUser } from '@/lib/types';

/** Append an entry to the MongoDB audit log. Never blocks or breaks the main action. */
export async function logActivity(
  user: SessionUser,
  action: string,
  entity: string,
  entityId: number | string | null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const db = await mongoDb();
    await db.collection('field_activity').insertOne({
      at: new Date(),
      actor: { user_id: user.uid, name: user.name, role: user.role },
      action,
      entity,
      entity_id: entityId,
      meta,
    });
  } catch (e) {
    console.warn('[activity] not logged:', (e as Error).message);
  }
}

export async function recentActivity(limit = 30, userId?: number) {
  const db = await mongoDb();
  const filter = userId ? { 'actor.user_id': userId } : {};
  return db.collection('field_activity').find(filter).sort({ at: -1 }).limit(limit).toArray();
}
