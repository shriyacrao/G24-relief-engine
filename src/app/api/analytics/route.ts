import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { analytics } from '@/lib/services/analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const { db } = await requireUser(COORDINATOR_ONLY);
    return analytics(db);
  });
}
