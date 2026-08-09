/**
 * The typed PaperMind API client.
 *
 * SERVER-ONLY. It reads the incoming request cookie via `next/headers` and
 * forwards it to FastAPI, so it can only run in a Server Component, Server
 * Action or Route Handler. (`server-only` is not a dependency of this project
 * and CLAUDE.md forbids adding one — the `next/headers` import already makes a
 * client import fail at build time.)
 *
 * `PAPERMIND_API_URL` is deliberately un-prefixed: the base URL is never needed
 * in the browser, so it must not be `NEXT_PUBLIC_*` (CLAUDE.md §2.5).
 */

import { cookies } from 'next/headers';
import { cache } from 'react';

const BASE_URL = process.env.PAPERMIND_API_URL ?? 'http://localhost:8000';

export const SESSION_COOKIE = 'papermind_session';

// ---------------------------------------------------------------- error shape

/** One pydantic field failure, as carried in `details.fields[]`. */
export interface FieldError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/**
 * The single error envelope of the API (CLAUDE.md §3.4). Branch on `code`,
 * never on `message`.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly status: number;

  constructor(code: string, message: string, details: Record<string, unknown>, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

/**
 * Per-field messages keyed by the last segment of pydantic's `loc`
 * (`["body", "password"]` → `password`). Empty for any non-validation error.
 */
export function fieldErrors(error: ApiError): Record<string, string> {
  const fields = error.details.fields;
  if (!Array.isArray(fields)) return {};
  const out: Record<string, string> = {};
  for (const raw of fields as FieldError[]) {
    const key = raw.loc?.[raw.loc.length - 1];
    if (typeof key === 'string' && !(key in out)) out[key] = raw.msg;
  }
  return out;
}

// ------------------------------------------------------------------ transport

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // A non-JSON body means the API is down or a proxy answered — surface it as
    // an unnamed code rather than swallowing it (CLAUDE.md §2.3).
    const body: unknown = await res.json().catch(() => null);
    const envelope =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error: { code?: string; message?: string; details?: Record<string, unknown> } }).error
        : null;
    throw new ApiError(
      envelope?.code ?? `HTTP_${res.status}`,
      envelope?.message ?? res.statusText,
      envelope?.details ?? {},
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetch an API path with the caller's session cookie attached. Throws `ApiError`. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = (await cookies()).get(SESSION_COOKIE);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      // FormData must keep fetch's own multipart boundary, so it gets no content-type.
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(session ? { cookie: `${SESSION_COOKIE}=${session.value}` } : {}),
      ...init?.headers,
    },
  });
  return parse<T>(res);
}

/**
 * Like `apiFetch` but returns the raw `Response` — for SSE proxies, where the body is
 * a stream the caller re-serves. Server-only, same cookie forwarding rules.
 */
export async function apiStream(path: string, init?: RequestInit): Promise<Response> {
  const session = (await cookies()).get(SESSION_COOKIE);
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(session ? { cookie: `${SESSION_COOKIE}=${session.value}` } : {}),
      ...init?.headers,
    },
  });
}

// ----------------------------------------------------------------- API models

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'examiner' | 'admin';
}

export interface WorkspaceOut {
  id: string;
  name: string;
  goal: string;
  pack_id: string | null;
  pack_name: string | null;
  pack_version: number | null;
  session_count: number;
  updated_at: string;
}

export interface WorkspaceSessionOut {
  id: string;
  title: string;
  status: string;
  run_id: string | null;
  subject: string | null;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface WorkspaceAssetOut {
  id: string;
  name: string;
  meta: Record<string, unknown> | null;
}

export interface WorkspaceDetailOut extends WorkspaceOut {
  sessions: WorkspaceSessionOut[];
  assets: WorkspaceAssetOut[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ------------------------------------------------------------------------- runs

export interface Citation {
  chunk_id: string;
  quote: string;
  document_id: string;
  document_name: string;
  page: number;
  char_start: number;
  char_end: number;
}

export type FactState = 'verified' | 'unsupported' | 'missing';

export interface Fact {
  id: string;
  case_id: string;
  field: string;
  value: string | null;
  state: FactState;
  citations: Citation[];
}

export interface RunCaseOut {
  id: string;
  subject: string;
}

export interface RunDocumentOut {
  id: string;
  case_id: string;
  name: string;
  doc_type: string | null;
}

export type RunStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface RunOut {
  id: string;
  pack_id: string;
  pack_name: string;
  pack_version: number;
  status: RunStatus;
  stage: string | null;
  started_at: string;
  cases: RunCaseOut[];
  documents: RunDocumentOut[];
  facts: Fact[];
}

// ------------------------------------------------------------------------ packs

export interface PackSpec {
  name: string;
  document_types: string[];
  fields: { name: string; description: string; type: string }[];
  rules: { id: string; description: string }[];
}

export interface PackOut {
  id: string;
  name: string;
  latest_version: number;
  updated_at: string;
}

export interface PackVersionOut {
  id: string;
  version: number;
  created_at: string;
  spec: PackSpec;
}

export interface PackDetailOut {
  pack: PackOut;
  versions: PackVersionOut[];
}

// ---------------------------------------------------------------------- studio

export interface StudioSessionOut {
  id: string;
  pack_id: string | null;
  title: string;
  status: string;
  draft: PackSpec | null;
  created_at: string;
}

// ------------------------------------------------------------------- documents

export interface DocumentOut {
  id: string;
  name: string;
  content_type: string | null;
}

// ---------------------------------------------------------------------- auth
// login/signup are the only calls whose `Set-Cookie` matters, so they hand the
// raw header back for the Server Action to re-issue on the Next.js origin.

async function authenticate(path: string, body: object): Promise<{ user: User; setCookie: string | null }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const user = await parse<User>(res);
  return { user, setCookie: res.headers.get('set-cookie') };
}

export function login(email: string, password: string) {
  return authenticate('/auth/login', { email, password });
}

export function signup(email: string, name: string, password: string) {
  return authenticate('/auth/signup', { email, name, password });
}

export function logout(): Promise<unknown> {
  return apiFetch('/auth/logout', { method: 'POST' });
}

/** The signed-in user, or `null` when the session cookie is absent or stale. */
export const getMe = cache(async (): Promise<User | null> => {
  try {
    return await apiFetch<User>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_AUTHENTICATED') return null;
    throw error;
  }
});

// ----------------------------------------------------------------- workspaces

// The layout and the home page both resolve the same user/workspace list in one
// render pass — React cache() collapses the duplicate into a single fetch.
export const listWorkspaces = cache((limit = 50, offset = 0): Promise<WorkspaceOut[]> => {
  return apiFetch<WorkspaceOut[]>(`/workspaces?limit=${limit}&offset=${offset}`);
});

export const getWorkspace = cache((id: string): Promise<WorkspaceDetailOut> => {
  return apiFetch<WorkspaceDetailOut>(`/workspaces/${id}`);
});

export function createWorkspace(name: string, goal: string): Promise<WorkspaceOut> {
  return apiFetch<WorkspaceOut>('/workspaces', { method: 'POST', body: JSON.stringify({ name, goal }) });
}

export function updateWorkspace(id: string, patch: Partial<Pick<WorkspaceOut, 'name' | 'goal'>>): Promise<WorkspaceOut> {
  return apiFetch<WorkspaceOut>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteWorkspace(id: string): Promise<unknown> {
  return apiFetch(`/workspaces/${id}`, { method: 'DELETE' });
}

export function createWorkspaceSession(
  workspaceId: string,
  title: string,
  subject?: string,
): Promise<WorkspaceSessionOut> {
  return apiFetch<WorkspaceSessionOut>(`/workspaces/${workspaceId}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ title, subject }),
  });
}

export function getWorkspaceSession(workspaceId: string, sessionId: string): Promise<WorkspaceSessionOut> {
  return apiFetch<WorkspaceSessionOut>(`/workspaces/${workspaceId}/sessions/${sessionId}`);
}

export function updateWorkspaceSession(
  workspaceId: string,
  sessionId: string,
  patch: Partial<Pick<WorkspaceSessionOut, 'title' | 'status' | 'subject'>>,
): Promise<WorkspaceSessionOut> {
  return apiFetch<WorkspaceSessionOut>(`/workspaces/${workspaceId}/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteWorkspaceSession(workspaceId: string, sessionId: string): Promise<unknown> {
  return apiFetch(`/workspaces/${workspaceId}/sessions/${sessionId}`, { method: 'DELETE' });
}

// ------------------------------------------------------------ session runs + chat

export function getRun(runId: string): Promise<RunOut> {
  return apiFetch<RunOut>(`/runs/${runId}`);
}

export function runSession(workspaceId: string, sessionId: string, documentIds: string[]): Promise<RunOut> {
  return apiFetch<RunOut>(`/workspaces/${workspaceId}/sessions/${sessionId}/run`, {
    method: 'POST',
    body: JSON.stringify({ document_ids: documentIds }),
  });
}

export function installWorkspacePack(workspaceId: string, packId: string): Promise<WorkspaceOut> {
  return apiFetch<WorkspaceOut>(`/workspaces/${workspaceId}/pack`, {
    method: 'POST',
    body: JSON.stringify({ pack_id: packId }),
  });
}

// ------------------------------------------------------------------ profile

export function updateMe(patch: { name?: string; email?: string }): Promise<User> {
  return apiFetch<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(patch) });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
  return apiFetch('/auth/me/password', {
    method: 'PATCH',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// ----------------------------------------------------------------- documents

/** Multipart upload. The body must be a `FormData`, so no JSON content-type header. */
export function uploadDocument(formData: FormData): Promise<DocumentOut> {
  return apiFetch<DocumentOut>('/documents', { method: 'POST', body: formData });
}

// --------------------------------------------------------------------- packs

export function listPacks(limit = 100, offset = 0): Promise<PackOut[]> {
  return apiFetch<PackOut[]>(`/packs?limit=${limit}&offset=${offset}`);
}

export function getPack(packId: string): Promise<PackDetailOut> {
  return apiFetch<PackDetailOut>(`/packs/${packId}`);
}

export function createPack(name: string): Promise<PackOut> {
  return apiFetch<PackOut>('/packs', { method: 'POST', body: JSON.stringify({ name }) });
}

export function approvePackVersion(packId: string, draftSessionId: string): Promise<PackVersionOut> {
  return apiFetch<PackVersionOut>(`/packs/${packId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ draft_session_id: draftSessionId }),
  });
}

// -------------------------------------------------------------------- studio

export function createStudioSession(title: string): Promise<StudioSessionOut> {
  return apiFetch<StudioSessionOut>('/studio/sessions', { method: 'POST', body: JSON.stringify({ title }) });
}

export function getStudioSession(sessionId: string): Promise<StudioSessionOut> {
  return apiFetch<StudioSessionOut>(`/studio/sessions/${sessionId}`);
}
