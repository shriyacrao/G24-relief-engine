import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { createItem, listItems } from '@/lib/services/operations';
import { itemSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const { db } = await requireUser();
    return listItems(db);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { user, db } = await requireUser(COORDINATOR_ONLY);
    return createItem(db, user, itemSchema.parse(await req.json()));
  }, 201);
}
