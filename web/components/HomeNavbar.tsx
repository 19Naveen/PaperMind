'use client';

import { usePathname } from 'next/navigation';
import { HomeAccountMenu } from '@/components/HomeAccountMenu';
import { IconBell, IconMenu, IconSearch } from '@/lib/icons';

/** Reference top bar: mobile menu, route-aware crumb, and top actions. */
export function HomeNavbar({ onOpenNavigation }: { onOpenNavigation?: () => void }) {
  const pathname = usePathname();
  const crumb =
    pathname === '/'
      ? 'Overview'
      : pathname.startsWith('/marketplace')
        ? 'Marketplace'
        : pathname.startsWith('/workspace')
          ? 'Workspace'
          : pathname === '/profile'
            ? 'Profile'
            : pathname === '/settings'
              ? 'Settings'
              : 'PaperMind';

  return (
    <header className="topbar">
      <button className="iconbtn menuBtn" aria-label="Open navigation" onClick={onOpenNavigation}>
        <IconMenu className="ic" />
      </button>
      <nav className="crumbs" aria-label="Breadcrumb">
        <span aria-current="page">{crumb}</span>
      </nav>
      <div className="top-actions">
        <span className="searchbtn" aria-label="Search will be available soon">
          <IconSearch className="ic sm" />
          <span className="lbl">Search</span>
          <kbd>⌘K</kbd>
        </span>
        <span className="iconbtn" aria-label="Notifications will be available soon" style={{ cursor: 'default' }}>
          <IconBell className="ic" />
        </span>
        <HomeAccountMenu />
      </div>
    </header>
  );
}
