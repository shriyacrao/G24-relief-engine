import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { approveDispatch, dispatchBoard } from '@/lib/services/operations';
import { dispatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const { db } = await requireUser(COORDINATOR_ONLY);
    return dispatchBoard(db);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const b = dispatchSchema.parse(await req.json());
    return approveDispatch(db, user, b.reservation_id, b.vehicle_id, b.quantity);
  }, 201);
}
