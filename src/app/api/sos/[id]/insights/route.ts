import { handle, intParam, requireUser } from '@/lib/api';
import { getSos, recommendSupplies, similarCases } from '@/lib/services/sos';
import { getIntakeForSos } from '@/lib/services/intake';

type Ctx = { params: Promise<{ id: string }> };

// Vector features for one SOS: recommended supplies (+ nearest stock) and similar cases
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, db } = await requireUser();
    const sos = await getSos(db, user, intParam((await params).id));
    const intake = await getIntakeForSos(sos.sos_id).catch(() => null);
    const [recommendations, similar] = await Promise.all([
      recommendSupplies(db, sos, intake),
      similarCases(sos),
    ]);
    return { recommendations, similar };
  });
}
