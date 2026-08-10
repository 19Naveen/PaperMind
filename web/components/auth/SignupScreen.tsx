'use client';

import { startTransition, useActionState, useState } from 'react';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { signUpAction } from '@/lib/session';
import type { AuthFailure } from '@/lib/session';
import { AuthFrame } from './AuthFrame';
import { Field } from './AuthField';
import { ActionButton } from '@/components/ui';
import { IconAlert, IconArrowRight } from '@/lib/icons';

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
    if (!trimmedName) return setLocalError('Name is required.');
    if (!trimmedEmail.includes('@')) return setLocalError('Enter a valid email address.');
    if (password.length < 8) return setLocalError('Password must be at least 8 characters.');
    if (password !== confirm) return setLocalError('Passwords do not match.');
    setLocalError(null);
    startTransition(() => submit({ name: trimmedName, email: trimmedEmail, password }));
  }

  const error = localError ?? errorMessage(failure);

  return (
    <AuthFrame pitch="A reviewer identity for the console.">
      <h2>Create your account</h2>
      <p>Your account is created on first sign-up — then author or install your first Pack.</p>

      <form onSubmit={onSubmit} noValidate>
        <Field label="Name" value={name} onChange={setName} placeholder="Ada Lovelace" autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@papermind.io" autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="min. 8 characters" autoComplete="new-password" />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} placeholder="repeat password" autoComplete="new-password" />
        {error && (
          <p role="alert" className="auth-error"><IconAlert className="ic sm" />{error}</p>
        )}
        <ActionButton type="submit" disabled={busy} variant="primary" className="wfull" icon={<IconArrowRight className="ic sm" />}>
          {busy ? 'Creating account…' : 'Create account'}
        </ActionButton>
      </form>

      <p className="login-foot">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
