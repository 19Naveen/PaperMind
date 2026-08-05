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
  createWorkspace,
  createWorkspaceSession,
  fieldErrors,
  login,
  logout,
  signup,
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

/** Creates a workspace and opens it. Thrown ApiErrors surface as the Next.js error boundary. */
export async function createWorkspaceAction(name: string, goal: string): Promise<never> {
  const workspace = await createWorkspace(name, goal);
  redirect(`/workspace/${workspace.id}`);
}

/** Adds a draft session to a workspace and refreshes its overview in place. Bind `workspaceId` for use as a `<form action>`. */
export async function createSessionAction(workspaceId: string, formData: FormData): Promise<void> {
  const title = String(formData.get('title') ?? '').trim() || 'Untitled session';
  await createWorkspaceSession(workspaceId, title);
  revalidatePath(`/workspace/${workspaceId}`);
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
