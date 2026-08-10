import { getMe, listPacks } from '@/lib/api';
import { redirect } from 'next/navigation';
import { NewWorkspaceWizard } from '@/components/NewWorkspaceWizard';

export default async function NewWorkspacePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  const packs = await listPacks(100);
  return <NewWorkspaceWizard packs={packs} />;
}
