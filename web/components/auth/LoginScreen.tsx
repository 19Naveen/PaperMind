'use client';

import { startTransition, useActionState, useState } from 'react';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { signInAction } from '@/lib/session';
import { AuthFrame } from './AuthFrame';
import { Field } from './AuthField';
import { IconAlert, IconArrowRight, IconCheck } from '@/lib/icons';
import type { AuthFailure } from '@/lib/session';

/** Branch on the API's error `code`, never its message (CLAUDE.md §3.4 / §4.4). */
function errorMessage(failure: AuthFailure | null): string | null {
  if (!failure) return null;
  switch (failure.code) {
    case 'INVALID_CREDENTIALS':
      return 'Email or password is incorrect.';
    case 'VALIDATION_ERROR':
      if (failure.fields.email) return `Email: ${failure.fields.email}`;
      if (failure.fields.password) return `Password: ${failure.fields.password}`;
      return failure.message;
    default:
      return failure.message;
  }
}

export function LoginScreen() {
  const [email, setEmail] = useState('ada@papermind.io');
  const [password, setPassword] = useState('');
  // The action owns submission: it authenticates against the API, sets the
  // httpOnly session cookie, and redirects. Failures come back as state.
  const [failure, submit, busy] = useActionState(signInAction, null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    startTransition(() => submit({ email: email.trim(), password }));
  }

  const error = errorMessage(failure);

  return (
    <AuthFrame eyebrow="Evidence instrument" pitch="Author once. Execute many times.">
      <p className="eyebrow">Security · Sign in</p>
      <h1 className="display mt-1 text-[24px] leading-tight text-ink">Sign in</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Access the reviewer&apos;s console. Every result cites its source.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@papermind.io"
          autoComplete="email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="current-password"
        />
        {error && (
          <p className="flex items-center gap-1.5 text-[12px] text-missing">
            <IconAlert width={13} height={13} className="shrink-0" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink shadow-xs transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
          <IconArrowRight width={14} height={14} />
        </button>
      </form>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
        <IconCheck width={12} height={12} className="text-verified" />
        Demo account — ada@papermind.io / papermind123
      </p>

      <div className="mt-6 flex items-center justify-between border-t border-rule-2 pt-4">
        <p className="text-[12px] text-ink-3">No workspace yet?</p>
        <Link href="/signup" className="text-[12.5px] font-medium text-accent hover:underline">
          Create a workspace
        </Link>
      </div>
    </AuthFrame>
  );
}