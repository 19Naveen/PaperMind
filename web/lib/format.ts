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
