/**
 * Date and time formatting — one implementation, used everywhere.
 *
 * The house standard is Singapore: DD/MM/YYYY and 24-hour HH:MM, rendered in
 * Asia/Singapore regardless of where the browser or server happens to sit. A
 * bare `toLocaleDateString()` follows the viewer's locale and silently renders
 * US M/D/YYYY for many of them, which is why `scripts/ui-guard.mjs` fails the
 * lint on locale-less calls.
 */

const LOCALE = 'en-GB';
const TZ = 'Asia/Singapore';

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `10/08/2026` */
export function formatDate(value: string | number | Date, fallback = '—'): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString(LOCALE, { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** `10/08/2026 21:45` */
export function formatDateTime(value: string | number | Date, fallback = '—'): string {
  const date = toDate(value);
  if (!date) return fallback;
  const day = formatDate(date);
  return `${day} ${formatTime(date)}`;
}

/** `21:45` — 24-hour, Singapore time. */
export function formatTime(value: string | number | Date, fallback = '—'): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleTimeString(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The hour (0–23) in Singapore, so a greeting matches the reader's day rather
 * than whatever timezone the server happens to run in. */
export function hourInSingapore(now: Date = new Date()): number {
  return Number(now.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }));
}

/**
 * Display label for a machine identifier: `legal_entity_name` → `Legal entity name`.
 *
 * Never a replacement — every surface that shows a humanised label should keep the
 * identifier visible too, because the identifier is what the Pack spec, the runtime
 * and any audit trail actually refer to. Raw `snake_case` on its own is the single
 * loudest tell that a screen was generated from a schema rather than designed.
 */
export function humanise(raw: string): string {
  const text = raw.trim().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ');
  if (!text) return raw;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
