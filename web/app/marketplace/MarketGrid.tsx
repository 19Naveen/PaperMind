'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PackOut } from '@/lib/api';
import { Card, CardBody, CardKicker, CardMeta, CardTitle, PageHeader } from '@/components/ui';

/** Describe only the shape exposed by the published Pack API. */
function describe(pack: PackOut): string {
  return pack.latest_version > 0
    ? `Version ${pack.latest_version} · updated ${new Date(pack.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`
    : 'No frozen version yet — nothing to install.';
}

export function MarketGrid({ packs }: { packs: PackOut[] }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const filtered = packs.filter((pack) => !term || pack.name.toLowerCase().includes(term));

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Browse Knowledge Packs"
        meta="Reviewed, versioned document workflows published by teams like yours."
        actions={(
          <>
            <label className="sr-only" htmlFor="pack-search">Search packs</label>
            <input id="pack-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search packs" className="w-full border border-rule bg-surface px-2 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent sm:w-[260px]" />
          </>
        )}
      />
      <section className="overflow-x-auto p-6">
        <div className="grid min-w-[816px] grid-cols-[repeat(3,minmax(260px,1fr))] gap-[18px]">
          {filtered.map((pack) => (
            <Link key={pack.id} href={`/marketplace/${pack.id}`} className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <Card pad={false} className="flex h-full min-h-[220px] flex-col p-5 shadow-sm transition-[border-color] duration-100 group-hover:border-accent">
                <div className="flex items-center justify-between gap-3">
                  <CardKicker>{pack.latest_version > 0 ? 'Knowledge Pack' : 'Draft Pack'}</CardKicker>
                  <span className="whitespace-nowrap font-data text-[10.5px] uppercase tracking-wider text-ink-3">
                    Published {new Date(pack.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <CardTitle className="mt-1 text-[21px]">{pack.name}</CardTitle>
                <CardBody className="mt-2">{describe(pack)}</CardBody>
                <CardMeta className="mt-0 pt-3">
                  <span className="mr-auto whitespace-nowrap text-ink-3">
                    v{pack.latest_version} · Published workflow
                  </span>
                  <span className="whitespace-nowrap font-data text-[10.5px] uppercase tracking-wider text-accent">
                    View details →
                  </span>
                </CardMeta>
              </Card>
            </Link>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full py-10 text-center text-[13px] text-ink-2">
              No packs match “{query}”.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
