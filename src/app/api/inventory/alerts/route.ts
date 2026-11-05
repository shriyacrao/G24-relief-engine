import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { listAlerts, purgeResolvedAlerts } from '@/lib/services/operations';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const { db } = await requireUser(COORDINATOR_ONLY);
    return listAlerts(db);
  });
}

export async function DELETE() {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return purgeResolvedAlerts(db, user);
  });
}
