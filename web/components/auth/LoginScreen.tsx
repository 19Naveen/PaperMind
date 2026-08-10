'use client';

import { startTransition, useActionState, useState } from 'react';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { signInAction } from '@/lib/session';
import type { AuthFailure } from '@/lib/session';
import { AuthFrame } from './AuthFrame';
import { Field } from './AuthField';
import { ActionButton } from '@/components/ui';
import { IconAlert, IconArrowRight } from '@/lib/icons';

/** Branch on the API's error `code`, never its message. */
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, submit, busy] = useActionState(signInAction, null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    startTransition(() => submit({ email: email.trim(), password }));
  }

  const error = errorMessage(failure);

  return (
    <AuthFrame pitch="Author once. Execute many times.">
      <h2>Sign in</h2>
      <p>Access the reviewer&apos;s console. Every result cites its source.</p>

      <form onSubmit={onSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@papermind.io" autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
        {error && (
          <p role="alert" className="auth-error"><IconAlert className="ic sm" />{error}</p>
        )}
        <ActionButton type="submit" disabled={busy} variant="primary" className="wfull" icon={<IconArrowRight className="ic sm" />}>
          {busy ? 'Signing in…' : 'Sign in'}
        </ActionButton>
      </form>

      <p className="login-foot">
        No workspace yet? <Link href="/signup">Create one</Link>
      </p>
    </AuthFrame>
  );
}
