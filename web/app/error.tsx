'use client';

import { ActionButton, Button, EmptyState, PageHeader } from '@/components/ui';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-full bg-ground">
      <PageHeader eyebrow="Error" title="This page could not be loaded" />
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <EmptyState
          title="The request did not complete"
          body="Check the service connection and try again. Your existing workspace data has not been changed."
          action={<div className="flex gap-2"><ActionButton variant="primary" onClick={reset}>Try again</ActionButton><Button href="/" variant="secondary">Go home</Button></div>}
        />
      </div>
    </main>
  );
}
