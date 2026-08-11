import { getMe, listPacks } from '@/lib/api';
import { redirect } from 'next/navigation';
import { NewWorkspaceWizard } from '@/components/NewWorkspaceWizard';

export default async function NewWorkspacePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  // The pack list only populates the optional "start from a published Pack" step,
  // so an unreadable catalogue must not block creating a workspace.
  const packs = await listPacks(100).catch(() => []);
  return <NewWorkspaceWizard packs={packs} />;
}
