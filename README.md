# PaperMind

**AI-Powered Document Intelligence Platform**

PaperMind turns document review workflows into reusable, verifiable automation. Instead of chatting with an AI about a document and starting from zero next time, you build the workflow once — as a **Knowledge Pack** — and run it against any number of documents, forever, with the same rules every time.

---

## Table of Contents

- [Why PaperMind Exists](#why-papermind-exists)
- [What PaperMind Is Not](#what-papermind-is-not)
- [Core Concept: Author Once, Execute Many Times](#core-concept-author-once-execute-many-times)
- [Design Principles](#design-principles)
- [How It Works](#how-it-works)
- [Product Surfaces](#product-surfaces)
- [Architecture](#architecture)
- [Knowledge Pack](#knowledge-pack)
- [Execution Pipeline](#execution-pipeline)
- [Storage Model](#storage-model)
- [Technology Stack](#technology-stack)
- [Repository Layout](#repository-layout)
- [Getting Started](#getting-started)
- [Roadmap](#roadmap)
- [Guiding Rule for New Capabilities](#guiding-rule-for-new-capabilities)
- [Example Use Cases](#example-use-cases)
- [FAQ](#faq)
- [Long-Term Vision](#long-term-vision)

---

## Why PaperMind Exists

Most AI document tools follow the same pattern:

```
Upload document → Ask a question → Read an answer → Conversation lost
```

This works for a single question about a single document. It breaks down the moment your real problem looks like this instead:

- Check **400 vendor contracts** for the same 10 clauses, consistently
- Verify a **case file** (passport, proof of address, bank statement, certificate) is complete and internally consistent before onboarding a customer
- Re-run the **same compliance checklist** every quarter, on new documents, with an audit trail
- Know **exactly which sentence** in which document justified an answer — not just get a paragraph and hope it's right

Generic chat doesn't scale to this. Every session starts from zero, answers aren't reproducible, and there's no way to prove where an answer came from.

PaperMind is built around a different unit of value: not an answer, but a **workflow you can trust and reuse**.

---

## What PaperMind Is Not

To be specific about scope, PaperMind deliberately does **not** try to be:

- **A ChatGPT-style document chatbot.** Chat exists as a utility inside PaperMind, not as the product.
- **An autonomous agent that makes business decisions.** The runtime never invents or adjusts rules on its own — see [Design Principles](#design-principles).
- **A general-purpose knowledge graph platform.** Relationships are modeled only from verified, cited facts — never inferred speculatively from raw text.
- **A code-execution sandbox for arbitrary logic.** Knowledge Packs are declarative specifications, not scripts.

---

## Core Concept: Author Once, Execute Many Times

```
Describe the workflow
        ↓
AI helps build a draft
        ↓
You review and approve
        ↓
Save as a Knowledge Pack (v1)
        ↓
Execute against any document set, indefinitely
        ↓
Corrections during use → proposed v2 → reviewed → promoted
```

A **Knowledge Pack** defines:

- What documents are expected
- What fields should be extracted
- What rules must be validated
- What cross-document checks must pass
- What reports or checklists should be produced

Creating a Pack is conversational — an AI assistant asks clarifying questions and proposes a draft. **Using** a Pack is not conversational at all: it's a deterministic execution against your documents, producing the same structured, cited output every time.

---

## Design Principles

| # | Principle | What it means |
|---|---|---|
| 1 | **Author once** | Knowledge Packs are created once, through a guided authoring session. |
| 2 | **Execute many times** | The same Pack runs against unlimited document sets, on demand. |
| 3 | **Review before save** | The AI proposes a draft Pack. A human approves it before it can run. Nothing executes unreviewed. |
| 4 | **Deterministic runtime** | Business logic never changes mid-execution. The runtime has no discretion over rules. |
| 5 | **Evidence first** | Every extracted value must be backed by a citation to its source. No citation, no result — the field is flagged, not guessed. |
| 6 | **Version everything** | Knowledge Packs are immutable once saved. Editing a Pack creates a new version; nothing is silently mutated. |
| 7 | **Platform before features** | A capability is added only once a real Pack demonstrably requires it — see [Guiding Rule](#guiding-rule-for-new-capabilities). |

---

## How It Works

**Step 1 — Describe the workflow.**
You tell PaperMind what you're trying to check, in plain language. Optionally, you upload your organization's own policies or example documents so the Pack reflects your actual rules, not generic defaults.

**Step 2 — AI drafts the Pack.**
The assistant asks clarifying questions where your policy is ambiguous or unstated ("Do you require a DPA for all vendors, or only those outside the EU?") and proposes required document types, checklist items, and validation rules.

**Step 3 — You review and save.**
Nothing runs until you've reviewed the draft. Once approved, it's saved as **Knowledge Pack v1** — a frozen, versioned specification.

**Step 4 — Run it.**
Upload documents. The runtime classifies, retrieves, extracts, verifies, and cross-validates — with zero reasoning about business rules at this stage. It only executes what the Pack specifies.

**Step 5 — Correct and evolve.**
If a result is wrong, you correct it. Corrections are logged, not silently applied. Once a pattern of corrections accumulates, PaperMind proposes a diff to the Pack. You review it and, if you approve, it's promoted to **v2**. The Pack you ran in March and the Pack you run in June are never different unless you explicitly promoted a new version in between.

---

## Product Surfaces

One execution engine powers five different ways of viewing results. *Checklist is the Phase 1 target; the rest are the design destination — see [implementation status](#current-implementation-status).*

### Checklist
Verify that a single case file is complete and compliant.

```
Vendor ABC Ltd

✓ Proof of Identity        — verified
✓ Proof of Address         — verified
❌ Bank Statement           — missing
⚠  Passport                — expired (issued 2019, policy requires < 2 years)
```

### Grid
Compare the same fields across many similar documents.

```
                Contract A     Contract B     Contract C
Liability Cap   $500,000       Not found      $1,000,000
Renewal         Auto           Manual         Auto
Jurisdiction    New York       Delaware       California
```

### Rollup
Aggregate findings across an entire portfolio of cases.

```
412 Vendors Reviewed

Proof of Identity Missing     18
Documents Expired             41
Fully Compliant               353
```

### Diff
Compare two versions of the same document and see exactly what changed.

```
Contract v1 → Contract v2

Added:     New indemnification clause (Section 9)
Modified:  Liability cap: $500,000 → $1,000,000
Removed:   —
```

### Explorer
Navigate verified facts and their relationships — built entirely on facts that already passed verification, never on raw, unverified extraction.

---

## Architecture

```
                              PaperMind

┌────────────────────────────────────────────────────────────┐
│                        Product Layer                        │
│                                                              │
│   Pack Studio · Checklist · Grid · Rollups · Diff · Explorer │
│   · Reports                                                  │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                       Runtime Engine                         │
│                                                              │
│   Classify → Retrieve → Extract → Verify → Cross-Validate    │
│   → Report                                                    │
│                                                              │
│   No reasoning about business logic happens here.             │
│   The runtime only executes what the Pack specifies.          │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                      Capability Layer                        │
│                                                              │
│   Search · Extraction · Verification · Classification ·       │
│   Relationship Analysis · Computation · Vision · Reporting     │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                      │
│                                                              │
│   PostgreSQL · OpenSearch · Object Storage ·                  │
│   Graph Engine (Phase 2) · Python Sandbox (Phase 2)           │
└────────────────────────────────────────────────────────────┘
```

**The key architectural rule: intelligence lives in authoring, not in execution.** The Pack Studio (where a Pack is created) uses an LLM extensively — to ask questions, propose rules, and draft a specification. The Runtime Engine (where a Pack is executed) uses AI models only to perform the specific extraction and verification steps the Pack defines — never to decide what those steps should be. This is what makes results reproducible: the same Pack, run against the same documents, produces the same output, because no part of the runtime is free to interpret or improvise.

### Core Components

**Pack Studio** — Conversational authoring surface. Asks clarifying questions, builds a workflow draft, lets you preview outputs on sample documents, and produces a Pack for review and save.

**Knowledge Pack** — A declarative specification (not a prompt, not a conversation). Contains document types, checklist definitions, validation rules, cross-document rules, and report templates. Explicitly does **not** contain chat history, runtime prompts, or autonomous reasoning of any kind.

**Runtime Engine** — Deterministic execution pipeline. Same six stages every run: Classification → Retrieval → Extraction → Verification → Cross-Validation → Reporting.

---

## Knowledge Pack

A Pack is the product's central artifact — the thing you build once and reuse forever.

**Contains:**
- Metadata (name, version, author)
- Supported document types
- Checklist / field definitions
- Validation rules
- Cross-document rules
- Report templates
- Output configuration

**Does not contain:**
- Chat history or conversation memory
- Runtime prompts
- Any form of autonomous reasoning

### Lifecycle

```
Describe workflow
        ↓
Upload policies / example documents
        ↓
AI proposes a draft
        ↓
User reviews
        ↓
Knowledge Pack v1 (saved, frozen)
        ↓
Execute against real documents
        ↓
Corrections logged during use
        ↓
Draft v2 proposed from correction patterns
        ↓
User reviews
        ↓
Knowledge Pack v2 (saved, frozen)
```

No Pack changes automatically. Every version is immutable once saved; every run records exactly which Pack version produced it, so results are always auditable back to the exact rules that were in effect at the time.

---

## Execution Pipeline

**1. Document Classification**
Determine what kind of document this is (passport, bank statement, vendor contract, privacy policy) before anything else happens.

**2. Retrieval**
Find only the evidence relevant to the current field or check. Uses hybrid retrieval — BM25 keyword search plus dense semantic search, merged and reranked — rather than relying on a single retrieval strategy.

**3. Extraction**
Pull only the specific fields the Pack requests, as structured output — never a free-form summary of the whole document.

**4. Verification**
Every extracted value is checked against its cited source. Each field ends up in one of three states: **Verified**, **Unsupported**, or **Missing**. Unsupported and Missing fields are surfaced as gaps, never silently filled with a best guess.

**5. Cross-Validation**
Checks that span multiple documents in the same case — for example, does the name on the proof-of-identity document match the name on the proof-of-address document? Does the address match the company's registered address?

**6. Reporting**
Produces the requested output: checklist, grid, rollup, or executive summary — always with citations attached to every claim.

---

## Storage Model

| Store | Holds |
|---|---|
| **PostgreSQL** | Users, organizations, Packs, Pack versions, execution runs, extracted facts, citations, reports |
| **OpenSearch** | Embeddings, BM25 index, metadata index for hybrid retrieval |
| **Object Storage (S3-compatible)** | Original uploaded documents, images, generated reports and files |
| **Graph Engine** *(Phase 2)* | Verified relationships only — never raw, unverified LLM output |

---

## Technology Stack

**Frontend**
Next.js 16 (App Router, React 19) · TypeScript · Tailwind CSS v4 · a local component library ("Modernist" design system) — no UI framework dependency

**Backend**
FastAPI · SQLAlchemy 2.0 · Alembic · Pydantic v2 · `uv`

**AI**
LangChain (authoring orchestration) · LLM provider abstraction layer

**Search**
OpenSearch · BM25 · Vector Search · Reciprocal Rank Fusion · Reranker

**Database**
PostgreSQL

**Storage**
MinIO / S3-compatible object storage

---

## Repository Layout

```
backend/          FastAPI service — app/, alembic/, tests/ (uv + pyproject.toml)
web/              Next.js frontend — see web/README.md
docs/             specs.md, backend-plan.md, frontend-plan.md
Makefile          every dev command, run from the repository root
docker-compose.yml  local Postgres
```

---

## Getting Started

Requires Node 20+, Python 3.12+ with [`uv`](https://docs.astral.sh/uv/), and Docker (for Postgres).

```bash
make db-up              # start Postgres

make backend-install    # uv sync
make backend-migrate    # alembic upgrade head
make backend-run        # uvicorn on :8000

make frontend-install   # npm ci
make frontend-dev       # next dev on :3000
```

Run `make help` for the full target list. All targets must be invoked from the repository root.

**Checks** — a change is not done until these pass:

```bash
make backend-lint  backend-typecheck  backend-test
make frontend-lint frontend-typecheck frontend-build
```

### Current implementation status

| Area | State |
|---|---|
| Frontend UI | Complete across Home, Marketplace, Workspace, Pack builder, Session, and account screens — but **entirely mock-driven** (`web/lib/mock.ts`); no API calls yet |
| Backend | Schema, migrations, and service scaffolding in place; runtime pipeline in progress |
| Auth | `localStorage` stub on the frontend. Not a security boundary |
| Product surfaces | The **Checklist** surface is the Phase 1 target. Grid, Rollup, Diff, and Explorer are described below as the design destination, not as shipped features |

The frontend is organised around the **Workspace → Pack → Session** model: a workspace holds exactly one Pack, and each session is an isolated execution of it. See [`web/README.md`](./web/README.md) for the frontend architecture and design-system rules.

---

## Roadmap

### Phase 1 — Core Platform *(current focus)*
- Pack Studio (conversational authoring)
- Knowledge Packs (declarative spec, versioned)
- Hybrid retrieval (BM25 + vector + reranking)
- Structured extraction
- Verification and citations
- Checklist surface
- PostgreSQL + OpenSearch

### Phase 2 — Advanced Intelligence
- Graph engine (verified-fact relationships)
- Relationship Explorer surface
- Python computation engine (for numeric/aggregation-heavy Packs)
- Vision / OCR pipeline for scanned documents
- Cross-document reasoning
- Advanced report generation

### Phase 3 — Collaboration
- Pack import / export
- Private Pack sharing within an organization
- Team workspaces
- Organization-wide Pack libraries

### Phase 4 — Community
- Public Pack registry
- Versioned publishing
- Pack discovery and search
- Ratings and reviews
- Verified publishers

**Phases 2 through 4 are intentionally not built yet.** Each is gated behind evidence from real Packs — see below.

---

## Guiding Rule for New Capabilities

Every proposed capability — a new retrieval method, a graph database, code execution, a marketplace — must answer one question before it gets built:

> **Which existing Knowledge Pack cannot be implemented correctly without this capability?**

If no real Pack requires it yet, the capability stays on the roadmap as a labeled destination, not a build item. This is a deliberate constraint: it's what keeps the platform growing from proven, real workflows instead of speculative architecture, and it's the single rule most responsible for keeping Phase 1 buildable in a reasonable timeframe.

---

## Example Use Cases

- **Vendor due diligence** — Check a data room of contracts, DPAs, and privacy policies for GDPR compliance, liability caps, and consistency between documents.
- **KYC / customer onboarding** — Verify a case file (proof of identity, proof of address, bank statement, certificate of incorporation) is complete, unexpired, and internally consistent.
- **Lease abstraction** — Extract rent escalation, renewal options, and exclusive-use clauses across a portfolio of commercial leases.
- **Loan underwriting** — Confirm income on tax returns matches bank statements, and that all required documents are present and current.
- **RFP compliance** — Check a draft proposal against every mandatory requirement in an RFP before submission.

Each of these is the same engine — search, extract, verify, cite — configured differently through a Pack. None require new runtime capabilities beyond what Phase 1 already provides.

---

## FAQ

**Does the AI ever make decisions while running a Pack?**
No. All business-logic decisions — which documents are required, what counts as a valid match, what threshold applies — are fixed at the moment a Pack is saved. The runtime only executes what's already been approved.

**What happens if the AI can't find or confirm an answer?**
The field is marked **Unsupported** or **Missing** and left visibly flagged. PaperMind is designed to never fill a gap with a guess.

**Can a Pack change behavior over time without me knowing?**
No. Packs are immutable once saved. Corrections you make during use are logged, and PaperMind may later propose a new version based on a pattern of corrections — but nothing is promoted without your explicit review and approval.

**Is this a chatbot?**
Chat exists inside PaperMind as a utility for ad hoc questions, but it is not the product. The product is the Knowledge Pack — a reusable, auditable workflow.

**Why isn't there a knowledge graph yet?**
Graph capability is gated to Phase 2, and only once a real Pack demonstrably needs relationship traversal that checklist, grid, and cross-validation checks can't answer. When it is built, it will model only verified, cited facts — never entities inferred speculatively from raw text.

---

## Long-Term Vision

PaperMind aims to become the place experts share document workflows the way developers share code — not prompts, but versioned, reviewable, reusable **Knowledge Packs** that turn unstructured documents into trusted, evidence-backed outcomes.

The platform's long-term value isn't in generating answers. It's in capturing institutional knowledge — a compliance team's actual policies, a law firm's actual due diligence checklist — as a reusable, executable, auditable asset instead of something that lives in one person's head or gets re-typed into a spreadsheet every time.