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
      'content-type': 'application/json',
      ...(session ? { cookie: `${SESSION_COOKIE}=${session.value}` } : {}),
      ...init?.headers,
    },
  });
  return parse<T>(res);
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
  messages: unknown[];
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
export async function getMe(): Promise<User | null> {
  try {
    return await apiFetch<User>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_AUTHENTICATED') return null;
    throw error;
  }
}

// ----------------------------------------------------------------- workspaces

export function listWorkspaces(limit = 50, offset = 0): Promise<WorkspaceOut[]> {
  return apiFetch<WorkspaceOut[]>(`/workspaces?limit=${limit}&offset=${offset}`);
}

export function getWorkspace(id: string): Promise<WorkspaceDetailOut> {
  return apiFetch<WorkspaceDetailOut>(`/workspaces/${id}`);
}

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
