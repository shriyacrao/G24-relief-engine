import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { addVehicle } from '@/lib/services/operations';
import { vehicleSchema } from '@/lib/validation';

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return addVehicle(db, user, vehicleSchema.parse(await req.json()));
  }, 201);
}
