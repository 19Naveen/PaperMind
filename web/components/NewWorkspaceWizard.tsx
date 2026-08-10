'use client';

import { startTransition, useEffect, useState } from 'react';
import { IMPORT_SPEC_KEY, type PackSpec } from '@/lib/types';
import type { PackOut } from '@/lib/api';
import { IconArrowRight, IconBriefcase, IconCheck, IconLayers } from '@/lib/icons';
import { createWorkspaceAction } from '@/lib/session';
import { ActionButton } from '@/components/ui';

type ObjectiveId = 'vendor' | 'audit' | 'contract' | 'custom';

const OBJECTIVES: { id: ObjectiveId; label: string; blurb: string }[] = [
  { id: 'vendor', label: 'Vendor Due Diligence', blurb: 'Check vendors against GDPR, AML, and KYC before onboarding' },
  { id: 'audit', label: 'Financial Audit', blurb: 'Validate report completeness and consistency across the portfolio' },
  { id: 'contract', label: 'Contract Review', blurb: 'Check contracts against liability, law, and renewal rules' },
  { id: 'custom', label: 'Custom', blurb: 'Define an objective from scratch' },
];

const STEPS = ['Objective', 'Start from', 'Ready'];

/**
 * The + New Workspace wizard: pick the objective, pick a starting Pack (or
 * blank), create. A Workspace is one Pack — no composing multiple packs.
 * Choosing a published Pack installs it into the new workspace; blank and
 * imported choices open Pack-less so the user can author or install a Pack.
 */
export function NewWorkspaceWizard({ packs }: { packs: PackOut[] }) {
  const [step, setStep] = useState(0);
  const [objective, setObjective] = useState<ObjectiveId | null>(null);
  const [custom, setCustom] = useState('');
  const [startFrom, setStartFrom] = useState<string>('blank');
  const [search, setSearch] = useState('');
  const [importedSpec, setImportedSpec] = useState<PackSpec | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ponytail: setState-in-effect for SSR-safe sessionStorage read.
  useEffect(() => {
    const raw = sessionStorage.getItem(IMPORT_SPEC_KEY);
    if (!raw) return;
    sessionStorage.removeItem(IMPORT_SPEC_KEY);
    try {
      const spec = JSON.parse(raw) as PackSpec;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe sessionStorage read
      setImportedSpec(spec);
      setStartFrom('imported');
    } catch {
      // malformed sessionStorage payload — ignore.
    }
  }, []);

  const name = objective === 'custom' ? custom.trim() || 'Custom workspace' : (OBJECTIVES.find((o) => o.id === objective)?.label ?? '');
  const chosenPack = startFrom !== 'blank' && startFrom !== 'imported' ? packs.find((p) => p.id === startFrom) : undefined;
  const topPacks = [...packs].sort((a, b) => b.installs - a.installs).slice(0, 3);
  const searchTerm = search.trim().toLowerCase();
  const searchResults = searchTerm
    ? packs.filter((p) => !topPacks.some((t) => t.id === p.id) && p.name.toLowerCase().includes(searchTerm))
    : [];
  const packDetail = (p: PackOut) => {
    const docs = p.document_types.slice(0, 3).join(', ');
    const review = docs ? `Reviews ${docs}${p.document_types.length > 3 ? '…' : ''}` : '';
    return [review, `${p.installs} ${p.installs === 1 ? 'install' : 'installs'}`].filter(Boolean).join(' · ');
  };

  function pick(id: ObjectiveId) {
    setObjective(id);
    setStartFrom('blank');
  }

  function create() {
    const goal = objective === 'custom' ? 'No Pack installed yet.' : (OBJECTIVES.find((o) => o.id === objective)?.blurb ?? '');
    setCreating(true);
    setError(null);
    startTransition(() => {
      createWorkspaceAction(name, goal, chosenPack?.id).catch((err: unknown) => {
        setCreating(false);
        setError(err instanceof Error ? err.message : 'Could not create the workspace.');
      });
    });
  }

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className="step-row">
            <span aria-current={i === step ? 'step' : undefined} className={`step ${i < step ? 'done' : i === step ? 'active' : ''}`}>
              {i < step ? <IconCheck className="ic sm" /> : `${i + 1}.`}
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="step-line" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="mt-6">
          <h2 className="page-title" style={{ fontSize: 'var(--t-xl)' }}>What are you trying to do?</h2>
          <p className="page-sub">A workspace starts from an objective. The packs follow from it.</p>
          <ul className="stack mt-6">
            {OBJECTIVES.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => pick(o.id)}
                  aria-pressed={objective === o.id}
                  className="start-opt full"
                >
                  <span className="so-ic"><IconBriefcase className="ic" /></span>
                  <span className="so-main">
                    <b>{o.label}</b>
                    <p>{o.blurb}</p>
                  </span>
                  <IconArrowRight className="ic" />
                </button>
              </li>
            ))}
          </ul>
          {objective === 'custom' && (
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. Review lease exit clauses before purchase"
              className="input mt-3"
            />
          )}
          <div className="flbl-wrap" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
            <ActionButton disabled={!objective} onClick={() => setStep(1)} variant="primary" icon={<IconArrowRight className="ic sm" />}>Continue</ActionButton>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="mt-6">
          <h2 className="page-title" style={{ fontSize: 'var(--t-xl)' }}>Start {name} from</h2>
          <p className="page-sub"><IconLayers className="ic sm" /> A workspace is one Pack — pick a suggested Pack, search the marketplace, or build from scratch in chat.</p>
          <ul className="stack mt-6">
            <li><PickRow label="Blank Pack" detail="start Pack-less, build in chat" on={startFrom === 'blank'} onPick={() => setStartFrom('blank')} /></li>
            {importedSpec && (
              <li><PickRow label={`Imported: ${importedSpec.name}`} detail="not carried over automatically" on={startFrom === 'imported'} onPick={() => setStartFrom('imported')} /></li>
            )}
          </ul>

          {topPacks.length > 0 && (
            <section className="mt-6">
              <p className="eyebrow">Suggested · most downloaded</p>
              <ul className="stack mt-2">
                {topPacks.map((p) => (
                  <li key={p.id}><PickRow label={p.name} detail={packDetail(p)} on={startFrom === p.id} onPick={() => setStartFrom(p.id)} /></li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-6">
            <p className="eyebrow">Search the marketplace</p>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="e.g. KYC, contract review…"
              className="input mt-2"
            />
            {searchTerm && (
              searchResults.length > 0 ? (
                <ul className="stack mt-2">
                  {searchResults.map((p) => (
                    <li key={p.id}><PickRow label={p.name} detail={packDetail(p)} on={startFrom === p.id} onPick={() => setStartFrom(p.id)} /></li>
                  ))}
                </ul>
              ) : (
                <p className="fineprint mt-2">No packs match “{search.trim()}”.</p>
              )
            )}
          </div>
          <div className="flbl-wrap" style={{ justifyContent: 'space-between', marginTop: 24 }}>
            <ActionButton variant="ghost" onClick={() => setStep(0)}>← Back</ActionButton>
            <ActionButton onClick={() => setStep(2)} variant="primary" icon={<IconArrowRight className="ic sm" />}>Review</ActionButton>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="card card-pad mt-6 center" style={{ padding: 28 }}>
          <span className="e-ic" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><IconCheck className="ic lg" /></span>
          <h2 className="page-title" style={{ fontSize: 'var(--t-xl)', marginTop: 12 }}>{name}</h2>
          <p className="page-sub" style={{ marginTop: 8 }}>
            {chosenPack ? (
              <>Creates the workspace with the <strong className="mono">{chosenPack.name}</strong> Pack installed, ready to run.</>
            ) : startFrom === 'imported' ? (
              <>Creates the workspace without a Pack — the imported spec is not carried over automatically. Build one from scratch or install a published Pack from there.</>
            ) : (
              <>Creates the workspace without a Pack. Build one from scratch or install a published Pack from there.</>
            )}
          </p>
          {error && <p className="mt-3" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div className="flbl-wrap" style={{ justifyContent: 'center', marginTop: 24 }}>
            <ActionButton variant="secondary" onClick={() => setStep(1)} disabled={creating}>← Back</ActionButton>
            <ActionButton variant="primary" onClick={create} disabled={creating}>
              {creating ? 'Creating…' : 'Open workspace'}
            </ActionButton>
          </div>
        </section>
      )}
    </div>
  );
}

/** One selectable "start from" / objective row — the reference .start-opt. */
function PickRow({ label, detail, on, onPick }: { label: string; detail: string; on: boolean; onPick: () => void }) {
  return (
    <button onClick={onPick} aria-pressed={on} className="start-opt full">
      <span className="so-check">{on && <IconCheck className="ic sm" />}</span>
      <span className="so-main"><b>{label}</b></span>
      <span className="mono" style={{ color: on ? 'var(--accent)' : 'var(--ink-3)' }}>{on ? 'selected' : detail}</span>
    </button>
  );
}
