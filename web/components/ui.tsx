import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconChevronRight } from '@/lib/icons';

// ---------------------------------------------------------------------------
// Premium2.0 primitives — thin React wrappers over the canonical prototype
// class vocabulary in app/globals.css (.btn, .card, .input, .tag, .pill, ...).
// APIs stay stable; rendering is reference-faithful.
// ---------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
  compact = false,
}: {
  eyebrow?: string;
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Render the heading and actions on one row (inline). */
  compact?: boolean;
}) {
  return (
    <div className={`page-head${compact ? ' page-head--compact' : ''}`}>
      {(eyebrow || title || meta) && (
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          {title && <h1 className="page-title">{title}</h1>}
          {meta && <div className="page-sub">{meta}</div>}
        </div>
      )}
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input — the one labelled text field (.field + .input).
// ---------------------------------------------------------------------------

export function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  size = 'md',
  className = '',
  id,
  disabled = false,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="flbl">{label}</span>}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className={`input${size === 'sm' ? ' sm' : ''}`}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Buttons — .btn with primary (dark), secondary, outline, ghost, danger.
// ---------------------------------------------------------------------------

type ButtonVariant = 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

function btnClass(variant: ButtonVariant, size: ButtonSize, className = ''): string {
  const v = variant === 'default' ? 'secondary' : variant;
  return `btn ${v}${size === 'sm' ? ' sm' : ''} ${className}`.trim();
}

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
      className={`${btnClass(variant, size, className)}${href === '#' ? ' disabled' : ''}`}
    >
      {icon}
      {children}
      {external && <IconChevronRight className="ic sm" />}
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
    <button type={type} onClick={onClick} disabled={disabled} className={`${btnClass(variant, size)} ${className}`.trim()}>
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cards and surfaces — .card / .card-hd.
// ---------------------------------------------------------------------------

export function Card({ children, className = '', pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={`card ${pad ? 'card-pad' : ''} ${className}`.trim()}>{children}</div>;
}

export function CardKicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`.trim()}>{children}</p>;
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`ct ${className}`.trim()}>{children}</p>;
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`cbd ${className}`.trim()}>{children}</p>;
}

export function CardMeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`cardmeta ${className}`.trim()}>{children}</div>;
}

export function CardHeader({ title, icon, count, action }: { title: string; icon?: ReactNode; count?: number | string; action?: ReactNode }) {
  return (
    <div className="card-hd">
      <p className="chd-title">
        {icon}
        {title}
        {count !== undefined && <span className="chd-count">{String(count)}</span>}
      </p>
      {action}
    </div>
  );
}

export function Panel({
  title,
  count,
  icon,
  action,
  children,
  className = '',
}: {
  title: string;
  count?: number | string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      <div className="card-hd">
        <p className="chd-title">
          {icon}
          {title}
          {count !== undefined && <span className="chd-count">{String(count)}</span>}
        </p>
        {action}
      </div>
      <div className="card-pad">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data table cells — .gtable chrome.
// ---------------------------------------------------------------------------

export function Th({ children, className = '', align = 'left' }: { children: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <th className={`gth ${align === 'right' ? 'r' : ''} ${className}`.trim()}>{children}</th>;
}

export function Td({ children, className = '', align = 'left' }: { children: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <td className={`gtd ${align === 'right' ? 'r' : ''} ${className}`.trim()}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Tags — .tag (neutral / acc / out / warn / danger).
// ---------------------------------------------------------------------------

type TagVariant = 'accent' | 'neutral' | 'outline' | 'warn' | 'danger';
const TAG_V: Record<TagVariant, string> = {
  accent: 'acc',
  neutral: '',
  outline: 'out',
  warn: 'warn',
  danger: 'danger',
};

export function Tag({ variant = 'neutral', children, className = '' }: { variant?: TagVariant; children: ReactNode; className?: string }) {
  return <span className={`tag ${TAG_V[variant]} ${className}`.trim()}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Segmented control — .seg.
// ---------------------------------------------------------------------------

export function Seg<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — .card.empty.
// ---------------------------------------------------------------------------

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card empty">
      {icon && <span className="e-ic">{icon}</span>}
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat block — .stat (.s-l / .s-v / .s-d). Use `bare` inside a `.card.stats` grid.
// ---------------------------------------------------------------------------

export type Tone = 'default' | 'verified' | 'unsupported' | 'missing' | 'running' | 'accent';
const TONE_VAR: Record<Tone, string> = {
  default: 'var(--ink)',
  verified: 'var(--ok)',
  unsupported: 'var(--warn)',
  missing: 'var(--danger)',
  running: 'var(--accent)',
  accent: 'var(--accent)',
};

export function Stat({ label, value, tone = 'default', sub, bare = false }: { label: string; value: ReactNode; tone?: Tone; sub?: ReactNode; bare?: boolean }) {
  const cell = (
    <>
      <div className="s-l">{label}</div>
      <div className="s-v" style={{ color: TONE_VAR[tone] }}>{value}</div>
      {sub && <div className="s-d">{sub}</div>}
    </>
  );
  if (bare) return <div className="stat">{cell}</div>;
  return (
    <div className="card">
      <div className="stat" style={{ borderLeft: 0 }}>{cell}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KV row — .kv.
// ---------------------------------------------------------------------------

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status pill — .pill with a dot.
// ---------------------------------------------------------------------------

export type PillTone = 'running' | 'verified' | 'missing' | 'neutral' | 'accent';
const PILL_V: Record<PillTone, string> = {
  running: 'run',
  verified: 'ok',
  missing: 'dgr',
  neutral: 'neutral',
  accent: 'run',
};

export function Pill({ tone = 'neutral', children, dot }: { tone?: PillTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`pill ${PILL_V[tone]}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress — thin .pipe-progress bar.
// ---------------------------------------------------------------------------

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <div className={`pipe-progress ${className}`.trim()} role="progressbar" aria-valuenow={w} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`divider ${className}`.trim()} />;
}

export function Avatar({ initials = 'PM', className = '' }: { initials?: string; className?: string }) {
  return <span className={`avatar ${className}`.trim()}>{initials}</span>;
}
