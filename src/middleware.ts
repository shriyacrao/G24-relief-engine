import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

/** Pages only Relief Coordinators may open (API routes re-check the role themselves) */
const COORDINATOR_PAGES = ['/inventory', '/dispatch', '/analytics', '/team'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth/login');
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (isPublic) {
    if (user && pathname === '/login') return NextResponse.redirect(new URL('/dashboard', req.url));
    return NextResponse.next();
  }
  if (!user) {
    if (isApi) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (!isApi && user.role !== 'Relief Coordinator' && COORDINATOR_PAGES.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/dashboard?denied=1', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
