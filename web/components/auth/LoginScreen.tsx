'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { DEMO_USER } from '@/lib/session';
import { useAuth } from './AuthProvider';
import { AuthFrame } from './AuthFrame';
import { Field } from './AuthField';
import { IconArrowRight, IconCheck } from '@/lib/icons';

export function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('ada@papermind.io');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    // MOCK — accept the demo identity regardless of the form's contents.
    signIn(DEMO_USER);
    router.push('/');
  }

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
        Demo account — the password is never checked.
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