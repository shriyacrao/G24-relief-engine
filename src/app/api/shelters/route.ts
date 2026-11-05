import { handle, requireUser } from '@/lib/api';
import { sheltersOverview } from '@/lib/services/analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const { db } = await requireUser();
    return sheltersOverview(db);
  });
}
