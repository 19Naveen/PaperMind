import { getMe, listPacks, listWorkspaces } from '@/lib/api';
import { redirect } from 'next/navigation';
import { Button, Card, CardBody, CardKicker, CardMeta, CardTitle, Tag } from '@/components/ui';
import { MarketGrid } from './MarketGrid';

export default async function MarketplacePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  const [packs, workspaces] = await Promise.all([listPacks(100), listWorkspaces(200)]);

  return (
    <div className="min-h-full">
      <header className="border-b-2 border-rule bg-surface px-6 py-[18px]">
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="mr-auto">
            <p className="eyebrow text-accent">Marketplace</p>
            <h1 className="display mt-1 text-[21px] font-extrabold leading-tight text-ink">
              Published packs
            </h1>
          </div>
          <Button href="/workspace/new" variant="secondary">
            Publish yours
          </Button>
        </div>
      </header>

      {packs.length === 0 ? (
        <div className="mx-auto mt-16 max-w-md px-6 text-center">
          <p className="eyebrow text-accent">Nothing published yet</p>
          <h2 className="display mt-2 text-[23px] font-extrabold">No packs to install</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            Author a Pack from any workspace, approve it, and it becomes installable here.
          </p>
        </div>
      ) : (
        <MarketGrid packs={packs} workspaces={workspaces} />
      )}

      <section className="px-6 pb-8">
        <Card className="mt-8 flex flex-wrap items-center gap-3">
          <CardKicker>Pack hygiene</CardKicker>
          <CardTitle className="text-[15px]">Every Pack here is a frozen version.</CardTitle>
          <CardBody className="text-[12px] text-ink-2">
            Installing claims the Pack for one workspace — a workspace can run exactly one
            Pack, and a Pack can serve exactly one workspace.
          </CardBody>
          <CardMeta>
            <Tag variant="outline">{packs.length} pack{packs.length === 1 ? '' : 's'}</Tag>
          </CardMeta>
        </Card>
      </section>
    </div>
  );
}
