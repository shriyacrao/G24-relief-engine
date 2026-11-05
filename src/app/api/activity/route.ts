import { handle, requireUser } from '@/lib/api';
import { recentActivity } from '@/lib/services/activity';

export const dynamic = 'force-dynamic';

// Coordinators see everyone's activity; volunteers only their own
export async function GET() {
  return handle(async () => {
    const { user } = await requireUser();
    return recentActivity(40, user.role === 'Relief Coordinator' ? undefined : user.uid);
  });
}
