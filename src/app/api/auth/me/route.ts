import { handle, requireUser } from '@/lib/api';

export async function GET() {
  return handle(async () => ({ user: (await requireUser()).user }));
}
