/**
 * Local stand-in for the PaperMind FastAPI backend — DEVELOPMENT ONLY.
 *
 * Purpose: let the frontend be run and reviewed without the Python backend and
 * its pgvector Postgres. It serves the exact response shapes declared in
 * `web/lib/api.ts` with obviously-fake sample content.
 *
 *   npm run dev:api     # this server, on :8001
 *   npm run dev:local   # this server + next dev, wired together
 *
 * IT AUTHENTICATES ANYBODY. `POST /auth/login` returns a session cookie for any
 * email and any password, because its whole job is to get you into the UI. That
 * is why it must never be reachable from anywhere but localhost and must never
 * be what `PAPERMIND_API_URL` points at outside development. The auth bypass
 * lives HERE, in a dev tool, and deliberately not in the application: a
 * conditional bypass inside the app is the kind of thing that survives to
 * production.
 *
 * No real personal data: the sample user is reviewer@example.com and every
 * document, entity and case is invented.
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || 8001);
const COOKIE = 'papermind_session';
const TOKEN = 'stub-session-token';

const ISO = (d) => new Date(d).toISOString();
const T0 = Date.parse('2026-08-10T09:15:00Z');
const day = 86400000;

// ----------------------------------------------------------------- sample data

const user = { id: 'u1', email: 'reviewer@example.com', name: 'Sample Reviewer', role: 'examiner' };

const packSpec = (name) => ({
  name,
  document_types: ['passport', 'bank_statement', 'utility_bill', 'contract'],
  fields: [
    { name: 'legal_entity_name', description: 'Registered name of the counterparty', type: 'string' },
    { name: 'governing_law', description: 'Jurisdiction clause', type: 'string' },
    { name: 'termination_notice_days', description: 'Notice period in days', type: 'number' },
    { name: 'liability_cap', description: 'Cap on aggregate liability', type: 'string' },
    { name: 'address_match', description: 'Address agrees across documents', type: 'boolean' },
  ],
  rules: [
    { id: 'RULE-01', description: 'Legal entity name must match across all documents' },
    { id: 'RULE-02', description: 'Governing law must be stated explicitly' },
    { id: 'RULE-03', description: 'Termination notice must be at least 30 days' },
    { id: 'RULE-04', description: 'Liability cap must be present and quantified' },
    { id: 'RULE-05', description: 'Proof of address must be dated within 90 days' },
  ],
});

const workflow = (name) => ({
  schema_version: 1,
  name,
  document_types: ['passport', 'bank_statement', 'utility_bill', 'contract'],
  nodes: [
    { id: 'n_classify', kind: 'classify_documents', config: { types: ['contract', 'passport'] }, retry: { max_attempts: 2, timeout_seconds: 30 }, on_failure: 'fail_run' },
    { id: 'n_retrieve', kind: 'retrieve_evidence', config: { top_k: 8 }, retry: { max_attempts: 3, timeout_seconds: 45 }, on_failure: 'fail_run' },
    { id: 'n_entity', kind: 'extract_field', config: { field: 'legal_entity_name' }, retry: { max_attempts: 2, timeout_seconds: 30 }, on_failure: 'continue_with_null' },
    { id: 'n_law', kind: 'extract_field', config: { field: 'governing_law' }, retry: { max_attempts: 2, timeout_seconds: 30 }, on_failure: 'continue_with_null' },
    { id: 'n_notice', kind: 'extract_field', config: { field: 'termination_notice_days' }, retry: { max_attempts: 2, timeout_seconds: 30 }, on_failure: 'continue_with_null' },
    { id: 'n_verify', kind: 'verify_field', config: { require_citation: true }, retry: { max_attempts: 2, timeout_seconds: 30 }, on_failure: 'fail_run' },
    { id: 'n_rule03', kind: 'evaluate_rule', config: { rule_id: 'RULE-03' }, retry: { max_attempts: 1, timeout_seconds: 20 }, on_failure: 'skip_node' },
    { id: 'n_report', kind: 'render_checklist', config: { include_citations: true }, retry: { max_attempts: 1, timeout_seconds: 20 }, on_failure: 'fail_run' },
  ],
  edges: [
    { from: { node_id: 'n_classify', port: 'documents' }, to: { node_id: 'n_retrieve', port: 'documents' } },
    { from: { node_id: 'n_retrieve', port: 'evidence' }, to: { node_id: 'n_entity', port: 'evidence' } },
    { from: { node_id: 'n_retrieve', port: 'evidence' }, to: { node_id: 'n_law', port: 'evidence' } },
    { from: { node_id: 'n_retrieve', port: 'evidence' }, to: { node_id: 'n_notice', port: 'evidence' } },
    { from: { node_id: 'n_entity', port: 'fact' }, to: { node_id: 'n_verify', port: 'facts' } },
    { from: { node_id: 'n_law', port: 'fact' }, to: { node_id: 'n_verify', port: 'facts' } },
    { from: { node_id: 'n_notice', port: 'fact' }, to: { node_id: 'n_rule03', port: 'fact' }, when: { fact_state_is: { path: 'n_notice.fact', state: 'verified' } } },
    { from: { node_id: 'n_verify', port: 'facts' }, to: { node_id: 'n_report', port: 'facts' } },
    { from: { node_id: 'n_rule03', port: 'result' }, to: { node_id: 'n_report', port: 'rules' } },
  ],
  outputs: [{ name: 'checklist', node_id: 'n_report', port: 'checklist', contract: { kind: 'checklist', include_citations: true } }],
  integrations: [{ name: 'ocr', operation: 'extract_text' }],
});

const cite = (docId, docName, page, quote) => ({
  chunk_id: `c_${docId}_${page}`,
  quote,
  document_id: docId,
  document_name: docName,
  page,
  char_start: 0,
  char_end: quote.length,
});

const facts = [
  { id: 'f1', case_id: 'case1', field: 'legal_entity_name', value: 'Meridian Logistics Pte Ltd', state: 'verified',
    citations: [cite('d1', 'master_services_agreement.pdf', 3, 'This Agreement is entered into by Meridian Logistics Pte Ltd, a company incorporated in Singapore.')] },
  { id: 'f2', case_id: 'case1', field: 'governing_law', value: 'Singapore', state: 'verified',
    citations: [cite('d1', 'master_services_agreement.pdf', 14, 'This Agreement shall be governed by and construed in accordance with the laws of Singapore.')] },
  { id: 'f3', case_id: 'case1', field: 'termination_notice_days', value: '14', state: 'unsupported',
    citations: [cite('d1', 'master_services_agreement.pdf', 11, 'Either party may terminate on fourteen (14) days written notice.')] },
  { id: 'f4', case_id: 'case1', field: 'liability_cap', value: null, state: 'missing', citations: [] },
  { id: 'f5', case_id: 'case1', field: 'address_match', value: 'true', state: 'verified',
    citations: [
      cite('d2', 'utility_bill_june.pdf', 1, 'Service address: 21 Anson Road, #08-01, Singapore 079904.'),
      cite('d1', 'master_services_agreement.pdf', 1, 'Registered office: 21 Anson Road, #08-01, Singapore 079904.'),
    ] },
  { id: 'f6', case_id: 'case2', field: 'legal_entity_name', value: 'Kestrel Freight LLP', state: 'verified',
    citations: [cite('d3', 'vendor_contract_kestrel.pdf', 2, 'Between Kestrel Freight LLP ("Supplier") and the Company.')] },
  { id: 'f7', case_id: 'case2', field: 'governing_law', value: null, state: 'missing', citations: [] },
  { id: 'f8', case_id: 'case2', field: 'termination_notice_days', value: '30', state: 'verified',
    citations: [cite('d3', 'vendor_contract_kestrel.pdf', 9, 'Termination requires not less than thirty (30) days prior written notice.')] },
];

const completeRun = {
  id: 'run1', pack_id: 'p1', pack_name: 'Vendor Contract Review', pack_version: 3,
  status: 'complete', stage: null, started_at: ISO(T0 - 2 * day),
  cases: [{ id: 'case1', subject: 'Meridian Logistics — renewal' }, { id: 'case2', subject: 'Kestrel Freight — onboarding' }],
  documents: [
    { id: 'd1', case_id: 'case1', name: 'master_services_agreement.pdf', doc_type: 'contract' },
    { id: 'd2', case_id: 'case1', name: 'utility_bill_june.pdf', doc_type: 'utility_bill' },
    { id: 'd3', case_id: 'case2', name: 'vendor_contract_kestrel.pdf', doc_type: 'contract' },
    { id: 'd4', case_id: 'case2', name: 'passport_director.pdf', doc_type: 'passport' },
  ],
  facts,
};

const runningRun = {
  ...completeRun, id: 'run2', status: 'running', stage: 'verify', started_at: ISO(T0 - 3600_000),
  facts: facts.slice(0, 2),
};

const packs = [
  { id: 'p1', name: 'Vendor Contract Review', latest_version: 3, updated_at: ISO(T0 - 2 * day), installs: 128,
    document_types: ['contract', 'passport', 'utility_bill'], field_names: packSpec('x').fields.map((f) => f.name), rule_count: 5 },
  { id: 'p2', name: 'KYC Case Completeness', latest_version: 5, updated_at: ISO(T0 - 6 * day), installs: 302,
    document_types: ['passport', 'bank_statement', 'utility_bill'], field_names: ['full_name', 'date_of_birth', 'address', 'id_number'], rule_count: 8 },
  { id: 'p3', name: 'Quarterly Compliance Checklist', latest_version: 2, updated_at: ISO(T0 - 20 * day), installs: 54,
    document_types: ['policy', 'attestation'], field_names: ['policy_version', 'attested_by', 'attested_on'], rule_count: 12 },
  { id: 'p4', name: 'Invoice Three-Way Match', latest_version: 1, updated_at: ISO(T0 - 40 * day), installs: 17,
    document_types: ['invoice', 'purchase_order', 'goods_receipt'], field_names: ['invoice_total', 'po_total', 'received_qty'], rule_count: 6 },
];

const versions = (packId, n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${packId}_v${i + 1}`, version: i + 1, created_at: ISO(T0 - (n - i) * 5 * day),
    spec: packSpec(packs.find((p) => p.id === packId)?.name ?? 'Pack'), contract_version: 1,
  }));

const msgs = [
  { role: 'user', content: 'Check every contract for governing law, termination notice and a liability cap.' },
  { role: 'assistant', content: 'I drafted five fields and five rules. Termination notice is flagged when under 30 days.' },
];

const sessions = [
  { id: 's1', title: 'August renewals batch', status: 'complete', run_id: 'run1', subject: 'Meridian Logistics — renewal', messages: msgs, created_at: ISO(T0 - 3 * day), updated_at: ISO(T0 - 2 * day) },
  { id: 's2', title: 'Kestrel onboarding', status: 'running', run_id: 'run2', subject: 'Kestrel Freight — onboarding', messages: msgs, created_at: ISO(T0 - day), updated_at: ISO(T0 - 3600_000) },
  { id: 's3', title: 'Q3 spot check', status: 'draft', run_id: null, subject: null, messages: [], created_at: ISO(T0 - 6 * 3600_000), updated_at: ISO(T0 - 6 * 3600_000) },
  { id: 's4', title: 'Failed import retry', status: 'failed', run_id: null, subject: 'Batch 22', messages: [], created_at: ISO(T0 - 8 * day), updated_at: ISO(T0 - 8 * day) },
];

const workspaces = [
  { id: 'w1', name: 'Vendor Contracts 2026', goal: 'Check every vendor contract for the same ten clauses before renewal.',
    pack_id: 'p1', pack_name: 'Vendor Contract Review', pack_version: 3, session_count: 4, updated_at: ISO(T0 - 2 * day) },
  { id: 'w2', name: 'Customer Onboarding KYC', goal: 'Verify each onboarding case file is complete and internally consistent.',
    pack_id: 'p2', pack_name: 'KYC Case Completeness', pack_version: 5, session_count: 2, updated_at: ISO(T0 - 5 * day) },
  { id: 'w3', name: 'Q3 Compliance Sweep', goal: 'Re-run the quarterly compliance checklist with an audit trail.',
    pack_id: null, pack_name: null, pack_version: null, session_count: 0, updated_at: ISO(T0 - 9 * day) },
];

const assets = [
  { id: 'a1', name: 'master_services_agreement.pdf', meta: { pages: 24 } },
  { id: 'a2', name: 'utility_bill_june.pdf', meta: { pages: 2 } },
  { id: 'a3', name: 'vendor_contract_kestrel.pdf', meta: { pages: 18 } },
];

const detail = (ws) => ({
  ...ws,
  sessions: ws.id === 'w1' ? sessions : ws.id === 'w2' ? sessions.slice(0, 2) : [],
  assets: ws.pack_id ? assets : [],
});

const studioSession = {
  id: 'st1', pack_id: 'p1', title: 'Vendor Contract Review — v4 draft', status: 'draft',
  draft: packSpec('Vendor Contract Review'), created_at: ISO(T0 - 4 * 3600_000),
  workspace_id: 'w1', created_by_id: 'u1', base_pack_version_id: 'p1_v3',
  current_revision: {
    revision_no: 3, digest: 'sha256:9f2c41ab',
    validation: { ok: false, errors: [{ code: 'MISSING_CITATION_REQUIREMENT', path: 'nodes.n_notice', message: 'Extract node has no verify_field consumer, so its fact can never reach verified.' }] },
    diff: [
      { op: 'add', path: 'nodes.n_rule03', next: { kind: 'evaluate_rule' } },
      { op: 'replace', path: 'nodes.n_notice.config.field', prev: 'notice_days', next: 'termination_notice_days' },
      { op: 'remove', path: 'nodes.n_legacy_ocr' },
    ],
    workflow: workflow('Vendor Contract Review'),
  },
  turns: [
    { id: 't1', session_id: 'st1', role: 'user', content: 'Add a rule that termination notice under 30 days is flagged.', model_id: null, status: 'complete', revision_id: 'r1', created_at: ISO(T0 - 4 * 3600_000) },
    { id: 't2', session_id: 'st1', role: 'assistant', content: 'Added RULE-03 and wired an evaluate_rule node downstream of the notice extractor.', model_id: 'claude-opus-5', status: 'complete', revision_id: 'r2', created_at: ISO(T0 - 3.5 * 3600_000) },
    { id: 't3', session_id: 'st1', role: 'user', content: 'Rename the notice field so it matches the checklist column.', model_id: null, status: 'complete', revision_id: 'r3', created_at: ISO(T0 - 3 * 3600_000) },
    { id: 't4', session_id: 'st1', role: 'assistant', content: 'Renamed to termination_notice_days. Validation still reports one error — the field has no verifier.', model_id: 'claude-opus-5', status: 'complete', revision_id: 'r3', created_at: ISO(T0 - 2.5 * 3600_000) },
  ],
};

const reviews = [
  { id: 'rv1', pack_id: 'p1', revision_id: 'r3', submitted_by: 'u1', submitted_at: ISO(T0 - 2 * day), approved_by: null, approved_at: null, state: 'pending', validation_digest: 'sha256:9f2c41ab' },
  { id: 'rv2', pack_id: 'p1', revision_id: 'r2', submitted_by: 'u1', submitted_at: ISO(T0 - 9 * day), approved_by: 'u1', approved_at: ISO(T0 - 8 * day), state: 'approved', validation_digest: 'sha256:1188aa02' },
];
const releases = [
  { id: 'rl1', pack_id: 'p1', pack_version_id: 'p1_v3', environment: 'production', action: 'promote', source_release_id: null, restored_from_release_id: null, created_by: 'u1', created_at: ISO(T0 - 8 * day) },
  { id: 'rl2', pack_id: 'p1', pack_version_id: 'p1_v2', environment: 'staging', action: 'promote', source_release_id: null, restored_from_release_id: null, created_by: 'u1', created_at: ISO(T0 - 15 * day) },
];
const audit = [
  { id: 'ae1', pack_id: 'p1', event_type: 'version_published', actor_id: 'u1', revision_id: 'r2', version_id: 'p1_v3', release_id: null, environment: null, metadata: { version: 3 }, created_at: ISO(T0 - 8 * day) },
  { id: 'ae2', pack_id: 'p1', event_type: 'release_promoted', actor_id: 'u1', revision_id: null, version_id: 'p1_v3', release_id: 'rl1', environment: 'production', metadata: {}, created_at: ISO(T0 - 8 * day) },
  { id: 'ae3', pack_id: 'p1', event_type: 'review_submitted', actor_id: 'u1', revision_id: 'r3', version_id: null, release_id: null, environment: null, metadata: {}, created_at: ISO(T0 - 2 * day) },
];

// -------------------------------------------------------------------- routing

const json = (res, status, body, headers = {}) => {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
};
const fail = (res, status, code, message) => json(res, status, { error: { code, message, details: {} } });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;
  const authed = (req.headers.cookie || '').includes(`${COOKIE}=`);
  const seg = p.split('/').filter(Boolean);

  let body = null;
  if (m !== 'GET' && m !== 'DELETE') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  }

  const setCookie = { 'set-cookie': `${COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Lax` };

  // --- auth
  if (p === '/auth/login' && m === 'POST') return json(res, 200, user, setCookie);
  if (p === '/auth/signup' && m === 'POST') return json(res, 201, { ...user, email: body?.email ?? user.email, name: body?.name ?? user.name }, setCookie);
  if (p === '/auth/logout') return json(res, 204, undefined, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
  if (p === '/auth/me') {
    if (!authed) return fail(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
    if (m === 'PATCH') return json(res, 200, { ...user, ...(body?.name ? { name: body.name } : {}), ...(body?.email ? { email: body.email } : {}) });
    return json(res, 200, user);
  }
  if (p === '/auth/password' || p === '/auth/change-password') return json(res, 204, undefined);

  if (!authed) return fail(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');

  // --- workspaces
  if (p === '/workspaces' && m === 'GET') return json(res, 200, workspaces);
  if (p === '/workspaces' && m === 'POST') {
    const ws = { id: `w${workspaces.length + 1}`, name: body?.name ?? 'New workspace', goal: body?.goal ?? '', pack_id: body?.pack_id ?? null, pack_name: null, pack_version: null, session_count: 0, updated_at: ISO(Date.now()) };
    workspaces.push(ws);
    return json(res, 201, detail(ws));
  }
  if (seg[0] === 'workspaces' && seg[1]) {
    const ws = workspaces.find((w) => w.id === seg[1]);
    if (!ws) return fail(res, 404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
    if (seg.length === 2) {
      if (m === 'GET') return json(res, 200, detail(ws));
      if (m === 'PATCH') { Object.assign(ws, body || {}); return json(res, 200, detail(ws)); }
      if (m === 'DELETE') { workspaces.splice(workspaces.indexOf(ws), 1); return json(res, 204, undefined); }
    }
    if (seg[2] === 'pack' && m === 'POST') {
      const pk = packs.find((x) => x.id === body?.pack_id) || packs[0];
      Object.assign(ws, { pack_id: pk.id, pack_name: pk.name, pack_version: pk.latest_version });
      return json(res, 200, detail(ws));
    }
    if (seg[2] === 'sessions') {
      const list = detail(ws).sessions;
      if (seg.length === 3 && m === 'GET') return json(res, 200, list);
      if (seg.length === 3 && m === 'POST') {
        const s = { id: `s${Date.now()}`, title: body?.title ?? 'New session', status: 'draft', run_id: null, subject: body?.subject ?? null, messages: [], created_at: ISO(Date.now()), updated_at: ISO(Date.now()) };
        sessions.push(s);
        return json(res, 201, s);
      }
      const s = list.find((x) => x.id === seg[3]) || sessions.find((x) => x.id === seg[3]);
      if (!s) return fail(res, 404, 'SESSION_NOT_FOUND', 'Session not found');
      if (seg.length === 4 && m === 'GET') return json(res, 200, s);
      if (seg.length === 4 && (m === 'PATCH' || m === 'PUT')) { Object.assign(s, body || {}); return json(res, 200, s); }
      if (seg.length === 4 && m === 'DELETE') return json(res, 204, undefined);
      if (seg[4] === 'run') { s.status = 'running'; s.run_id = 'run2'; return json(res, 202, runningRun); }
    }
  }

  // --- runs
  if (seg[0] === 'runs' && seg[1]) {
    const r = seg[1] === 'run1' ? completeRun : runningRun;
    return json(res, 200, r);
  }

  // --- packs
  if (p === '/packs' && m === 'GET') return json(res, 200, packs);
  if (seg[0] === 'packs' && seg[1]) {
    const pk = packs.find((x) => x.id === seg[1]);
    if (!pk) return fail(res, 404, 'PACK_NOT_FOUND', 'Pack not found');
    if (seg.length === 2) return json(res, 200, { pack: pk, versions: versions(pk.id, pk.latest_version) });
    if (seg[2] === 'versions') {
      if (m === 'GET') return json(res, 200, versions(pk.id, pk.latest_version));
      if (m === 'POST') return json(res, 201, versions(pk.id, pk.latest_version + 1).at(-1));
    }
  }

  // --- studio
  if (p === '/studio/sessions' && m === 'GET') return json(res, 200, [studioSession]);
  if (p === '/studio/sessions' && m === 'POST') return json(res, 201, studioSession);
  if (seg[0] === 'studio' && seg[1] === 'sessions' && seg[2]) {
    if (seg.length === 3) return json(res, 200, studioSession);
    if (seg[3] === 'preview') return json(res, 200, { spec: packSpec('Vendor Contract Review'), facts: facts.slice(0, 5).map(({ field, value, state, citations }) => ({ field, value, state, citations })) });
    if (seg[3] === 'revisions') {
      const rev = { id: 'r3', session_id: 'st1', revision_no: 3, parent_id: 'r2', workflow: workflow('Vendor Contract Review'), diff: studioSession.current_revision.diff, validation: studioSession.current_revision.validation, digest: 'sha256:9f2c41ab', model_id: 'claude-opus-5', created_by_id: 'u1', created_at: ISO(T0 - 2.5 * 3600_000) };
      return json(res, 200, seg[4] ? rev : [rev]);
    }
  }

  // --- governance
  if (seg[0] === 'governance') {
    if (seg[1] === 'packs' && seg[3] === 'reviews') return json(res, 200, reviews);
    if (seg[1] === 'packs' && seg[3] === 'releases') return json(res, m === 'POST' ? 201 : 200, m === 'POST' ? releases[0] : releases);
    if (seg[1] === 'packs' && seg[3] === 'audit') return json(res, 200, audit);
    if (seg[1] === 'reviews' && m === 'POST' && seg.length === 2) return json(res, 201, reviews[0]);
    if (seg[1] === 'reviews' && seg[3] === 'decision') return json(res, 200, { review: { ...reviews[0], state: body?.approve ? 'approved' : 'rejected' }, version: versions('p1', 4).at(-1) });
    if (seg[1] === 'releases' && seg[3] === 'restore') return json(res, 201, releases[0]);
  }

  // --- documents
  if (p === '/documents') return json(res, m === 'POST' ? 201 : 200, m === 'POST' ? { id: `d${Date.now()}`, name: 'uploaded.pdf', content_type: 'application/pdf' } : assets.map((a) => ({ id: a.id, name: a.name, content_type: 'application/pdf' })));

  if (p === '/health') return json(res, 200, { status: 'healthy', stub: true });

  return fail(res, 404, 'NOT_FOUND', `stub has no route for ${m} ${p}`);
});

// Loopback only, explicitly. This server hands a session cookie to anyone who
// asks, so it must not be reachable from the network — including from other
// machines on the same LAN, which a default all-interfaces bind would allow.
server.listen(PORT, '127.0.0.1', () =>
  console.log(`dev PaperMind API on http://127.0.0.1:${PORT}  (development only — authenticates anybody)`),
);
