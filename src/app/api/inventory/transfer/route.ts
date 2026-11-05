import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { transfer } from '@/lib/services/operations';
import { transferSchema } from '@/lib/validation';

// CALL sp_transfer_stock: atomic, rows locked in shelter-id order, CHECK(qty>=0) rolls back a short transfer
export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const b = transferSchema.parse(await req.json());
    return transfer(db, user, b.item_id, b.from_shelter, b.to_shelter, b.quantity);
  });
}
