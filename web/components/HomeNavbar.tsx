'use client';

import { usePathname } from 'next/navigation';
import { useRail } from '@/components/rail';
import { IconButton } from '@/components/ui';
import { IconBell, IconMenu, IconSearch, IconSidebar } from '@/lib/icons';

/**
 * Top bar: navigation controls on the left, utilities on the right. It carries no
 * account affordance — that lives once, in the rail footer (components/HomeAccountMenu).
 */
export function HomeNavbar({ onOpenNavigation }: { onOpenNavigation?: () => void }) {
  const pathname = usePathname();
  const { collapsed, toggle } = useRail();
  const crumb =
    pathname === '/'
      ? 'Overview'
      : pathname.startsWith('/marketplace')
        ? 'Marketplace'
        : pathname.startsWith('/workspace')
          ? 'Workspace'
          : pathname === '/settings' || pathname === '/profile'
            ? 'Account'
            : 'PaperMind';

  const railLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <header className="topbar">
      <button className="iconbtn menuBtn" aria-label="Open navigation" onClick={onOpenNavigation}>
        <IconMenu className="ic" />
      </button>
      {/*
        The desktop rail toggle. Hidden ≤980px, where the rail is a drawer and
        `.menuBtn` above is the control. `IconSidebar` depicts the rail itself, so the
        icon needs no rotation to read in either state.
      */}
      <IconButton
        className="railBtn"
        icon={<IconSidebar className="ic" />}
        label={railLabel}
        onClick={toggle}
        expanded={!collapsed}
        controls="app-sidebar"
      />
      <nav className="crumbs" aria-label="Breadcrumb">
        <span aria-current="page">{crumb}</span>
      </nav>
      <div className="top-actions">
        <span className="searchbtn" role="button" aria-disabled="true" aria-label="Search will be available soon">
          <IconSearch className="ic sm" />
          <span className="lbl">Search</span>
          <kbd>⌘K</kbd>
        </span>
        <span className="iconbtn" role="button" aria-disabled="true" aria-label="Notifications will be available soon" style={{ cursor: 'default' }}>
          <IconBell className="ic" />
        </span>
      </div>
    </header>
  );
}
