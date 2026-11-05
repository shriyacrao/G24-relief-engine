'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionUser } from '@/lib/types';

const Ctx = createContext<SessionUser | null>(null);

export function UserProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useUser(): SessionUser {
  const u = useContext(Ctx);
  if (!u) throw new Error('useUser outside UserProvider');
  return u;
}

export function useIsCoordinator() {
  return useUser().role === 'Relief Coordinator';
}
