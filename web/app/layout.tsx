import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { getMe, listWorkspaces } from '@/lib/api';

// Premium2.0 uses Inter for display and body.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], weight: ['400', '500'], display: 'swap' });

export const metadata: Metadata = {
  title: 'PaperMind',
  description: 'Author once, execute many times — evidence-backed document review.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // getMe() returns null for a signed-out visitor; skip the (auth-gated)
  // workspace list in that case rather than let it throw NOT_AUTHENTICATED.
  const user = await getMe();
  const workspaces = user ? await listWorkspaces() : [];

  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full`}>
      <body className="h-full antialiased">
        <AppShell workspaces={workspaces} user={user}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}