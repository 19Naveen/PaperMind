/**
 * Inline icon set — stroke-based, lucide-style, currentColor. No dependency;
 * the set stays small and grows only when a real surface needs it.
 */
import type { SVGProps } from 'react';

function svg(paths: React.ReactNode): (props: SVGProps<SVGSVGElement>) => React.JSX.Element {
  return function Icon(props) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        width="16"
        height="16"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const IconHome = svg(<path d="M3 10.2 12 3l9 7.2M5.5 9v11h13V9M10 20v-5h4v5" />);
export const IconLibrary = svg(
  <>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13A2.5 2.5 0 0 1 6.5 22H20v-2.5" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </>,
);
export const IconFolder = svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />);
export const IconLayers = svg(
  <>
    <path d="m12 2 9 5-9 5-9-5 9-5z" />
    <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
  </>,
);
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>,
);
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />);
export const IconArrowRight = svg(<path d="M5 12h14m-6-6 6 6-6 6" />);
export const IconArrowLeft = svg(<path d="M19 12H5m6-6-6 6 6 6" />);
export const IconChevronRight = svg(<path d="m9 6 6 6-6 6" />);
export const IconChevronDown = svg(<path d="m6 9 6 6 6-6" />);
export const IconCheck = svg(<path d="M4.5 12.5 10 18 19.5 6.5" />);
export const IconAlert = svg(
  <>
    <path d="M12 3 2.5 20h19L12 3z" />
    <path d="M12 9.5V14M12 17h.01" />
  </>,
);
export const IconClose = svg(<path d="M6 6l12 12M18 6 6 18" />);
export const IconMenu = svg(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconSliders = svg(
  <>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h8M16 18h4" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="14" cy="18" r="2" />
  </>,
);
export const IconSettings = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);
export const IconSparkle = svg(
  <path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M18.4 5.6l-2.5 2.5M8.1 15.9l-2.5 2.5" />,
);
export const IconClock = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </>,
);
export const IconBriefcase = svg(
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M2 13h20M2 17h20" />
  </>,
);
export const IconFile = svg(
  <>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6l-5-4z" />
    <path d="M14 2v4h4M9 13h6M9 17h6" />
  </>,
);
export const IconFlag = svg(<path d="M5 21V4M5 4c4-2 6 2 10 0 2-1 4 0 4 0v9c-2-1-4-1-6 0-3 1-6-1-8 0" />);
export const IconTarget = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.2" />
  </>,
);
export const IconPlay = svg(<path d="M7 4.5v15l12-7.5-12-7.5z" />);
export const IconStop = svg(<path d="M7 7h10v10H7z" />);
export const IconRefresh = svg(
  <>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v5h-5" />
  </>,
);
export const IconGrid = svg(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </>,
);
export const IconRows = svg(
  <>
    <path d="M4 5h16M4 12h16M4 19h16" />
  </>,
);
/** A panel with its side rail — the nav-rail collapse toggle. Reads as the thing
 * it acts on, so it needs no rotation to mean "collapse" or "expand". */
export const IconSidebar = svg(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </>,
);
/** Rename. */
export const IconPencil = svg(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </>,
);
/** Delete. Paired with a confirmation everywhere it appears. */
export const IconTrash = svg(
  <>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    <path d="M10 11v5M14 11v5" />
  </>,
);
export const IconBarChart = svg(
  <>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </>,
);
export const IconBell = svg(
  <>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>,
);
export const IconUser = svg(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-3.5 4-5 8-5s6.5 1.5 8 5" />
  </>,
);
export const IconCommand = svg(<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />);
export const IconDoc = svg(
  <>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6l-5-4z" />
    <path d="M14 2v4h4" />
  </>,
);
export const IconMore = svg(
  <>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </>,
);
export const IconExternal = svg(
  <>
    <path d="M14 4h6v6M10 14 20 4" />
    <path d="M19 14v6H5V5h6" />
  </>,
);