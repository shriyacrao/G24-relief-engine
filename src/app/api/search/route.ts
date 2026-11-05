import type { NextRequest } from 'next/server';
import { HttpError, handle, requireUser } from '@/lib/api';
import { fulltextSearch, semanticSearch } from '@/lib/services/sos';

export const dynamic = 'force-dynamic';

// GET /api/search?q=...&mode=semantic|fulltext|both&status=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user, db } = await requireUser();
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    const mode = req.nextUrl.searchParams.get('mode') ?? 'both';
    const status = req.nextUrl.searchParams.get('status') ?? 'all';
    if (q.length < 2) throw new HttpError(400, 'Type at least 2 characters');
    const [semantic, fulltext] = await Promise.all([
      mode === 'fulltext' ? Promise.resolve(null) : semanticSearch(db, user, q, status),
      mode === 'semantic' ? Promise.resolve(null) : fulltextSearch(db, user, q, status),
    ]);
    return { q, semantic, fulltext };
  });
}
