'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/types';

const I = {
  dash: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  sos: 'M12 2 1 21h22L12 2zm0 4.5L19.5 19h-15L12 6.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  box: 'M21 16.5c0 .4-.2.7-.5.9l-7.9 4.4c-.2.1-.4.2-.6.2s-.4-.1-.6-.2l-7.9-4.4c-.3-.2-.5-.5-.5-.9v-9c0-.4.2-.7.5-.9l7.9-4.4c.2-.1.4-.2.6-.2s.4.1.6.2l7.9 4.4c.3.2.5.5.5.9v9zM12 4.2 6 7.5l6 3.4 6-3.4-6-3.3zM5 15.9l6 3.4v-6.7L5 9.2v6.7zm14 0V9.2l-6 3.4v6.7l6-3.4z',
  truck: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2a3 3 0 0 0 6 0h6a3 3 0 0 0 6 0h2v-5l-3-4zM6 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm13.5-9 2 2.5H17V9.5h2.5zM18 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  chart: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z',
  team: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0h-1c1.2.9 2 2 2 3.5V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
};

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={d} /></svg>;
}

const COMMON = [
  { href: '/dashboard', label: 'Dashboard', icon: I.dash },
  { href: '/sos', label: 'SOS reports', icon: I.sos },
  { href: '/sos/new', label: 'New SOS', icon: I.plus },
  { href: '/search', label: 'Semantic search', icon: I.search },
  { href: '/shelters', label: 'Shelters', icon: I.home },
];
const COORD = [
  { href: '/inventory', label: 'Inventory', icon: I.box },
  { href: '/dispatch', label: 'Dispatch', icon: I.truck },
  { href: '/analytics', label: 'Analytics', icon: I.chart },
  { href: '/team', label: 'Team', icon: I.team },
];

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const isActive = (href: string) =>
    href === '/sos' ? path === '/sos' || (path.startsWith('/sos/') && path !== '/sos/new') : path === href || path.startsWith(href + '/');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-inner">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div style={{ fontWeight: 700 }}>ReliefOps</div>
            <small>Smart Relief Logistics</small>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-label">Field</div>
          {COMMON.map((l) => (
            <Link key={l.href} href={l.href} className={isActive(l.href) ? 'active' : ''}>
              <Icon d={l.icon} /> {l.label}
            </Link>
          ))}
          {user.role === 'Relief Coordinator' && (
            <>
              <div className="nav-label">Coordination</div>
              {COORD.map((l) => (
                <Link key={l.href} href={l.href} className={isActive(l.href) ? 'active' : ''}>
                  <Icon d={l.icon} /> {l.label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="side-foot">
          <div className="who">{user.name}</div>
          <div className="role">{user.role}</div>
          <button className="btn sm" onClick={logout}>Sign out</button>
        </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
