'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconMenu } from '@/lib/icons';
import { HomeAccountMenu } from '@/components/HomeAccountMenu';

/** The standalone dashboard navigation: stable height, primary links left, account right. */
export function HomeNavbar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  return (
    <header className="h-[60px] shrink-0 border-b border-[#e7e7eb] bg-white/90 backdrop-blur-md">
      <div className="flex h-full items-center px-4 sm:px-[22px]">
        <button type="button" aria-label="Open navigation" onClick={onMenu} className="mr-2 inline-flex size-8 items-center justify-center rounded-md text-[#52525b] hover:bg-[#f0f1f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bd6] md:hidden">
          <IconMenu width={18} height={18} />
        </button>
        <Link href="/" className="flex items-center gap-2.5 pr-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bd6]">
          <span className="grid size-[29px] place-items-center rounded-lg bg-[#5b5bd6] text-white">P</span>
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#18181b]">PaperMind</span>
        </Link>
        <span className="hidden h-6 w-px bg-[#e7e7eb] sm:block" aria-hidden />
        <nav className="ml-2 flex h-full items-stretch sm:ml-3" aria-label="Primary navigation">
          <Link href="/marketplace" aria-current={pathname === '/marketplace' ? 'page' : undefined} className={`flex items-center border-b-2 px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5b5bd6] ${pathname === '/marketplace' ? 'border-[#5b5bd6] text-[#4f4fc6]' : 'border-transparent text-[#52525b] hover:bg-[#eeeeff] hover:text-[#18181b]'}`}>
            Marketplace
          </Link>
        </nav>
        <div className="ml-auto flex items-center"><HomeAccountMenu /></div>
      </div>
    </header>
  );
}
