'use server';

/**
 * Auth Server Actions.
 *
 * The browser never holds a backend token (CLAUDE.md §4.1): the action calls
 * FastAPI server-to-server, lifts the `Set-Cookie` it issues, and re-sets the
 * same httpOnly cookie on the Next.js origin so subsequent requests carry it.
 *
 * Failures are returned, not thrown, so the forms can map them back to fields
 * by `code` (§4.4).
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ApiError,
  SESSION_COOKIE,
  approvePackVersion,
  changePassword,
  createPack,
  createStudioSession,
  createWorkspace,
  createWorkspaceSession,
  decideGovernanceReview,
  deleteWorkspace,
  deleteWorkspaceSession,
  fieldErrors,
  installWorkspacePack,
  listStudioRevisions,
  login,
  logout,
  promotePackRelease,
  restorePackRelease,
  runSession,
  signup,
  studioPreview,
  submitGovernanceReview,
  updateMe,
  updateWorkspace,
  updateWorkspaceSession,
  uploadDocument,
  apiFetch,
} from './api';
import type {
  DocumentOut,
  GovernanceDecisionOut,
  PackReleaseOut,
  PackReviewOut,
  ReleaseEnvironment,
  StudioDraftRevisionOut,
  StudioPreviewOut,
} from './api';

export interface AuthFailure {
  code: string;
  message: string;
  /** Per-field messages, keyed by field name. Empty unless `code` is `VALIDATION_ERROR`. */
  fields: Record<string, string>;
}

/** Re-issue FastAPI's session cookie on this origin, honouring its Max-Age. */
async function adoptSessionCookie(setCookie: string | null): Promise<void> {
  const value = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!value) throw new Error('auth succeeded but the API set no session cookie');
  const maxAge = Number(setCookie?.match(/Max-Age=(\d+)/i)?.[1] ?? 60 * 60 * 24 * 14);
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
}

function failure(error: unknown): AuthFailure {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, fields: fieldErrors(error) };
  }
  throw error;
}

export async function signInAction(
  _prev: AuthFailure | null,
  input: { email: string; password: string },
): Promise<AuthFailure | null> {
  try {
    await adoptSessionCookie((await login(input.email, input.password)).setCookie);
  } catch (error) {
    return failure(error);
  }
  redirect('/');
}

export async function signUpAction(
  _prev: AuthFailure | null,
  input: { name: string; email: string; password: string },
): Promise<AuthFailure | null> {
  try {
    await adoptSessionCookie((await signup(input.email, input.name, input.password)).setCookie);
  } catch (error) {
    return failure(error);
  }
  redirect('/');
}

/** Creates a workspace, optionally installing a chosen Pack into it, and opens it. */
export async function createWorkspaceAction(name: string, goal: string, packId?: string): Promise<never> {
  const workspace = await createWorkspace(name, goal);
  if (packId) await installWorkspacePack(workspace.id, packId);
  redirect(`/workspace/${workspace.id}`);
}

/** Adds a draft session to a workspace and refreshes its overview in place. Bind `workspaceId` for use as a `<form action>`. */
export async function createSessionAction(workspaceId: string, formData: FormData): Promise<never> {
  const title = String(formData.get('title') ?? '').trim() || 'Untitled session';
  const session = await createWorkspaceSession(workspaceId, title);
  redirect(`/workspace/${workspaceId}/sessions/${session.id}`);
}

/** Uploads a document through the ingest pipeline and returns its id for the run. */
export async function uploadDocumentAction(formData: FormData): Promise<DocumentOut> {
  return uploadDocument(formData);
}

/** Kicks off the runtime engine for a session; the page polls the run route while it works. */
export async function startRunAction(
  workspaceId: string,
  sessionId: string,
  documentIds: string[],
): Promise<void> {
  await runSession(workspaceId, sessionId, documentIds);
  revalidatePath(`/workspace/${workspaceId}/sessions/${sessionId}`);
}

/** Appends a correction. Corrections are written, never applied (§8 of the plan). */
export async function correctFactAction(
  workspaceId: string,
  runId: string,
  factId: string,
  userValue: string,
  note?: string,
): Promise<void> {
  await apiFetch(`/runs/${runId}/corrections`, {
    method: 'POST',
    body: JSON.stringify({ fact_id: factId, user_value: userValue, note: note ?? null }),
  });
  revalidatePath(`/workspace/${workspaceId}`);
}

/** Claims a Pack for a workspace from the Marketplace. */
export async function installPackAction(workspaceId: string, packId: string): Promise<void> {
  await installWorkspacePack(workspaceId, packId);
  revalidatePath('/marketplace');
  revalidatePath(`/workspace/${workspaceId}`);
}

/** Edits a workspace's name/goal in place. */
export async function updateWorkspaceAction(
  workspaceId: string,
  patch: { name?: string; goal?: string },
): Promise<void> {
  await updateWorkspace(workspaceId, patch);
  revalidatePath(`/workspace/${workspaceId}`);
  revalidatePath('/');
}

/** Deletes a workspace after an explicit client-side confirmation, then returns home. */
export async function deleteWorkspaceAction(workspaceId: string): Promise<never> {
  await deleteWorkspace(workspaceId);
  revalidatePath('/');
  redirect('/');
}

/** Edits a session's title/subject in place. */
export async function updateSessionAction(
  workspaceId: string,
  sessionId: string,
  patch: { title?: string; subject?: string },
): Promise<void> {
  await updateWorkspaceSession(workspaceId, sessionId, patch);
  revalidatePath(`/workspace/${workspaceId}/sessions/${sessionId}`);
}

/** Deletes one session after the client has completed an explicit confirmation. */
export async function deleteSessionAction(workspaceId: string, sessionId: string): Promise<never> {
  await deleteWorkspaceSession(workspaceId, sessionId);
  revalidatePath(`/workspace/${workspaceId}`);
  redirect(`/workspace/${workspaceId}`);
}

// ------------------------------------------------------------------- profile

export interface ProfileFailure {
  code: string;
  message: string;
  /** Per-field messages for VALIDATION_ERROR / WRONG_PASSWORD. */
  fields: Record<string, string>;
}

export async function updateMeAction(input: { name?: string; email?: string }): Promise<ProfileFailure | null> {
  try {
    await updateMe(input);
  } catch (error) {
    if (error instanceof ApiError) {
      return { code: error.code, message: error.message, fields: fieldErrors(error) };
    }
    throw error;
  }
  revalidatePath('/settings');
  return null;
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ProfileFailure | null> {
  try {
    await changePassword(input.currentPassword, input.newPassword);
  } catch (error) {
    if (error instanceof ApiError) {
      return { code: error.code, message: error.message, fields: fieldErrors(error) };
    }
    throw error;
  }
  return null;
}

// ---------------------------------------------------------- pack authoring flow

/** Author → approve → install, one action: creates the Pack, freezes the studio draft as
 * its first version, claims it for the workspace, and opens the workspace. */
export async function approveAndInstallAction(
  workspaceId: string,
  studioSessionId: string,
  packName: string,
): Promise<never> {
  const pack = await createPack(packName);
  await approvePackVersion(pack.id, studioSessionId);
  await installWorkspacePack(workspaceId, pack.id);
  revalidatePath(`/workspace/${workspaceId}`);
  revalidatePath(`/workspace/${workspaceId}/pack`);
  redirect(`/workspace/${workspaceId}`);
}

/** Creates the studio conversation a workspace's pack page authors against. */
export async function createStudioSessionAction(input: {
  title: string;
  workspaceId?: string;
  packId?: string;
  basePackVersionId?: string;
}): Promise<string> {
  const session = await createStudioSession({
    title: input.title,
    workspace_id: input.workspaceId ?? null,
    pack_id: input.packId ?? null,
    base_pack_version_id: input.basePackVersionId ?? null,
  });
  return session.id;
}

/** Approves the studio draft as a NEW frozen version of an existing Pack (append-only
 * editing) and returns to the pack's detail page. */
export async function approveNewVersionAction(
  packId: string,
  studioSessionId: string,
  backTo: string,
): Promise<never> {
  await approvePackVersion(packId, studioSessionId);
  revalidatePath('/marketplace');
  revalidatePath(`/marketplace/${packId}`);
  redirect(backTo);
}

// ---------------------------------------------------- studio revision lifecycle

/** Lists a studio session's draft revisions (newest first) so a reload can hydrate the
 * current workflow / diff / validation. */
export async function listStudioRevisionsAction(sessionId: string): Promise<StudioDraftRevisionOut[]> {
  return listStudioRevisions(sessionId);
}

/** Uniform outcome of an inline-feedback action: real data on success, or a stable
 * `code` + `message` pair on a controlled API failure (no redirect, no thrown error). */
export type StudioActionOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

async function studioAction<T>(fn: () => Promise<T>): Promise<StudioActionOutcome<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

/** Dry-run the studio draft against documents. Returns real preview facts, or the API's
 * honest error (e.g. no draft yet, no documents selected). */
export async function studioPreviewAction(
  sessionId: string,
  documentIds: string[],
): Promise<StudioActionOutcome<StudioPreviewOut>> {
  return studioAction(() => studioPreview(sessionId, documentIds));
}

// ---------------------------------------------------- governance / release lifecycle

/** Submit a draft revision for governance review. Inline feedback; the marketplace page
 * revalidates so the pending review appears. */
export async function submitReviewAction(
  packId: string,
  revisionId: string,
): Promise<StudioActionOutcome<PackReviewOut>> {
  try {
    const review = await submitGovernanceReview(packId, revisionId);
    revalidatePath(`/marketplace/${packId}`);
    revalidatePath('/marketplace');
    return { ok: true, data: review };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

/** Approve or reject a pending review. Approval freezes a new immutable version. */
export async function decideReviewAction(
  packId: string,
  reviewId: string,
  approve: boolean,
): Promise<StudioActionOutcome<GovernanceDecisionOut>> {
  try {
    const outcome = await decideGovernanceReview(reviewId, approve);
    revalidatePath(`/marketplace/${packId}`);
    return { ok: true, data: outcome };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

/** Promote a frozen version into an environment (development → staging → production).
 * The API enforces the forward-only ordering; its message is surfaced inline. */
export async function promoteReleaseAction(
  packId: string,
  packVersionId: string,
  environment: ReleaseEnvironment,
): Promise<StudioActionOutcome<PackReleaseOut>> {
  try {
    const release = await promotePackRelease(packId, packVersionId, environment);
    revalidatePath(`/marketplace/${packId}`);
    return { ok: true, data: release };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

/** Forward-only restore of a historical release into its environment. */
export async function restoreReleaseAction(
  packId: string,
  releaseId: string,
): Promise<StudioActionOutcome<PackReleaseOut>> {
  try {
    const release = await restorePackRelease(releaseId);
    revalidatePath(`/marketplace/${packId}`);
    return { ok: true, data: release };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

export async function signOutAction(): Promise<void> {
  // Best effort on the API side; the local cookie goes regardless, so a dead
  // backend can never trap a user in a signed-in shell.
  try {
    await logout();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
