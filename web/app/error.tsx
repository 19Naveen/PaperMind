'use client';

import { ActionButton, Button, EmptyState, PageHeader } from '@/components/ui';
import { IconAlert } from '@/lib/icons';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-full bg-ground">
      <PageHeader eyebrow="Error" title="This view hit a problem" />
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <EmptyState
          icon={<IconAlert className="ic lg" />}
          title="The request did not complete"
          body="The connection to the service was interrupted. Nothing in your workspace was changed — try again, or head back to the overview."
          action={<div className="flex gap-2"><ActionButton variant="primary" onClick={reset}>Try again</ActionButton><Button href="/" variant="secondary">Go home</Button></div>}
        />
      </div>
    </main>
  );
}
