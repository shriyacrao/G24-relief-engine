import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { reserve } from '@/lib/services/operations';
import { reserveSchema } from '@/lib/validation';

// CALL sp_reserve_supply (transaction; triggers validate and deduct stock)
export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const b = reserveSchema.parse(await req.json());
    return reserve(db, user, b.sos_id, b.item_id, b.shelter_id, b.quantity);
  }, 201);
}
