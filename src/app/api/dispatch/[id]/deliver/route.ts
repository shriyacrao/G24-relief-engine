import { handle, intParam, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { completeDelivery } from '@/lib/services/operations';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return completeDelivery(db, user, intParam((await params).id));
  });
}
