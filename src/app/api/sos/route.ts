import type { NextRequest } from 'next/server';
import { handle, requireUser } from '@/lib/api';
import { listSos, registerSos } from '@/lib/services/sos';
import { registerSosSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// GET /api/sos?status=open|unmatched|matched|resolved|all&urgency=&mine=1&q=<full-text>
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user, db } = await requireUser();
    const p = req.nextUrl.searchParams;
    return listSos(db, user, {
      status: p.get('status') ?? 'open',
      urgency: p.get('urgency') ?? undefined,
      mine: p.get('mine') === '1',
      q: p.get('q') ?? undefined,
    });
  });
}

// POST /api/sos - both roles may file an SOS (MySQL + MongoDB + pgvector)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user, db } = await requireUser();
    const input = registerSosSchema.parse(await req.json());
    return registerSos(db, user, input);
  }, 201);
}
