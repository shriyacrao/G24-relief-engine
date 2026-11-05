import { handle, requireUser } from '@/lib/api';
import { dashboard } from '@/lib/services/analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const { user, db } = await requireUser();
    return dashboard(db, user);
  });
}
