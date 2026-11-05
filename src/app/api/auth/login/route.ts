import { NextResponse, type NextRequest } from 'next/server';
import { toErrorResponse } from '@/lib/api';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from '@/lib/session';
import { authenticate } from '@/lib/services/users';
import { logActivity } from '@/lib/services/activity';
import { loginSchema } from '@/lib/validation';

// Basic brute-force protection: 10 failed attempts per IP per 10 minutes
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const a = attempts.get(ip);
    if (a && a.n >= 10 && a.until > Date.now()) {
      return NextResponse.json({ error: 'Too many failed attempts. Try again in a few minutes.' }, { status: 429 });
    }
    const { email, password } = loginSchema.parse(await req.json());
    const user = await authenticate(email, password);
    if (!user) {
      const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 10 * 60 * 1000 };
      attempts.set(ip, { n: cur.n + 1, until: cur.until });
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    attempts.delete(ip);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, await signSession(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    await logActivity(user, 'auth.login', 'APP_USER', user.uid);
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
