import { handle, intParam, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { cancelReservation } from '@/lib/services/operations';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return cancelReservation(db, user, intParam((await params).id));
  });
}
