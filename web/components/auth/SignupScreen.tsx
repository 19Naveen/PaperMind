'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { makeUser } from '@/lib/session';
import { useAuth } from './AuthProvider';
import { AuthFrame } from './AuthFrame';
import { Field } from './AuthField';
import { IconAlert, IconArrowRight } from '@/lib/icons';

export function SignupScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!trimmedEmail.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    // MOCK — mint an examiner identity locally; no account is created anywhere.
    signIn(makeUser(trimmedName, trimmedEmail));
    router.push('/');
  }

  return (
    <AuthFrame eyebrow="Self-registration · draft" pitch="A reviewer identity. Every result cites its source.">
      <p className="eyebrow">Account · Draft</p>
      <h1 className="display mt-1 text-[24px] leading-tight text-ink">Create your account</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        An examiner identity for the console. Self-registration is stubbed — nothing is stored outside this browser.
      </p>

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
          <p className="flex items-center gap-1.5 text-[12px] text-missing">
            <IconAlert width={13} height={13} className="shrink-0" />
            {error}
          </p>
        )}

        <button
          type="submit"
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink shadow-xs transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
        >
          Create account
          <IconArrowRight width={14} height={14} />
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between border-t border-rule-2 pt-4">
        <p className="text-[12px] text-ink-3">Already have an account?</p>
        <Link href="/login" className="text-[12.5px] font-medium text-accent hover:underline">
          Sign in
        </Link>
      </div>
    </AuthFrame>
  );
}