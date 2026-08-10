'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkspaceOut } from '@/lib/api';
import { installPackAction } from '@/lib/session';
import { ActionButton, Button, Tag } from '@/components/ui';

export function MarketplaceInstall({
  packId,
  packName,
  workspaces,
}: {
  packId: string;
  packName: string;
  workspaces: WorkspaceOut[];
}) {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A workspace is one Pack — only Pack-less workspaces can receive an install.
  const installable = workspaces.filter((workspace) => !workspace.pack_id);

  async function install() {
    if (!workspaceId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await installPackAction(workspaceId, packId);
      setInstalled(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not install ${packName}.`);
    } finally {
      setBusy(false);
    }
  }

  if (installed) {
    return (
      <div className="flex items-center gap-2">
        <Tag variant="accent">Installed</Tag>
        <Button href={`/workspace/${workspaceId}`} variant="secondary" size="sm">
          Open workspace
        </Button>
      </div>
    );
  }

  return (
    <div>
      {installable.length === 0 ? (
        <div className="text-sm leading-relaxed text-ink-2">
          Every workspace already has a Pack.
          <Button href="/workspace/new" variant="secondary" size="sm" className="mt-2">
            Create a workspace
          </Button>
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor="install-workspace">Workspace to install into</label>
          <select
            id="install-workspace"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            className="input"
          >
            <option value="" disabled>Select workspace…</option>
            {installable.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
          <ActionButton variant="primary" disabled={!workspaceId || busy} onClick={() => void install()} className="mt-2 w-full">
            {busy ? 'Installing…' : 'Install into workspace'}
          </ActionButton>
        </>
      )}
      {error && <p className="mt-2 text-sm text-missing">{error}</p>}
    </div>
  );
}
