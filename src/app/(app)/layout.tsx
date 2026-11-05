import { redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { currentUser } from '@/lib/api';
import { UserProvider } from '@/components/UserContext';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <UserProvider user={user}>
      <AppShell user={user}>{children}</AppShell>
    </UserProvider>
  );
}
