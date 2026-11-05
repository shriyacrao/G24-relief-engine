import { handle, intParam, requireUser } from '@/lib/api';
import { matchSos } from '@/lib/services/sos';

type Ctx = { params: Promise<{ id: string }> };

// Both roles: CALL sp_match_sos (nearest active shelter with enough beds)
export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser();
    return matchSos(db, user, intParam((await params).id));
  });
}
