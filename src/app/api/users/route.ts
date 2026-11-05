import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { createUser, listTeam } from '@/lib/services/users';
import { userSchema } from '@/lib/validation';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const { db } = await requireUser(COORDINATOR_ONLY);
    return listTeam(db);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    const b = userSchema.parse(await req.json());
    return createUser(db, user, { ...b, role: b.role as Role });
  }, 201);
}
