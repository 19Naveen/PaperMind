import { redirect } from 'next/navigation';

/**
 * `/profile` and `/settings` were two halves of one account surface; they are now
 * one page at `/settings` (see that file for why it is the canonical URL). This
 * route stays alive because links to it exist in the wild — and in old sessions —
 * and a 404 is a worse answer than the page the visitor was asking for.
 */
export default function ProfileRedirect(): never {
  redirect('/settings');
}
