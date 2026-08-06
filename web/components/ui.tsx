import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FactState } from '@/lib/types';
import { IconChevronRight } from '@/lib/icons';

const STATE: Record<
  FactState,
  { label: string; glyph: string; cls: string; solid: string }
> = {
  verified: {
    label: 'Verified',
    glyph: '✓',
    cls: 'text-verified border-verified/40 bg-verified-soft',
    solid: 'bg-verified text-white',
  },
  unsupported: {
    label: 'Unsupported',
    glyph: '≁',
    cls: 'text-unsupported border-unsupported/40 bg-unsupported-soft',
    solid: 'bg-unsupported text-white',
  },
  missing: {
    label: 'Missing',
    glyph: '✕',
    cls: 'text-missing border-missing/40 bg-missing-soft',
    solid: 'bg-missing text-white',
  },
};

/** Color is never the only signal — each state carries a distinct glyph. */
export function StateBadge({ state, solid }: { state: FactState; solid?: boolean }) {
  const s = STATE[state];
  if (solid) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-none px-1.5 py-px font-data text-[10px] uppercase tracking-wider ${s.solid}`}>
        <span aria-hidden>{s.glyph}</span>
        {s.label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-none border px-1.5 py-px font-data text-[10px] uppercase tracking-wider ${s.cls}`}>
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  );
}

export function stateColor(state: FactState) {
  return `var(--color-${state})`;
}

// ---------------------------------------------------------------------------
// Page header — modernist: 2px rule, accent eyebrow, Archivo 800 title.
// ---------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
  compact = false,
  brand,
  navigation,
  account,
}: {
  eyebrow?: string;
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Align a route title with its actions in one navigation-height row. */
  compact?: boolean;
  /** Optional product mark for standalone, full-width navigation headers. */
  brand?: ReactNode;
  navigation?: ReactNode;
  account?: ReactNode;
}) {
  return (
    <header className={`border-b-2 border-rule bg-ground px-4 sm:px-6 ${compact ? 'py-4' : 'py-[18px]'}`}>
      <div className={`flex flex-wrap justify-between gap-4 ${compact ? 'items-center' : 'items-end'}`}>
        {brand}
        {navigation}
        {(eyebrow || title) && <div className={`min-w-0 ${compact ? 'flex items-baseline gap-2.5' : ''}`}>
          {eyebrow && <p className="eyebrow text-accent">{eyebrow}</p>}
          {title && <h1 className={`display text-[21px] font-extrabold leading-tight text-ink ${compact ? '' : 'mt-1'}`}>{title}</h1>}
          {meta && <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13.5px] text-ink-2">{meta}</div>}
        </div>}
        {(actions || account) && <div className="flex shrink-0 items-center gap-2">{actions}{account}</div>}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Buttons — the prototype's three verbs: primary (accent fill), secondary
// (divider border), ghost (accent text). Sharp corners, Archivo 800.
// ---------------------------------------------------------------------------

type ButtonVariant = 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-none font-display font-extrabold cursor-pointer transition-colors duration-100 active:translate-y-px select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2';
const BTN_SIZES: Record<ButtonSize, string> = {
  sm: 'px-[10px] py-1.5 text-[12.5px]',
  md: 'px-[14px] py-2 text-[13.5px]',
};
const BTN_VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-surface text-ink border border-rule hover:bg-ink/[0.07] disabled:pointer-events-none disabled:opacity-45',
  primary: 'bg-accent text-accent-ink border border-accent hover:bg-accent-600 disabled:pointer-events-none disabled:opacity-45',
  secondary: 'bg-transparent text-ink border border-rule hover:bg-ink/[0.07] disabled:pointer-events-none disabled:opacity-45',
  outline: 'bg-transparent text-accent border border-accent hover:bg-accent/[0.08] disabled:pointer-events-none disabled:opacity-45',
  ghost: 'bg-transparent text-accent border border-transparent hover:bg-accent/[0.1] disabled:pointer-events-none disabled:opacity-45',
  danger: 'bg-missing text-white border border-missing hover:brightness-110 disabled:pointer-events-none disabled:opacity-45',
};

export function Button({
  href,
  children,
  variant = 'outline',
  size = 'md',
  className = '',
  icon,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  icon?: ReactNode;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-disabled={href === '#'}
      className={`${BTN_BASE} ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${href === '#' ? 'pointer-events-none' : ''} ${className}`}
    >
      {icon}
      {children}
      {external && <IconChevronRight className="w-3.5 h-3.5 -mr-0.5" />}
    </Link>
  );
}

export function ActionButton({
  children,
  variant = 'secondary',
  size = 'md',
  onClick,
  disabled,
  type = 'button',
  icon,
  className = '',
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${BTN_BASE} ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cards and surfaces — flat paper: no border, elevation via shadow only.
// ---------------------------------------------------------------------------

export function Card({
  children,
  className = '',
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div
      className={`rounded-none bg-surface shadow-xs ${pad ? 'px-4 py-4' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/** The card kicker — 10px tracked accent label. */
export function CardKicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow font-medium text-accent ${className}`} style={{ color: 'var(--color-accent)' }}>{children}</p>;
}

/** The card title — Archivo 800, sized per context via className. */
export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`display font-extrabold leading-tight text-ink ${className}`}>{children}</p>;
}

/** The card body paragraph — quiet, flexes to fill so meta pins to the bottom. */
export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 flex-1 text-[13px] leading-relaxed text-ink/80 ${className}`}>{children}</p>;
}

/** The card meta row — tiny muteds on a top rule. */
export function CardMeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 border-t border-rule pt-3 text-[11px] text-ink-3 ${className}`}>{children}</div>
  );
}

export function CardHeader({
  title,
  icon,
  count,
  action,
}: {
  title: string;
  icon?: ReactNode;
  count?: number | string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-rule/70 px-4 py-2.5">
      <p className="eyebrow flex items-center gap-1.5">
        {icon}
        {title}
        {count !== undefined && <span className="ml-1 text-ink-3">{String(count)}</span>}
      </p>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel — a titled section card with an optional right-aligned action.
// ---------------------------------------------------------------------------

export function Panel({
  title,
  count,
  icon,
  action,
  children,
  className = '',
  headerClass = '',
}: {
  title: string;
  count?: number | string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClass?: string;
}) {
  return (
    <section className={`rounded-none border border-rule bg-surface shadow-xs ${className}`}>
      <div className={`flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5 ${headerClass}`}>
        <p className="eyebrow flex items-center gap-1.5">
          {icon}
          {title}
          {count !== undefined && <span className="text-ink-3">{String(count)}</span>}
        </p>
        {action}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data table cells — ledger grid with 2px top rules and tracked headers.
// ---------------------------------------------------------------------------

export function Th({ children, className = '', align = 'left' }: { children: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return (
    <th
      className={`border-b-2 border-rule px-4 py-2 text-left font-data text-[10px] font-medium uppercase tracking-[0.1em] text-ink-2 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '', align = 'left' }: { children: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return (
    <td className={`border-b border-rule px-4 py-2.5 align-middle text-[13px] ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Tags — small paper chips: accent, neutral, outline.
// ---------------------------------------------------------------------------

type TagVariant = 'accent' | 'neutral' | 'outline';

const TAG_VARIANTS: Record<TagVariant, string> = {
  accent: 'bg-accent-100 text-accent-800 border-accent-100',
  neutral: 'bg-neutral-100 text-neutral-800 border-neutral-100',
  outline: 'bg-transparent text-accent border-accent',
};

export function Tag({ variant = 'neutral', children, className = '' }: { variant?: TagVariant; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-none border px-[10px] py-[3px] text-[11px] tracking-[0.02em] ${TAG_VARIANTS[variant]} ${className}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Segmented control — radio-group as the prototype's .seg/.seg-opt.
// ---------------------------------------------------------------------------

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden border border-rule">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`px-[12px] py-[7px] text-[13px] font-medium transition-colors ${
            i > 0 ? 'border-l border-rule' : ''
          } ${o.value === value ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-ink/[0.07]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

/** An empty screen is an invitation to act, not a shrug. */
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-none border border-dashed border-rule bg-surface px-6 py-14 text-center">
      {icon && (
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-rule bg-raised text-ink-2">
          {icon}
        </span>
      )}
      <p className="display font-extrabold text-[16px] text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink-2">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** The locator stamp — a citation's permanent address. */
export function Stamp({ children }: { children: React.ReactNode }) {
  return <span className="stamp">{children}</span>;
}

// ---------------------------------------------------------------------------
// Stat block
// ---------------------------------------------------------------------------

export type Tone = 'default' | 'verified' | 'unsupported' | 'missing' | 'running' | 'accent';

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-ink',
  verified: 'text-verified',
  unsupported: 'text-unsupported',
  missing: 'text-missing',
  running: 'text-running',
  accent: 'text-accent',
};

export function Stat({
  label,
  value,
  tone = 'default',
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-none border border-rule bg-surface px-4 py-3 shadow-xs">
      <p className={`display font-extrabold text-[26px] leading-none ${TONE_TEXT[tone]} ${typeof value === 'number' ? 'tabular-nums' : ''}`}>
        {value}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-2">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KV — a labeled data point, table-friendly
// ---------------------------------------------------------------------------

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="eyebrow">{k}</dt>
      <dd className="font-data text-[12.5px] text-ink">{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status pill (operational — running/complete/failed/pending)
// ---------------------------------------------------------------------------

export type PillTone = 'running' | 'verified' | 'missing' | 'neutral';
const PILL: Record<PillTone, string> = {
  running: 'text-running border-running/40 bg-running-soft',
  verified: 'text-verified border-verified/40 bg-verified-soft',
  missing: 'text-missing border-missing/40 bg-missing-soft',
  neutral: 'text-ink-2 border-rule bg-raised',
};

export function Pill({ tone = 'neutral', children, dot }: { tone?: PillTone; children: ReactNode; dot?: boolean }) {
  const pulsed = tone === 'running' ? 'animate-pulse' : '';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-none border px-2 py-0.5 font-data text-[10.5px] uppercase tracking-wider ${PILL[tone]} ${pulsed}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${tone === 'running' ? 'bg-running' : tone === 'verified' ? 'bg-verified' : tone === 'missing' ? 'bg-missing' : 'bg-ink-3'}`} />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 overflow-hidden rounded-none bg-rule/60 ${className}`} role="progressbar" aria-valuenow={w} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${w}%` }} />
    </div>
  );
}

/** A thin full-bleed divider between ledger groups. */
export function Divider({ className = '' }: { className?: string }) {
  return <div className={`border-t border-rule ${className}`} />;
}

// ---------------------------------------------------------------------------
// Token chips
// ---------------------------------------------------------------------------

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-none border border-rule bg-raised px-1.5 py-0.5 font-data text-[11px] text-ink-2 ${className}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export function Avatar({ initials = 'PM', className = '' }: { initials?: string; className?: string }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-none border border-rule bg-raised font-data text-[10px] font-medium text-ink-2 ${className}`}
    >
      {initials}
    </span>
  );
}
