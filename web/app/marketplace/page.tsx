import {
  ActionButton,
  Button,
  Card,
  CardBody,
  CardKicker,
  CardMeta,
  CardTitle,
  Tag,
} from '@/components/ui';
import { getMarketplacePacks } from '@/lib/mock';

const categories = ['All', 'Compliance', 'Finance', 'Legal', 'Operations', 'Research'];

export default async function MarketplacePage() {
  const packs = await getMarketplacePacks();

  return (
    <div className="min-h-full">
      <header className="border-b-2 border-rule bg-surface px-6 py-[18px]">
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="mr-auto">
            <p className="eyebrow text-accent">Marketplace</p>
            <h1 className="display mt-1 text-[21px] font-extrabold leading-tight text-ink">Published packs</h1>
          </div>
          <label className="sr-only" htmlFor="pack-search">Search packs</label>
          <input id="pack-search" type="search" placeholder="Search packs" className="w-full border border-rule bg-surface px-2 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent sm:w-[260px]" />
          <ActionButton variant="secondary">Publish yours</ActionButton>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-6 py-[18px]">
        {categories.map((category) => <Tag key={category} variant={category === 'All' ? 'accent' : 'neutral'}>{category}</Tag>)}
      </div>

      <section className="grid grid-cols-1 gap-[18px] p-6 md:grid-cols-2 xl:grid-cols-3">
        {packs.map((pack) => (
          <Card key={pack.id} pad={false} className="flex min-h-[230px] flex-col border border-rule p-5 transition-colors hover:border-accent">
            <CardKicker>{pack.category}</CardKicker>
            <CardTitle className="mt-1 text-[21px]">{pack.name}</CardTitle>
            <CardBody className="mt-2">{pack.description}</CardBody>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Tag>{pack.nodes} nodes</Tag>
              <Tag>{pack.assets} assets</Tag>
            </div>
            <CardMeta>
              <span>{pack.installs} installs · by {pack.author}</span>
              <Button href="/workspace/vendor" variant="primary" size="sm" className="ml-auto">Install</Button>
            </CardMeta>
          </Card>
        ))}
      </section>
    </div>
  );
}
