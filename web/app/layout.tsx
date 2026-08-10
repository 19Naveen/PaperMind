import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { THEME_BOOTSTRAP } from '@/components/theme';
import { getMe, listWorkspaces } from '@/lib/api';

// Variable faces — no `weight` array, so the full 100–900 axis ships and the
// design system's 400/500/600/700 steps all resolve to real instances. The
// `variable` names below are the ONLY handle on these fonts: globals.css reads
// them via var(--font-inter) / var(--font-jetbrains). Asking for the literal
// family "Inter" matches nothing unless the viewer has it installed locally.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], display: 'swap' });

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
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Resolves the stored/system theme onto <html data-theme> before first
            paint, so a dark-mode visitor never sees a white flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="h-full antialiased">
        <AppShell workspaces={workspaces} user={user}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}