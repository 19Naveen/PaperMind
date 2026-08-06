import Link from 'next/link';
import { HomeAccountMenu } from '@/components/HomeAccountMenu';

/** The standalone dashboard navigation: stable height, primary links left, account right. */
export function HomeNavbar() {
  return (
    <header className="h-16 shrink-0 border-b-2 border-rule bg-ground">
      <div className="flex h-full items-center px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 pr-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span className="size-3.5 bg-accent" />
          <span className="font-display text-[16px] font-extrabold tracking-[0.14em] text-ink">PAPERMIND</span>
        </Link>

        <span className="hidden h-6 w-px bg-rule sm:block" aria-hidden />

        <nav className="ml-2 flex h-full items-stretch sm:ml-3" aria-label="Primary navigation">
          <Link
            href="/marketplace"
            className="flex items-center border-b-2 border-accent px-3 text-[13px] font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            Marketplace
          </Link>
        </nav>

        <div className="ml-auto flex items-center"><HomeAccountMenu /></div>
      </div>
    </header>
  );
}
