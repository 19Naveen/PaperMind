import type {
  LibraryPack,
  MarketplacePack,
  Pack,
  PackAsset,
  PackNode,
  Workspace,
  WorkspaceSession,
} from './types';
import { newChat } from './types';

export const PACK_NODES: PackNode[] = [
  { num: '01', kicker: '01 · Intake', title: 'Document upload', sub: 'PDF · DOCX · XLSX · JPG', in: 'files[]', out: 'raw_docs[]', asset: 'accepted_types.json', prompt: 'Accept any customer-supplied file. Split multi-page scans into per-document units before classification.' },
  { num: '02', kicker: '02 · Classify', title: 'Document type', sub: 'Passport, utility bill, cert.', in: 'raw_docs[]', out: 'typed_docs[]', asset: 'doc_taxonomy.md', prompt: 'Label each document against the firm taxonomy. If confidence is below 0.8, mark it for review rather than guessing.' },
  { num: '03', kicker: '03 · Extract', title: 'Identity fields', sub: 'Schema: kyc_subject.json', in: 'typed_docs[]', out: 'kyc_subject', asset: 'kyc_subject.json', prompt: 'Extract name, date of birth, nationality, address, document number and expiry into the kyc_subject schema. Never infer a missing field.' },
  { num: '04', kicker: '04 · Rules', title: 'Org policy check', sub: 'Policy handbook v4', in: 'kyc_subject', out: 'policy_result', asset: 'policy_handbook_v4.pdf', prompt: 'Apply the onboarding policy: proof of address under 90 days old, ID valid for 6+ months, enhanced diligence for high-risk jurisdictions.' },
  { num: '05', kicker: '05 · Verify', title: 'Sanctions & PEP', sub: 'Watchlist · added by AI', in: 'kyc_subject', out: 'screening_hits[]', asset: 'watchlists.csv', prompt: 'Screen the subject against the sanctions and PEP lists. Report fuzzy matches above 85% with the matched alias and list source.' },
  { num: '06', kicker: '06 · Compose', title: 'Findings summary', sub: 'Flags, gaps, risk band', in: 'policy_result, screening_hits[]', out: 'findings', asset: 'findings_prompt.md', prompt: 'Write a two-paragraph findings summary, then a bullet list of open items. Assign a risk band of low, medium or high with a one-line reason.' },
  { num: '07', kicker: '07 · Output', title: 'KYC report', sub: 'Fills kyc_report.docx', in: 'findings, kyc_subject', out: 'report.docx', asset: 'kyc_report.docx', prompt: 'Fill the report template. Leave placeholders visibly marked as UNRESOLVED rather than removing them.' },
];

export const PACK_ASSETS: PackAsset[] = [
  { name: 'kyc_report.docx', meta: 'Word template · 4 pages' },
  { name: 'policy_handbook_v4.pdf', meta: 'Reference · 62 pages' },
  { name: 'kyc_subject.json', meta: 'Extraction schema · 18 fields' },
  { name: 'doc_taxonomy.md', meta: 'Reference · 31 document types' },
  { name: 'watchlists.csv', meta: 'Dataset · refreshed daily' },
  { name: 'findings_prompt.md', meta: 'Prompt · 1.4 kB' },
  { name: 'accepted_types.json', meta: 'Config' },
  { name: 'edge_cases.md', meta: 'Reference · 9 resolved cases' },
];

export const MARKETPLACE_PACKS: MarketplacePack[] = [
  { id: 'kyc-checker', category: 'Compliance', name: 'KYC Checker', description: 'Document validation, identity extraction and policy checks for customer onboarding.', nodes: 7, assets: 11, installs: '2,140', author: 'papermind' },
  { id: 'invoice-reconciler', category: 'Finance', name: 'Invoice Reconciler', description: 'Matches supplier invoices against purchase orders and flags variance over threshold.', nodes: 5, assets: 6, installs: '1,806', author: 'ledgerworks' },
  { id: 'contract-clause-review', category: 'Legal', name: 'Contract Clause Review', description: 'Extracts obligations, termination and liability clauses into a reviewable matrix.', nodes: 9, assets: 14, installs: '1,412', author: 'm.ostwald' },
  { id: 'rfp-response-builder', category: 'Operations', name: 'RFP Response Builder', description: 'Answers RFP question sets from an approved knowledge base and drafts the response doc.', nodes: 8, assets: 23, installs: '974', author: 'bidteam' },
  { id: 'lab-report-digest', category: 'Research', name: 'Lab Report Digest', description: 'Turns instrument PDFs into a structured dataset with per-sample summaries.', nodes: 6, assets: 4, installs: '613', author: 'k.sandoval' },
  { id: 'adverse-media-scan', category: 'Compliance', name: 'Adverse Media Scan', description: 'Screens named subjects against news sources and writes a cited risk note.', nodes: 6, assets: 8, installs: '508', author: 'papermind' },
];

const buildMessages = [
  { id: 'build-1', role: 'user' as const, content: 'Build a pack that checks customer onboarding documents against our policy handbook and fills the standard KYC report.' },
  { id: 'build-2', role: 'assistant' as const, content: 'Drafted a seven-step workflow. Uploads are classified, identity fields are extracted into a schema, then the policy handbook is applied before the report template is filled.' },
  { id: 'build-3', role: 'user' as const, content: 'Sanctions and PEP screening is missing. Add it after extraction and report fuzzy matches above 85%.' },
  { id: 'build-4', role: 'assistant' as const, content: 'Added a screening node between extraction and the findings summary. It reads the subject record, screens against watchlists.csv, and returns matched aliases with the list source.' },
];

function session(id: string, title: string, meta: string, status: WorkspaceSession['status'], subject: string, files: WorkspaceSession['files'], message: string, report: NonNullable<WorkspaceSession['report']>): WorkspaceSession {
  return { id, title, status, progress: status === 'complete' ? 100 : 0, meta, docs_label: `${files?.length ?? 0} files`, subject, updated: meta, files, report, messages: [{ id: `${id}-message`, role: 'assistant', content: message }] };
}

const onboardingSessions = [
  session('abc', 'Client ABC Holdings', 'Updated 4 min ago', 'complete', 'ABC Holdings Ltd · Anselm Brandt', [{ name: 'passport_brandt.pdf', size: '1.2 MB' }, { name: 'utility_bill_mar.pdf', size: '340 KB' }, { name: 'incorporation_cert.pdf', size: '890 KB' }], 'Run complete. 6 documents processed, 7 nodes executed.\n\nOne item needs your call: the date of birth on the passport scan reads 04/07/1981, but the shareholder register lists 07/04/1981. The policy check is on hold until this is resolved.', [{ k: 'Subject', v: 'Anselm Brandt (UBO, 62%)' }, { k: 'Entity', v: 'ABC Holdings Ltd · UK' }, { k: 'ID', v: 'Passport P8834912 · valid to 2031' }, { k: 'Address', v: 'Verified · bill dated 12 Mar 2026' }, { k: 'Screening', v: 'No sanctions or PEP hits' }, { k: 'Risk band', v: 'Low — pending DOB confirmation' }]),
  session('xyz', 'Client XYZ Ltd', 'Updated yesterday', 'complete', 'XYZ Ltd · Renata Kovač', [{ name: 'id_card_kovac.jpg', size: '2.1 MB' }, { name: 'lease_agreement.pdf', size: '1.7 MB' }], 'Run complete. All policy checks passed and the report is filled with no unresolved placeholders.', [{ k: 'Subject', v: 'Renata Kovač (Director)' }, { k: 'Entity', v: 'XYZ Ltd · Croatia' }, { k: 'ID', v: 'National ID 44-882 · valid to 2029' }, { k: 'Address', v: 'Verified · lease dated 2 Feb 2026' }, { k: 'Screening', v: 'No sanctions or PEP hits' }, { k: 'Risk band', v: 'Low' }]),
  session('july', 'July Compliance Review', 'Updated 3 days ago', 'complete', 'Batch · 14 onboarding files', [{ name: 'july_batch.zip', size: '38 MB' }, { name: 'review_scope.xlsx', size: '112 KB' }], 'Batch finished: 14 subjects reviewed, 2 flagged for enhanced diligence, 1 report left with unresolved placeholders.', [{ k: 'Scope', v: '14 subjects, July intake' }, { k: 'Flagged', v: '2 — high-risk jurisdiction' }, { k: 'Unresolved', v: '1 — missing proof of address' }, { k: 'Screening', v: '1 fuzzy PEP match (88%)' }, { k: 'Duration', v: '22 minutes' }, { k: 'Risk band', v: 'Mixed — see appendix' }]),
  session('nord', 'Nordwind GmbH', 'Awaiting upload', 'pending', 'Nordwind GmbH · no subject yet', [], 'Session created from the KYC Checker Pack. Upload the customer documents to start the run.', [{ k: 'Subject', v: '—' }, { k: 'Entity', v: 'Nordwind GmbH · Germany' }, { k: 'ID', v: 'Awaiting upload' }, { k: 'Address', v: 'Awaiting upload' }, { k: 'Screening', v: 'Not run' }, { k: 'Risk band', v: '—' }]),
];

const workspaces: Workspace[] = [
  { id: 'onb', name: 'Onboarding Compliance', goal: 'Validates onboarding documents, extracts identity data, applies the firm policy and fills the verification report.', status: 'ready', draft_label: 'Draft v4.2', pack_id: 'kyc-checker', pack_name: 'KYC Checker', pack_version: 'v4.2', pack_description: 'Validates customer onboarding documents, extracts structured identity data, applies the firm policy rules and fills the standard verification report. Every session in this workspace runs this exact Pack.', pack_category: 'Compliance', pack_published: false, pack_assets: PACK_ASSETS, chats: [{ id: 'main', title: 'Build conversation', messages: buildMessages }], nodes: [], edges: [], updated_at: '2026-08-05T09:00:00Z', sessions: onboardingSessions, usage: [26, 44, 38, 62, 54, 18, 12, 70, 86, 64, 92, 74, 48, 58] },
  { id: 'invoice', name: 'Supplier Invoices', goal: 'Matches supplier invoices against purchase orders and flags variance over the approval threshold.', status: 'ready', draft_label: 'Draft v2.0', pack_id: 'invoice-reconciler', pack_name: 'Invoice Reconciler', pack_version: 'v2.0', pack_description: 'Matches supplier invoices against purchase orders and flags variance over the approval threshold.', pack_category: 'Finance', pack_published: false, pack_assets: PACK_ASSETS.slice(0, 4), chats: [{ id: 'main', title: 'Build conversation', messages: buildMessages }], nodes: [], edges: [], updated_at: '2026-08-04T09:00:00Z', sessions: [session('inv-q3', 'Q3 supplier batch', 'Updated yesterday', 'complete', 'Q3 · 28 invoices', [{ name: 'invoices_q3.zip', size: '14 MB' }, { name: 'po_export.xlsx', size: '220 KB' }], 'Run complete. 28 invoices matched, 3 over the variance threshold and flagged.', [{ k: 'Scope', v: '28 invoices, Q3' }, { k: 'Matched', v: '25 against PO' }, { k: 'Flagged', v: '3 over threshold' }, { k: 'Missing PO', v: '0' }, { k: 'Duration', v: '6 minutes' }, { k: 'Risk band', v: 'Low' }])], usage: [20, 32, 42, 36, 52, 23, 35, 48, 38, 58, 44, 51, 35, 47] },
  { id: 'vendor', name: 'Vendor Due Diligence', goal: 'No Pack installed yet. Build one from a description, or install a published Pack.', status: 'draft', draft_label: null, pack_id: null, pack_name: null, pack_version: null, chats: [{ id: 'main', title: 'Build conversation', messages: [] }], nodes: [], edges: [], updated_at: '2026-08-03T09:00:00Z', sessions: [] },
];

export async function getWorkspaces(): Promise<Workspace[]> { return workspaces; }
export async function getWorkspace(id: string): Promise<Workspace | undefined> { return workspaces.find((workspace) => workspace.id === id); }
export async function getWorkspaceSession(workspaceId: string, sessionId: string): Promise<{ workspace: Workspace; session: WorkspaceSession } | undefined> { const workspace = await getWorkspace(workspaceId); const currentSession = workspace?.sessions.find((item) => item.id === sessionId); return workspace && currentSession ? { workspace, session: currentSession } : undefined; }
export async function getMarketplacePacks(): Promise<MarketplacePack[]> { return MARKETPLACE_PACKS; }

export const SAMPLE_WORKSPACE_ID = 'onb';
export function blankWorkspace(name: string, goal: string): Workspace { return { id: 'new', name, goal, status: 'draft', draft_label: null, pack_id: null, pack_name: null, pack_version: null, chats: [newChat('Build conversation')], nodes: [], edges: [], updated_at: new Date().toISOString(), sessions: [] }; }

// Compatibility exports retained for the creation wizard until it is replaced.
export async function getPacks(): Promise<Pack[]> { return []; }
export async function getPack(): Promise<undefined> { return undefined; }
export async function getRuns(): Promise<[]> { return []; }
export async function getRun(): Promise<undefined> { return undefined; }
export async function getDocument(): Promise<undefined> { return undefined; }
export async function getRunFields(): Promise<string[]> { return []; }
export async function getSessionRun(): Promise<undefined> { return undefined; }
export async function getLibraryPacks(): Promise<LibraryPack[]> { return []; }
