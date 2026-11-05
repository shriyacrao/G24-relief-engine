import { handle, intParam, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { resolveSos } from '@/lib/services/sos';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return resolveSos(db, user, intParam((await params).id));
  });
}
