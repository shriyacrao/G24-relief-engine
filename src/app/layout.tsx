import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ReliefOps - Disaster Response & Smart Relief Logistics',
  description: 'G24 DBMS project: MySQL + MongoDB + PostgreSQL/pgvector + Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
