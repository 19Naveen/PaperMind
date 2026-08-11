import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { THEME_BOOTSTRAP } from '@/components/theme';
import { RAIL_BOOTSTRAP } from '@/components/rail';
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
  // The shell must render even when the API is unreachable or answers with
  // something unexpected. This layout wraps EVERY route, so an exception thrown
  // here 500s the whole app — including /login and the error page itself, which
  // leaves a visitor with no way back in. Treat any failure as "signed out" and
  // let the individual pages report their own trouble.
  const user = await getMe().catch(() => null);
  const workspaces = user ? await listWorkspaces().catch(() => []) : [];

  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Both of these resolve a stored preference onto <html> before first paint,
            so a returning visitor never sees the default state flash first: the
            theme (white → dark) and the nav rail (wide → collapsed). They belong
            here rather than in a component — <head> executes during parsing, ahead
            of any markup, and a <script> rendered by a client component is never
            executed on the client anyway. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <script dangerouslySetInnerHTML={{ __html: RAIL_BOOTSTRAP }} />
      </head>
      <body className="h-full antialiased">
        <AppShell workspaces={workspaces} user={user}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}