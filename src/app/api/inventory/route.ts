import type { NextRequest } from 'next/server';
import { handle, requireUser, COORDINATOR_ONLY } from '@/lib/api';
import { listStock } from '@/lib/services/operations';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { db } = await requireUser(COORDINATOR_ONLY);
    const p = req.nextUrl.searchParams;
    return listStock(db, {
      shelter: p.get('shelter') ? Number(p.get('shelter')) : undefined,
      category: p.get('category') ?? undefined,
      health: p.get('health') ?? undefined,
    });
  });
}
