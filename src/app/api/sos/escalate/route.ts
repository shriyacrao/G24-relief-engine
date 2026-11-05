import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { escalateStale } from '@/lib/services/sos';

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const body = await req.json().catch(() => ({}));
    const hours = Math.max(1, Math.min(168, Number(body?.hours) || 12));
    return escalateStale(db, user, hours);
  });
}
