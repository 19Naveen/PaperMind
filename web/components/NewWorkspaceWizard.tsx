'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import { IMPORT_SPEC_KEY, specToGraph, type PackSpec } from '@/lib/types';
import { IconArrowRight, IconBriefcase, IconCheck, IconLayers } from '@/lib/icons';
import { createWorkspaceAction } from '@/lib/session';

type ObjectiveId = 'vendor' | 'audit' | 'contract' | 'custom';

const OBJECTIVES: { id: ObjectiveId; label: string; blurb: string }[] = [
  { id: 'vendor', label: 'Vendor Due Diligence', blurb: 'Check vendors against GDPR, AML, and KYC before onboarding' },
  { id: 'audit', label: 'Financial Audit', blurb: 'Validate report completeness and consistency across the portfolio' },
  { id: 'contract', label: 'Contract Review', blurb: 'Check contracts against liability, law, and renewal rules' },
  { id: 'custom', label: 'Custom', blurb: 'Define an objective from scratch' },
];

const PACK_NAMES: Record<string, string> = {
  pack_lib_vendor: 'Vendor Review',
  pack_lib_gdpr: 'GDPR',
  pack_lib_aml: 'AML',
  pack_lib_kyc: 'KYC',
  pack_lib_annual: 'Annual Report',
  pack_lib_audit: 'Audit',
  pack_lib_nda: 'NDA',
  pack_lib_employment: 'Employment',
};

const SUGGESTED: Record<ObjectiveId, string[]> = {
  vendor: ['pack_lib_vendor', 'pack_lib_gdpr', 'pack_lib_aml', 'pack_lib_kyc'],
  audit: ['pack_lib_annual', 'pack_lib_audit'],
  contract: ['pack_lib_vendor', 'pack_lib_nda', 'pack_lib_employment'],
  custom: [],
};

const STEPS = ['Objective', 'Start from', 'Ready'];

/**
 * The + New Workspace wizard: pick the objective, pick a starting Pack (or
 * blank), create. A Workspace is one Pack — no composing multiple packs.
 * No backend yet — "Create" lands on the sample workspace until POST exists.
 */
export function NewWorkspaceWizard() {
  const [step, setStep] = useState(0);
  const [objective, setObjective] = useState<ObjectiveId | null>(null);
  const [custom, setCustom] = useState('');
  const [startFrom, setStartFrom] = useState<string>('blank');
  const [importedSpec, setImportedSpec] = useState<PackSpec | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ponytail: setState-in-effect for SSR-safe sessionStorage read (matches the
  // prior import-loader's justified pattern) — an imported spec routes here.
  useEffect(() => {
    const raw = sessionStorage.getItem(IMPORT_SPEC_KEY);
    if (!raw) return;
    sessionStorage.removeItem(IMPORT_SPEC_KEY);
    try {
      const spec = JSON.parse(raw) as PackSpec;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe sessionStorage read, see comment above
      setImportedSpec(spec);
      setStartFrom('imported');
    } catch {
      // malformed sessionStorage payload — ignore, wizard falls back to blank
    }
  }, []);

  const suggested = useMemo(() => (objective ? SUGGESTED[objective] : []), [objective]);
  const name = objective === 'custom' ? custom.trim() || 'Custom workspace' : (OBJECTIVES.find((o) => o.id === objective)?.label ?? '');
  const startFromLabel =
    startFrom === 'blank' ? 'a blank Pack' : startFrom === 'imported' ? `an imported spec (${importedSpec?.name})` : PACK_NAMES[startFrom];

  function pick(id: ObjectiveId) {
    setObjective(id);
    setStartFrom(SUGGESTED[id][0] ?? 'blank');
  }

  function create() {
    // ponytail: the chosen starting Pack (blank/imported/library) has no backend
    // to receive it yet — only the workspace itself (name + goal) is real.
    if (importedSpec) void specToGraph(importedSpec);
    const goal = objective === 'custom' ? 'No Pack installed yet.' : (OBJECTIVES.find((o) => o.id === objective)?.blurb ?? '');
    setCreating(true);
    setError(null);
    startTransition(() => {
      createWorkspaceAction(name, goal).catch((err: unknown) => {
        setCreating(false);
        setError(err instanceof Error ? err.message : 'Could not create the workspace.');
      });
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      {/* Stepper — encodes real sequence: decide, compose, open. */}
      <ol className="mb-12 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={i === step ? 'step' : undefined}
              className={`flex items-center gap-1.5 rounded-none border px-2.5 py-1 font-data text-[10.5px] uppercase tracking-wider ${
                i < step
                  ? 'border-verified/40 bg-verified-soft text-verified'
                  : i === step
                    ? 'border-accent/50 bg-accent-soft text-accent'
                    : 'border-rule bg-surface text-ink-3'
              }`}
            >
              {i < step ? <IconCheck width={11} height={11} /> : `${i + 1}.`}
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-5 bg-rule" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <p className="display text-[17px] text-ink">What are you trying to do?</p>
          <p className="mt-1 text-[13px] text-ink-2">A workspace starts from an objective. The packs follow from it.</p>
          <ul className="mt-6 space-y-2">
            {OBJECTIVES.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => pick(o.id)}
                  className={`group flex w-full items-center gap-4 rounded-none border px-4 py-3.5 text-left transition-all ${
                    objective === o.id ? 'border-accent bg-accent-soft shadow-sm' : 'border-rule bg-surface hover:border-ink-3 hover:shadow-sm'
                  }`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-none border ${objective === o.id ? 'border-accent/40 bg-white text-accent' : 'border-rule bg-raised text-ink-3'}`}>
                    <IconBriefcase width={16} height={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-ink">{o.label}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-2">{o.blurb}</span>
                  </span>
                  <span className={`transition-all ${objective === o.id ? 'text-accent' : 'text-ink-3 group-hover:text-ink'}`}>
                    <IconArrowRight width={16} height={16} />
                  </span>
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
              className="mt-3 w-full rounded-none border border-rule bg-surface px-3.5 py-2.5 text-[13px] text-ink outline-none focus-visible:border-accent"
            />
          )}
          <div className="mt-6 flex justify-end">
            <StepButton disabled={!objective} onClick={() => setStep(1)} label="Continue" />
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <p className="display text-[17px] text-ink">Start {name} from</p>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-2">
            <IconLayers width={14} height={14} />
            A workspace is one Pack — pick a starting point, or build it from scratch in chat.
          </p>
          <ul className="mt-6 space-y-2">
            {['blank', ...(importedSpec ? ['imported'] : []), ...(suggested.length ? suggested : Object.keys(PACK_NAMES))].map(
              (id) => {
                const on = startFrom === id;
                const label = id === 'blank' ? 'Blank Pack' : id === 'imported' ? `Imported: ${importedSpec?.name}` : PACK_NAMES[id];
                return (
                  <li key={id}>
                    <button
                      onClick={() => setStartFrom(id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-none border px-4 py-3 text-left transition-all ${
                        on ? 'border-accent bg-accent-soft shadow-sm' : 'border-rule bg-surface hover:border-ink-3'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-none border text-[12px] transition-colors ${
                            on ? 'border-accent bg-accent text-white' : 'border-rule bg-raised text-transparent'
                          }`}
                        >
                          <IconCheck width={13} height={13} />
                        </span>
                        <span className="text-[14px] font-medium text-ink">{label}</span>
                      </span>
                      <span className={`font-data text-[11px] ${on ? 'text-accent' : 'text-ink-3'}`}>
                        {on ? 'selected' : ''}
                      </span>
                    </button>
                  </li>
                );
              },
            )}
          </ul>
          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStep(0)} className="text-[13px] font-medium text-ink-2 hover:text-ink">
              ← Back
            </button>
            <StepButton disabled={false} onClick={() => setStep(2)} label="Review" />
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="rounded-none border border-rule bg-surface p-6 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-verified/40 bg-verified-soft text-verified">
            <IconCheck width={20} height={20} />
          </span>
          <p className="display mt-4 text-[18px] text-ink">{name}</p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-2">
            Workspace ready — starting from <strong className="font-data text-ink">{startFromLabel}</strong>. Sessions
            run this Pack against document sets, isolated from one another.
          </p>
          {error && <p className="mt-4 text-[12.5px] text-missing">{error}</p>}
          <div className="mt-6 flex items-center justify-center gap-2">
            <button onClick={() => setStep(1)} disabled={creating} className="rounded-none border border-rule px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-raised disabled:opacity-40">
              ← Back
            </button>
            <button
              onClick={create}
              disabled={creating}
              className="rounded-none bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Open workspace'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StepButton({ disabled, onClick, label }: { disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-none bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label} <IconArrowRight width={14} height={14} />
    </button>
  );
}