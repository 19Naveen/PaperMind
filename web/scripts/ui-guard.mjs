#!/usr/bin/env node
// Design-system drift guard for Premium2.0.
// View components must reuse the shared primitives in components/ui.tsx.
// ui.tsx owns canonical variant strings and is exempt.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['app', 'components'];
const SKIP = new Set([join(ROOT, 'components/ui.tsx')]);

const rules = [
  {
    name: 'legacy Soft Paper color',
    re: /#(?:2f5942|254a37|1d3c2c|f0ece2)\b/i,
    hint: 'Use Premium2.0 semantic tokens from components/ui.tsx.',
  },
  {
    name: 'local Stat/GridStat definition',
    re: /function (Stat|GridStat|StatStrip)\s*\(/,
    hint: 'Use the shared Stat primitive (bare variant) from components/ui.tsx.',
  },
  {
    name: 'hand-rolled primary action button',
    re: /<button[^>]*className="[^"]*bg-accent/,
    hint: 'Use ActionButton variant="primary" from components/ui.tsx.',
  },
];

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else if (rel.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

const violations = [];
for (const dir of DIRS) {
  for (const rel of walk(join(ROOT, dir))) {
    const abs = join(ROOT, dir, rel);
    if (SKIP.has(abs)) continue;
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const rule of rules) {
        if (rule.re.test(line)) {
          violations.push(`${dir}/${rel}:${i + 1} — ${rule.name}\n  ${line.trim()}\n  fix: ${rule.hint}`);
        }
      }
    });
  }
}

if (violations.length) {
  console.error(`Design-system drift (${violations.length}):\n\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('ui-guard: clean');
