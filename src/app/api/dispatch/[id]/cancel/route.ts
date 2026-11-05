import { handle, intParam, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { cancelDispatch } from '@/lib/services/operations';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return cancelDispatch(db, user, intParam((await params).id));
  });
}
