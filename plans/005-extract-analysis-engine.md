# Plan 005: Extract the PAN analysis engine out of page.tsx into a tested module

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 10cb7c1..HEAD -- src/app/page.tsx`
> If `page.tsx` changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-test-harness-and-parser-tests.md (the Vitest setup
  and parser tests must exist first — this plan adds tests for the extracted
  engine using the same harness)
- **Category**: tech-debt / architecture
- **Planned at**: commit `10cb7c1`, 2026-06-12

## Why this matters

`src/app/page.tsx` is 1098 lines and mixes everything: React state, a ~130-line
budget-analysis engine (the `analyzed` useMemo), a ~180-line Excel exporter, and
five sub-components. The analysis engine is the product's core logic — it turns a
parsed PAN + the budget bases into per-empresa/per-year verdicts and an overall
`ok | warn | unknown` status — yet it is **impossible to unit test** because it's
a closure inside a `useMemo` inside a `"use client"` component. This plan
extracts that pure logic into `src/lib/analyze.ts` and tests it, without changing
behavior. The exporter is intentionally left for a later plan to keep this change
reviewable.

## Current state

- `src/app/page.tsx:165-295` — the `analyzed` useMemo. It maps each `PanData`
  over: override application, CAPEX scaling, per-empresa matching via
  `matchEmpresaCode`/`matchTpCode`, TI-vs-PESE-vs-normal branching,
  `lookupBudgetByYear`/`lookupTiByYear`/`lookupPeseByYear`, per-year cells, and
  final `status` computation. It closes over `db, cnpj, peseDb, tiDb, overrides,
  statusOverrides`.
- Types `YearCell`, `PeseAnalysis`, `AnalyzedPan` are declared at
  `src/app/page.tsx:73-108`.
- The `Overrides` shape is inline in the `useState` at line 117:
  `Record<string, { tp?: string; empresas?: Record<string,string>; peseCode?: string; tiProgramas?: Record<string,string> }>`.
- All the budget functions it calls are already pure exports of
  `src/lib/budget-parser.ts`; `PanData` is from `src/lib/pan-parser.ts`.

Repo conventions: pure logic lives in `src/lib/*.ts`; React components import
from there. ESM, strict TS, path alias `@/*`. Tests follow the pattern
established by plan 001 in `src/lib/budget-parser.test.ts` (in-memory fixtures,
Vitest `describe/it/expect`, relative imports).

## Commands you will need

| Purpose   | Command                       | Expected on success |
|-----------|-------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`            | exit 0, no output   |
| Tests     | `npx vitest run`              | all pass            |
| Lint      | `npx eslint .`                | exit 0              |
| Build     | `bun run build`               | build succeeds      |

## Scope

**In scope**:
- `src/lib/analyze.ts` (create) — exports the extracted types (`YearCell`,
  `PeseAnalysis`, `AnalyzedPan`, an `Overrides` type, a `StatusOverride` type)
  and a pure function `analyzePan(pan, ctx)` (or `analyzePans(pans, ctx)`).
- `src/app/page.tsx` — replace the inline `useMemo` body with a call into
  `analyze.ts`; import the moved types from there instead of declaring them.
- `src/lib/analyze.test.ts` (create).

**Out of scope** (do NOT touch):
- The Excel exporter (`exportToExcel`, `page.tsx:328-504`) — leave it inline;
  it's a separate future plan.
- The React components (`PanCard`, `StatCard`, `HistoricoPanel`, `Num`) — they
  stay in `page.tsx`.
- `src/lib/budget-parser.ts` / `pan-parser.ts` logic — only import from them.
- Any behavior change. This is a pure refactor: output for the same input must
  be byte-identical.

## Git workflow

- Branch: `advisor/005-extract-analyze`
- Commit per step (extract → switch caller → test). Message e.g.
  `extract analysis engine to lib/analyze`.
- Do NOT push or open a PR.

## Steps

### Step 1: Create `src/lib/analyze.ts` with moved types and a context type

Move the type declarations `YearCell`, `PeseAnalysis`, `AnalyzedPan` verbatim
from `page.tsx:73-108` into `analyze.ts` and `export` them. Add:

```ts
import type { PanData } from "./pan-parser";
import type { BudgetDb, CnpjEntry, PeseDb, TiDb, TiRow } from "./budget-parser";

export type StatusOverride = "aprovado" | "negado" | "warn";

export interface Overrides {
  tp?: string;
  empresas?: Record<string, string>;
  peseCode?: string;
  tiProgramas?: Record<string, string>;
}

export interface AnalyzeContext {
  db: BudgetDb;
  cnpj: CnpjEntry[];
  peseDb: PeseDb | null;
  tiDb: TiDb | null;
  overrides: Record<string, Overrides>;
  statusOverrides: Record<string, StatusOverride>;
}
```

### Step 2: Move the analysis body into `analyzePans`

Create:

```ts
export function analyzePans(pans: PanData[], ctx: AnalyzeContext): AnalyzedPan[] {
  const { db, cnpj, peseDb, tiDb, overrides, statusOverrides } = ctx;
  return pans.map((pan) => {
    // ... the EXACT body currently at page.tsx:167-294, unchanged ...
  });
}
```

Copy the loop body from `page.tsx` lines 167–294 **verbatim** (the
`pans.map((pan) => { ... })` callback). Do not alter any logic, casts (e.g.
`{ tps: tiDb!.tps } as BudgetDb`), or status branching. Import the needed
functions (`matchTpCode`, `matchEmpresaCode`, `getTiOptions`, `matchTiPrograma`,
`matchTiDescricao`, `lookupTiByYear`, `lookupBudgetByYear`, `matchPeseCode`,
`lookupPeseByYear`) from `./budget-parser`.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Switch `page.tsx` to use it

In `page.tsx`:
- Delete the type declarations now living in `analyze.ts` (lines 73–108) and
  import them: `import { analyzePans, type AnalyzedPan, type Overrides, type StatusOverride } from "@/lib/analyze";`
  (and `YearCell`/`PeseAnalysis` if still referenced in the component code —
  grep to confirm; import whichever the components still use).
- Replace the `analyzed` useMemo body with:

```ts
const analyzed = useMemo<AnalyzedPan[]>(() => {
  if (!db || !cnpj) return [];
  return analyzePans(pans, { db, cnpj, peseDb, tiDb, overrides, statusOverrides });
}, [pans, db, cnpj, peseDb, tiDb, overrides, statusOverrides]);
```

- Update the `overrides` useState type to use the imported `Overrides`:
  `useState<Record<string, Overrides>>({})`.
- Update the `statusOverrides` useState to use `StatusOverride`.

**Verify**:
- `npx tsc --noEmit` → exit 0.
- `grep -n "interface AnalyzedPan\|interface YearCell\|interface PeseAnalysis" src/app/page.tsx`
  → no matches (they moved to analyze.ts).
- `bun run build` → succeeds.

### Step 4: Test the extracted engine

Create `src/lib/analyze.test.ts`, modeled after `src/lib/budget-parser.test.ts`
(plan 001). Build a minimal `PanData` and `AnalyzeContext` and assert:
- A normal PAN fully within budget → `status === "ok"`.
- A PAN with an unmatchable empresa → `status === "unknown"`.
- A PAN whose request exceeds available in some year → `status === "warn"`.
- A Turn Key PAN with a resolved PESE code → `pese` populated and the tax
  multiplier reflected in `totalAvailable`.

Example skeleton:

```ts
import { describe, it, expect } from "vitest";
import { analyzePans, type AnalyzeContext } from "./analyze";
import type { PanData } from "./pan-parser";
import type { BudgetDb, CnpjEntry } from "./budget-parser";

const db: BudgetDb = {
  rows: [{ ciclo: "2026", empresa: "COELBA", tp: "29", years: { "2026": 1000 }, total: 1000 }],
  empresas: ["COELBA"], tps: ["29"], years: ["2026"],
};
const cnpj: CnpjEntry[] = [];
const ctx: AnalyzeContext = { db, cnpj, peseDb: null, tiDb: null, overrides: {}, statusOverrides: {} };

const basePan = (over: Partial<PanData>): PanData => ({
  fileName: "x.pdf", rateio: [], fluxoCaixa: [], rawText: "", ...over,
});

describe("analyzePans", () => {
  it("ok when request fits budget", () => {
    const pan = basePan({
      tp: "29", percentualCapex: 100,
      rateio: [{ empresa: "COELBA", valor: 500 }],
      fluxoCaixa: [{ ano: 2026, valor: 500 }],
    });
    const [r] = analyzePans([pan], ctx);
    expect(r.status).toBe("ok");
  });
  // ... unknown, warn, turn-key cases ...
});
```

Adjust expected values to the real output if they differ (the parser-test
discipline from plan 001 applies — characterize, don't fix).

**Verify**: `npx vitest run` → all pass (parser tests from 001 + new analyze tests).

### Step 5: Full verification

**Verify**:
- `npx vitest run` → all pass.
- `npx tsc --noEmit` → exit 0.
- `npx eslint .` → exit 0.
- `bun run build` → succeeds.
- Manually: `bun dev`, load a real PAN PDF, confirm the dashboard renders the
  same statuses/numbers as before the refactor (spot-check one ok and one warn).

## Test plan

- New file `src/lib/analyze.test.ts` covering the four status outcomes (ok,
  unknown, warn, turn-key) using in-memory fixtures — modeled after
  `src/lib/budget-parser.test.ts`.
- Regression guard: the build + manual spot-check confirm UI output is unchanged.
- Verification: `npx vitest run` → all pass including ≥4 new analyze tests.

## Done criteria

ALL must hold:

- [ ] `src/lib/analyze.ts` exports `analyzePans`, `AnalyzedPan`, `Overrides`,
      `StatusOverride`, `AnalyzeContext`
- [ ] `page.tsx` no longer declares `AnalyzedPan`/`YearCell`/`PeseAnalysis` and
      its `analyzed` useMemo is ≤6 lines calling `analyzePans`
- [ ] `npx vitest run` exits 0 with new analyze tests passing
- [ ] `npx tsc --noEmit` exits 0
- [ ] `bun run build` succeeds
- [ ] Manual spot-check: one OK and one WARN PAN render identically to pre-refactor
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report (do not improvise) if:

- `page.tsx:167-294` does not match the documented analysis body (drift) — do
  not guess the logic; report.
- The extracted function needs anything from React/the component scope that
  isn't in `AnalyzeContext` (it shouldn't — the useMemo is already pure over its
  deps).
- Plan 001 is not yet merged (no Vitest harness) — STOP; this plan depends on it.
- Any status/number changes in the manual spot-check vs. pre-refactor — that
  means the extraction altered behavior; revert and report.

## Maintenance notes

- A natural follow-up (separate plan) is extracting `exportToExcel` into
  `src/lib/export-excel.ts` the same way; left out here to keep the diff small.
- Reviewer should diff the moved `pans.map` body against the original to confirm
  it's verbatim, and confirm the `useMemo` dependency array is unchanged.
- Once `analyzePans` is tested, future matcher changes can be validated end-to-end,
  not just per-helper.
