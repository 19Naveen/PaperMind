import type { MarketplacePack } from './types';

/**
 * Display metadata for the Marketplace page. The backend listPacks returns
 * live Pack rows; this seed supplies the catalogue copy (category, blurb,
 * node/asset counts, installs, author) that the Pack model doesn't carry yet.
 */

export const MARKETPLACE_PACKS: MarketplacePack[] = [
  { id: 'kyc-checker', category: 'Compliance', name: 'KYC Checker', description: 'Document validation, identity extraction and policy checks for customer onboarding.', nodes: 7, assets: 11, installs: '2,140', author: 'papermind' },
  { id: 'invoice-reconciler', category: 'Finance', name: 'Invoice Reconciler', description: 'Matches supplier invoices against purchase orders and flags variance over threshold.', nodes: 5, assets: 6, installs: '1,806', author: 'ledgerworks' },
  { id: 'contract-clause-review', category: 'Legal', name: 'Contract Clause Review', description: 'Extracts obligations, termination and liability clauses into a reviewable matrix.', nodes: 9, assets: 14, installs: '1,412', author: 'm.ostwald' },
  { id: 'rfp-response-builder', category: 'Operations', name: 'RFP Response Builder', description: 'Answers RFP question sets from an approved knowledge base and drafts the response doc.', nodes: 8, assets: 23, installs: '974', author: 'bidteam' },
  { id: 'lab-report-digest', category: 'Research', name: 'Lab Report Digest', description: 'Turns instrument PDFs into a structured dataset with per-sample summaries.', nodes: 6, assets: 4, installs: '613', author: 'k.sandoval' },
  { id: 'adverse-media-scan', category: 'Compliance', name: 'Adverse Media Scan', description: 'Screens named subjects against news sources and writes a cited risk note.', nodes: 6, assets: 8, installs: '508', author: 'papermind' },
];
