'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  PackAuditEventOut,
  PackReleaseOut,
  PackReviewOut,
  ReleaseEnvironment,
} from '@/lib/api';
import {
  decideReviewAction,
  promoteReleaseAction,
  restoreReleaseAction,
  submitReviewAction,
} from '@/lib/session';
import { ActionButton, Panel, Tag } from '@/components/ui';

const ENV_ORDER: ReleaseEnvironment[] = ['development', 'staging', 'production'];

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '—';
}

type ActionOutcome<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** The governance / release lifecycle panel for a Pack's marketplace detail page.
 * Fetched data arrives as props (server-side) so empty lists and API errors render
 * honestly; every action refreshes in place, never redirects. */
export function ReleasePanel({
  packId,
  latestVersionId,
  latestVersion,
  revisionId,
  reviews,
  reviewsError,
  releases,
  releasesError,
  audit,
  auditError,
}: {
  packId: string;
  latestVersionId: string | null;
  latestVersion: number;
  /** A draft revision to offer for review, when the page was given one. */
  revisionId?: string | null;
  reviews: PackReviewOut[] | null;
  reviewsError: string | null;
  releases: PackReleaseOut[] | null;
  releasesError: string | null;
  audit: PackAuditEventOut[] | null;
  auditError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<ActionOutcome<T>>) {
    setBusy(key);
    setError(null);
    try {
      const outcome = await fn();
      if (!outcome.ok) setError(outcome.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  }

  const versionReleases = (releases ?? []).filter((r) => r.pack_version_id === latestVersionId);
  const releasedTo = new Set(versionReleases.map((r) => r.environment));
  const promoteTarget = ENV_ORDER.find((env) => !releasedTo.has(env)) ?? null;

  return (
    <div className="space-y-3">
      <p className="eyebrow">Release</p>

      <Panel title="Review" count={reviews?.length ?? 0}>
        {reviewsError ? (
          <p className="text-[12.5px] leading-relaxed text-missing">{reviewsError}</p>
        ) : (
          <>
            {reviews && reviews.length === 0 && (
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                No reviews submitted yet.
              </p>
            )}
            {reviews && reviews.length > 0 && (
              <ul className="divide-y divide-rule">
                {reviews.map((review) => (
                  <li key={review.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-data text-[12px] text-ink">revision {shortId(review.revision_id)}</p>
                      <p className="text-[11px] text-ink-3">
                        {new Date(review.submitted_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Tag
                        variant={
                          review.state === 'approved' ? 'accent' : review.state === 'rejected' ? 'danger' : 'warn'
                        }
                      >
                        {review.state}
                      </Tag>
                      {review.state === 'pending' && (
                        <>
                          <ActionButton
                            size="sm"
                            variant="primary"
                            disabled={busy !== null}
                            onClick={() => void run(`decide:${review.id}`, () => decideReviewAction(packId, review.id, true))}
                          >
                            Approve
                          </ActionButton>
                          <ActionButton
                            size="sm"
                            variant="danger"
                            disabled={busy !== null}
                            onClick={() => void run(`decide:${review.id}`, () => decideReviewAction(packId, review.id, false))}
                          >
                            Reject
                          </ActionButton>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {revisionId ? (
              <div className="mt-3 border-t border-rule pt-3">
                <p className="mb-2 text-[12px] leading-relaxed text-ink-2">
                  Submit draft revision <span className="font-data">{shortId(revisionId)}</span> for review.
                </p>
                <ActionButton
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run('submit', () => submitReviewAction(packId, revisionId))}
                >
                  {busy === 'submit' ? 'Submitting…' : 'Submit draft for review'}
                </ActionButton>
              </div>
            ) : (
              <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-3">
                No draft revision is open on this page. Author a draft in the studio, then submit it for review here.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Promote" count={latestVersionId ? `v${latestVersion}` : undefined}>
        {!latestVersionId ? (
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            No frozen version to promote yet — approve a version first.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {ENV_ORDER.map((env) => {
                const done = releasedTo.has(env);
                const blocked = promoteTarget !== null && env !== promoteTarget && !done;
                return (
                  <ActionButton
                    key={env}
                    size="sm"
                    variant={done ? 'default' : 'primary'}
                    disabled={done || blocked || busy !== null}
                    onClick={() => void run(`promote:${env}`, () => promoteReleaseAction(packId, latestVersionId, env))}
                  >
                    {done ? `In ${env}` : `Promote to ${env}`}
                  </ActionButton>
                );
              })}
            </div>
            {releasedTo.size > 0 && promoteTarget !== null && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                Promotion is forward-only: {promoteTarget} needs the prior environment released for this version first.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Release history" count={releases?.length ?? 0}>
        {releasesError ? (
          <p className="text-[12.5px] leading-relaxed text-missing">{releasesError}</p>
        ) : releases && releases.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-ink-2">No releases recorded yet.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {releases?.map((release) => (
              <li key={release.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-data text-[12px] text-ink">
                    <Tag variant="outline">{release.environment}</Tag>
                    {release.action}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {new Date(release.created_at).toLocaleString()}
                  </p>
                </div>
                <ActionButton
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void run(`restore:${release.id}`, () => restoreReleaseAction(packId, release.id))}
                >
                  Restore
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Audit trail" count={audit?.length ?? 0}>
        {auditError ? (
          <p className="text-[12.5px] leading-relaxed text-missing">{auditError}</p>
        ) : audit && audit.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-ink-2">No audit events yet.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {audit?.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-data text-[12px] text-ink">{event.event_type}</p>
                  <p className="text-[11px] text-ink-3">
                    {event.environment ? `${event.environment} · ` : ''}
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                </div>
                {event.release_id && (
                  <span className="shrink-0 font-data text-[10px] text-ink-3">rel {shortId(event.release_id)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {error && <p className="text-[12.5px] leading-relaxed text-missing">{error}</p>}
    </div>
  );
}
