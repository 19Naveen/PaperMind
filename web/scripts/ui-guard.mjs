#!/usr/bin/env node
// Design-system drift guard.
//
// History: this codebase has fixed "design-system deviation" at least twice and
// it came back both times, because the checks in CI (tsc, next build, eslint)
// verify nothing about the design. These rules encode the four ways it actually
// drifted, so the next regression fails the lint run instead of shipping:
//
//   1. a second palette — raw hex outside the token block in globals.css
//   2. off-scale values — one-off px sizes and weights with no token behind them
//   3. utilities fighting the CSS — `!important` and arbitrary-value Tailwind
//   4. re-implemented primitives — local Stat/button/input copies
//
// Run: node scripts/ui-guard.mjs   (wired into `npm run lint`)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// ui.tsx owns the canonical variant strings; globals.css §1 owns the palette.
const EXEMPT_TSX = new Set(['components/ui.tsx']);

// A line carrying this marker is a documented, intentional exception.
const ALLOW = 'ui-guard-allow';

const TSX_RULES = [
  {
    name: 'arbitrary-value Tailwind utility',
    // text-[12.5px], gap-[18px], min-w-[280px], border-l-[3px], h-[212px] …
    re: /\b(?:text|gap|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|rounded|border|border-l|border-t|leading|tracking|top|left|right|bottom|z|flex|grid-cols|basis)-\[[^\]]+\]/,
    hint: 'Use the token scale (text-2xs…text-3xl) or the semantic class. Off-scale one-offs are how the type scale died last time.',
  },
  {
    name: '!important utility',
    re: /(?:^|["'\s[])!(?:bg|text|border|fill|stroke|w|h|p|m|shadow|rounded|flex|grid)-/,
    hint: 'Fix the underlying CSS instead. An !important utility means a component is fighting the design system.',
  },
  {
    name: 'raw colour literal',
    re: /(?:#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(\s*\d)/,
    hint: 'Use a token-backed utility (text-ink-2, bg-surface, border-rule) or var(--token). Colours live in globals.css §1 only.',
  },
  {
    name: 'off-scale inline font-size',
    re: /fontSize:\s*['"]?\d+(?:\.\d+)?(?:px)?['"]?/,
    hint: 'Use a scale class (text-2xs…text-3xl). The scale is 10/11/12/13/14/16/20/26/34px.',
  },
  {
    name: 'legacy Soft Paper colour',
    re: /#(?:2f5942|254a37|1d3c2c|f0ece2|e9e3d5)\b/i,
    hint: 'That palette was replaced. Use the semantic tokens in globals.css §1.',
  },
  {
    name: 'local Stat/GridStat definition',
    re: /function (Stat|GridStat|StatStrip)\s*\(/,
    hint: 'Use the shared Stat primitive (bare variant) from components/ui.tsx.',
  },
  {
    name: 'hand-rolled button',
    re: /<button[^>]*className="[^"]*(?:bg-accent|font-medium|font-extrabold|px-\d)/,
    hint: 'Use ActionButton (button/submit) or Button (link) from components/ui.tsx.',
  },
  {
    name: 'locale-less date formatting',
    // Org standard is Singapore format (DD/MM/YYYY); a bare call follows the
    // viewer's locale and silently renders US M/D/YYYY for many of them.
    re: /toLocaleDateString\(\s*\)|toLocaleDateString\(\s*(?!['"]en-(?:GB|SG))/,
    hint: "Pass an explicit locale: toLocaleDateString('en-GB', …) renders DD/MM/YYYY.",
  },
];

const CSS_RULES = [
  {
    name: 'raw colour outside the token block',
    re: /(?:#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(\s*\d+\s*,)/,
    hint: `Add it to globals.css §1 as a token, or mark the line ${ALLOW} if it is a deliberate exception (e.g. a theme preview swatch).`,
  },
  {
    name: 'off-scale font-size',
    // Extract each declared value rather than lookahead — a lookahead after
    // `\s*` backtracks into the whitespace and matches every line.
    // `clamp(var(--t-3xl), …)` is fine: a fluid range anchored to the scale.
    check: (line) =>
      [...line.matchAll(/font-size:\s*([^;}]+)/g)].some(([, value]) => {
        const v = value.trim();
        return !(v.startsWith('var(') || v.startsWith('clamp(') || v === 'inherit' || v.endsWith('em'));
      }),
    hint: 'Use a --t-* token. The scale is 10/11/12/13/14/16/20/26/34px; values like 12.75px are how the scale rotted last time.',
  },
  {
    name: 'off-scale font-weight',
    check: (line) =>
      [...line.matchAll(/font-weight:\s*([^;}]+)/g)].some(([, value]) => {
        const v = value.trim();
        return !(v.startsWith('var(') || v === 'inherit');
      }),
    hint: 'Use --w-nm/--w-md/--w-sb/--w-bd (400/500/600/700). Note 650 has no static instance and silently renders as 700.',
  },
  {
    name: 'literal font family',
    re: /font-family:[^;]*["'](?:Inter|JetBrains Mono|Fraunces)["']/,
    hint: 'next/font emits a hashed family name; ask for var(--font-inter)/var(--font-jetbrains) via --f-body/--f-mono, or the face never loads.',
  },
];

function walk(dir, prefix = '', exts = ['.tsx']) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel, exts));
    else if (exts.some((e) => rel.endsWith(e))) out.push(rel);
  }
  return out;
}

const violations = [];

function scan(relPath, source, rules, { skipUntil } = {}) {
  const lines = source.split('\n');
  let live = !skipUntil;
  lines.forEach((line, i) => {
    if (!live) {
      if (line.includes(skipUntil)) live = true;
      return;
    }
    if (line.includes(ALLOW)) return;
    for (const rule of rules) {
      const hit = rule.check ? rule.check(line) : rule.re.test(line);
      if (hit) {
        violations.push(`${relPath}:${i + 1} — ${rule.name}\n    ${line.trim().slice(0, 120)}\n    fix: ${rule.hint}`);
      }
    }
  });
}

// --- components and routes ---
for (const dir of ['app', 'components']) {
  for (const rel of walk(join(ROOT, dir))) {
    const relPath = `${dir}/${rel}`;
    if (EXEMPT_TSX.has(relPath)) continue;
    scan(relPath, readFileSync(join(ROOT, dir, rel), 'utf8'), TSX_RULES);
  }
}

// --- the stylesheet, from the end of the token block onward ---
scan('app/globals.css', readFileSync(join(ROOT, 'app/globals.css'), 'utf8'), CSS_RULES, {
  skipUntil: '2 · TAILWIND BRIDGE',
});

if (violations.length) {
  console.error(`\nui-guard: ${violations.length} design-system violation(s)\n\n${violations.join('\n\n')}\n`);
  process.exit(1);
}
console.log('ui-guard: clean');
