import type { Metadata } from 'next';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { getMe, listWorkspaces } from '@/lib/api';

// The modernist face: one family for body (400) and display (800).
const archivo = Archivo({ variable: '--font-archivo', subsets: ['latin'], weight: ['400', '500', '600', '800'] });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], weight: ['400', '500'] });

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
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable} h-full`}>
      <body className="h-full antialiased">
        <AppShell workspaces={workspaces} user={user}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}