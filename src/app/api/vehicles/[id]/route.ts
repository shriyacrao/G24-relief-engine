import { handle, intParam, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { setVehicleStatus } from '@/lib/services/operations';
import { vehicleStatusSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const { status } = vehicleStatusSchema.parse(await req.json());
    return setVehicleStatus(db, user, intParam((await params).id), status);
  });
}
