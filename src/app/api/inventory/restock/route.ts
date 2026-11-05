import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { restock } from '@/lib/services/operations';
import { restockSchema } from '@/lib/validation';

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const b = restockSchema.parse(await req.json());
    return restock(db, user, b.item_id, b.shelter_id, b.quantity);
  });
}
