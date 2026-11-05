'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const DEMO = [
  { email: 'ananya.sharma@relief.org', role: 'Relief Coordinator' },
  { email: 'meera.iyer@relief.org', role: 'Field Volunteer' },
];

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Sign-in failed');
    router.push(next.startsWith('/') ? next : '/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <div>
        <h1>Sign in</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>Use your relief-team account.</p>
      </div>
      {error && <div className="notice err">{error}</div>}
      <label className="f">Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      </label>
      <label className="f">Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="card" style={{ padding: 12 }}>
        <div className="small muted" style={{ marginBottom: 6 }}>Demo accounts (password set by <code>npm run seed</code>)</div>
        {DEMO.map((d) => (
          <button type="button" key={d.email} className="btn ghost sm" style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setEmail(d.email)}>
            {d.role}: {d.email}
          </button>
        ))}
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login">
      <div className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">R</div>
          <div><div style={{ fontWeight: 700 }}>ReliefOps</div><small>G24 · DBMS Mini Project</small></div>
        </div>
        <div>
          <h1>Get the right supplies to the right shelter, first.</h1>
          <p>SOS triage, shelter matching, stock reservations and vehicle dispatch for flood and disaster response in Bengaluru.</p>
        </div>
        <div className="stack-db">
          <span>MySQL · system of record</span><span>MongoDB · intake forms</span><span>PostgreSQL + pgvector · semantic matching</span><span>Next.js</span>
        </div>
      </div>
      <div className="login-form">
        <Suspense fallback={null}><LoginForm /></Suspense>
      </div>
    </div>
  );
}
