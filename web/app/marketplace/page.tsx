import { getMe, listPacks, listWorkspaces } from '@/lib/api';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { MarketGrid } from './MarketGrid';

export default async function MarketplacePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  const [packs, workspaces] = await Promise.all([listPacks(100), listWorkspaces(200)]);

  return (
    <div className="min-h-full">
      {packs.length === 0 ? (
        <>
          <PageHeader eyebrow="Marketplace" title="Published packs" />
          <div className="mx-auto mt-16 max-w-md px-6 text-center">
            <p className="eyebrow text-accent">Nothing published yet</p>
            <h2 className="display mt-2 text-[23px] font-extrabold">No packs to install</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">Author a Pack from any workspace, approve it, and it becomes installable here.</p>
          </div>
        </>
      ) : (
        <MarketGrid packs={packs} workspaces={workspaces} />
      )}
    </div>
  );
}
