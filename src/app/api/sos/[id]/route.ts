import { handle, intParam, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { deleteSos, getSosDetail } from '@/lib/services/sos';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser();
    return getSosDetail(db, user, intParam((await params).id));
  });
}

// Remove a duplicate / spam report (trigger blocks it if reservations are active)
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return deleteSos(db, user, intParam((await params).id));
  });
}
