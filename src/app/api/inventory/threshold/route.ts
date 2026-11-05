import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { updateThreshold } from '@/lib/services/operations';
import { thresholdSchema } from '@/lib/validation';

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const b = thresholdSchema.parse(await req.json());
    return updateThreshold(db, user, b.stock_id, b.reorder_threshold);
  });
}
