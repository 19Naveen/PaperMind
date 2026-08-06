import { Button, EmptyState, PageHeader } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <main className="min-h-full bg-ground">
      <PageHeader eyebrow="404" title="Page not found" />
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <EmptyState title="Nothing is filed here" body="The workspace, session, or page may have moved or been removed." action={<Button href="/" variant="primary">Return to workspaces</Button>} />
      </div>
    </main>
  );
}
