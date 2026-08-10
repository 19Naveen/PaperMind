'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PackOut } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { IconSearch } from '@/lib/icons';

/** One line answering "what does this Pack do" — what it reviews and extracts. */
function describe(pack: PackOut): string {
  if (pack.latest_version === 0) return 'No frozen version yet — nothing to install.';
  const docs = pack.document_types.length ? `Reviews ${pack.document_types.join(', ')}.` : '';
  const shown = pack.field_names.slice(0, 4);
  const fields = shown.length
    ? ` Extracts ${shown.join(', ')}${pack.field_names.length > 4 ? ` +${pack.field_names.length - 4} more` : ''}.`
    : '';
  return `${docs}${fields}`.trim();
}

export function MarketGrid({ packs }: { packs: PackOut[] }) {
  const [query, setQuery] = useState('');
  const filtered = packs.filter((pack) => !query.trim() || pack.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <section className="page">
      <PageHeader
        eyebrow="Marketplace"
        title="Browse Knowledge Packs"
        meta="Reviewed, versioned document workflows published by teams like yours. Install one and it runs identically, forever."
      />
      <div className="toolbar">
        <label className="search">
          <IconSearch className="ic" />
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search packs…"
            aria-label="Search marketplace"
          />
        </label>
      </div>
      <div className="mk-grid">
        {filtered.map((pack) => (
          <Link key={pack.id} href={`/marketplace/${pack.id}`} className="card mk-card">
            <div className="mk-top">
              <span className="mk-installs">
                {pack.installs} {pack.installs === 1 ? 'install' : 'installs'}
              </span>
            </div>
            <h3>{pack.name}</h3>
            <p className="mk-author">{pack.latest_version > 0 ? 'Knowledge Pack' : 'Draft Pack'}</p>
            <p className="mk-desc">{describe(pack)}</p>
            <div className="mk-meta">v{pack.latest_version} · {pack.rule_count} {pack.rule_count === 1 ? 'rule' : 'rules'}</div>
            <div className="mk-foot">
              <span className="ws-open">View details</span>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && (
          <div className="card empty">
            <span className="e-ic"><IconSearch className="ic lg" /></span>
            <h3>No packs match “{query}”</h3>
            <p>Try a different term — or author a pack for this workflow yourself.</p>
          </div>
        )}
      </div>
    </section>
  );
}
