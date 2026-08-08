'use client';

import { startTransition, useActionState, useState } from 'react';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { signUpAction } from '@/lib/session';
import { AuthFrame } from './AuthFrame';
import { Field } from './AuthField';
import { IconAlert, IconArrowRight } from '@/lib/icons';
import type { AuthFailure } from '@/lib/session';

/** Branch on the API's error `code`, never its message (CLAUDE.md §3.4 / §4.4). */
function errorMessage(failure: AuthFailure | null): string | null {
  if (!failure) return null;
  switch (failure.code) {
    case 'EMAIL_TAKEN':
      return 'That email already has an account. Sign in instead.';
    case 'VALIDATION_ERROR':
      if (failure.fields.name) return `Name: ${failure.fields.name}`;
      if (failure.fields.email) return `Email: ${failure.fields.email}`;
      if (failure.fields.password) return `Password: ${failure.fields.password}`;
      return failure.message;
    default:
      return failure.message;
  }
}

export function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [failure, submit, busy] = useActionState(signUpAction, null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setLocalError('Name is required.');
      return;
    }
    if (!trimmedEmail.includes('@')) {
      setLocalError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      // Confirmation is a client-only concern — the API never sees it.
      setLocalError('Passwords do not match.');
      return;
    }
    setLocalError(null);
    startTransition(() => submit({ name: trimmedName, email: trimmedEmail, password }));
  }

  const error = localError ?? errorMessage(failure);

  return (
    <AuthFrame eyebrow="Self-registration · draft" pitch="A reviewer identity. Every result cites its source.">
      <h1 className="display text-[26px] font-semibold tracking-[-0.035em] text-ink">Create your account</h1>
      <p className="mb-[26px] mt-[7px] text-[13.5px] text-ink-2">An examiner identity for the console. Your account is created on first sign-up.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="Name" value={name} onChange={setName} placeholder="Ada Lovelace" autoComplete="name" />
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
          placeholder="min. 8 characters"
          autoComplete="new-password"
        />
        <Field
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          placeholder="repeat password"
          autoComplete="new-password"
        />

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-[12px] text-missing">
            <IconAlert width={13} height={13} className="shrink-0" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-none bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink shadow-xs transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
        >
          {busy ? 'Creating account…' : 'Create account'}
          <IconArrowRight width={14} height={14} />
        </button>
      </form>

      <p className="mt-5 text-center text-[12px] text-ink-3">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-accent hover:underline">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
