# Plan 001: Add a test runner and cover the pure matching/budget logic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 10cb7c1..HEAD -- src/lib/budget-parser.ts src/lib/pan-parser.ts package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `10cb7c1`, 2026-06-12

## Why this matters

The entire value of this app is in pure functions that match a PAN's free-text
company/program names against budget spreadsheets and compute available budget:
`matchEmpresaCode`, `matchTpCode`, `matchPeseCode`, `lookupBudgetByYear`,
`lookupPeseByYear`, and the `parseBR` number parser. There are **zero tests**
and **no test runner installed**. A one-character change to a regex or a
normalization step can silently mis-match a company and produce a wrong
"within budget" verdict — the worst kind of bug for a budget-checking tool,
because the output still looks plausible. This plan installs Vitest and locks
the current behavior of these functions with tests, creating the safety net
that later refactors (plan 005) depend on.

## Current state

- `src/lib/budget-parser.ts` — pure matching + lookup logic. Key exported
  functions and their current behavior:
  - `normalize` (line 41): lowercase → strip accents (NFD) → remove `.,` →
    collapse spaces → trim.
  - `matchEmpresaCode(panName, cnpj, db?)` (line 126): 5 ordered strategies
    (direct DB hit, exact CNPJ, suffix-stripped, longest substring, weighted
    token overlap with `score >= 5`). Returns a code string or `null`.
  - `matchTpCode(panTp, db)` (line 190): 5 strategies (exact, split on
    `-–—:`, first token, accent-insensitive name match, digit-only prefix).
  - `lookupBudgetByYear(db, empresa, tp)` (line 258): sums matching rows'
    per-year values into a `Record<year, number>`.
  - `matchPeseCode(panPeseCode, db)` (line 370): exact then partial (contains).
  - `lookupPeseByYear(db, peseCode)` (line 356): looks up a row and multiplies
    every year value by `PESE_TAX_MULTIPLIER = 1.219512` (line 354).
  - `BudgetDb` shape (line 11): `{ rows, empresas[], tps[], years[] }`;
    `BudgetRow` (line 3): `{ ciclo, empresa, tp, years: Record<string,number>, total }`.
  - `PeseDb`/`PeseRow` shapes at lines 25–39.
- `src/lib/pan-parser.ts` — `parseBR` (line 22) converts Brazilian currency
  strings (`"R$ 1.500.000,50"`) to a number; returns `0` on `NaN`. The rest of
  the file (`parsePanPdf`) depends on `pdfjs-dist` + a real `File` and is **out
  of scope** for this plan (browser-only, hard to unit test).

Repo conventions: TypeScript, ESM (`"type": "module"` in `package.json`),
path alias `@/*` → `./src/*` (see `tsconfig.json`). Strict mode is on. No
existing test to copy — this plan establishes the pattern.

## Commands you will need

| Purpose   | Command                       | Expected on success |
|-----------|-------------------------------|---------------------|
| Install   | `bun install`                 | exit 0              |
| Typecheck | `npx tsc --noEmit`            | exit 0, no output   |
| Tests     | `npx vitest run`              | all pass            |
| Lint      | `npx eslint .`                | exit 0              |

Note: this repo uses **bun** as the package manager (`bun.lock`, `bunfig.toml`
present). Use `bun add -D` to add dev dependencies. If `bun` is not available
in your environment, fall back to `npm install --save-dev` and `npx`.

## Scope

**In scope** (the only files you should modify/create):
- `package.json` — add `vitest` devDependency and a `test` script.
- `src/lib/budget-parser.test.ts` (create).
- `src/lib/pan-parser.test.ts` (create — only for `parseBR`).
- `vitest.config.ts` (create, only if needed for the `@/*` alias; the tests in
  this plan import by relative path, so it is likely NOT needed).

**Out of scope** (do NOT touch):
- Any logic inside `src/lib/*.ts` — this plan only *characterizes* current
  behavior. If a test reveals what looks like a bug, do NOT fix it here; record
  it in your report and assert the *actual current* behavior so the test passes.
- `parsePanPdf` and anything requiring `pdfjs-dist` or a real PDF.
- `src/app/page.tsx`, components, styles.

## Git workflow

- Branch: `advisor/001-parser-tests`
- Commit message style matches repo (short, lowercase — e.g. `git log` shows
  `feat 4`, `bug fix`). Use e.g. `add vitest + parser tests`.
- Do NOT push or open a PR.

## Steps

### Step 1: Install Vitest and add the test script

Run `bun add -D vitest` (or `npm install --save-dev vitest`). Then add to the
`"scripts"` block in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Verify**: `npx vitest --version` → prints a version number; `cat package.json`
shows the `test` script.

### Step 2: Characterize `parseBR`

Create `src/lib/pan-parser.test.ts`. `parseBR` is not exported — export it.
Add `export` to its declaration in `src/lib/pan-parser.ts` (this is the ONE
allowed source edit: changing `const parseBR =` to `export const parseBR =` at
line 22). Then:

```ts
import { describe, it, expect } from "vitest";
import { parseBR } from "./pan-parser";

describe("parseBR", () => {
  it("parses BRL with thousands separators", () => {
    expect(parseBR("1.500.000")).toBe(1500000);
  });
  it("parses decimals with comma", () => {
    expect(parseBR("1.234,56")).toBe(1234.56);
  });
  it("strips R$ and spaces", () => {
    expect(parseBR("R$ 2.000,00")).toBe(2000);
  });
  it("returns 0 for non-numeric", () => {
    expect(parseBR("abc")).toBe(0);
  });
});
```

**Verify**: `npx vitest run src/lib/pan-parser.test.ts` → 4 tests pass. If any
assertion fails, the function behaves differently than documented — change the
*expected value* to match actual output and note it in your report; do NOT
change the function.

### Step 3: Characterize the budget matchers and lookups

Create `src/lib/budget-parser.test.ts`. Build small in-memory `BudgetDb` /
`PeseDb` fixtures (no Excel files needed) and assert current behavior:

```ts
import { describe, it, expect } from "vitest";
import {
  matchEmpresaCode, matchTpCode, matchPeseCode,
  lookupBudgetByYear, lookupPeseByYear,
  type BudgetDb, type CnpjEntry, type PeseDb,
} from "./budget-parser";

const cnpj: CnpjEntry[] = [
  { code: "COELBA", name: "Companhia de Eletricidade do Estado da Bahia", normalized: "companhia de eletricidade do estado da bahia" },
  { code: "CPFL",   name: "CPFL Energia S/A", normalized: "cpfl energia s/a" },
];
const db: BudgetDb = {
  rows: [
    { ciclo: "2026", empresa: "COELBA", tp: "29", years: { "2026": 1000, "2027": 500 }, total: 1500 },
    { ciclo: "2026", empresa: "COELBA", tp: "0R", years: { "2026": 200 }, total: 200 },
  ],
  empresas: ["COELBA"], tps: ["29", "0R"], years: ["2026", "2027"],
};

describe("matchEmpresaCode", () => {
  it("direct DB empresa hit", () => {
    expect(matchEmpresaCode("COELBA", cnpj, db)).toBe("COELBA");
  });
  it("returns null when nothing matches", () => {
    expect(matchEmpresaCode("Zzz Unknown Co", cnpj, db)).toBeNull();
  });
});

describe("matchTpCode", () => {
  it("matches '29C - Reforma' to digit-prefix code 29", () => {
    expect(matchTpCode("29C - Reforma de Rede", db)).toBe("29");
  });
  it("matches exact code", () => {
    expect(matchTpCode("0R", db)).toBe("0R");
  });
});

describe("lookupBudgetByYear", () => {
  it("sums per-year for empresa+tp", () => {
    expect(lookupBudgetByYear(db, "COELBA", "29")).toEqual({ "2026": 1000, "2027": 500 });
  });
});

describe("lookupPeseByYear", () => {
  it("applies the 1.219512 tax multiplier", () => {
    const peseDb: PeseDb = {
      rows: [{ empresa: "COELBA", tp: "TK", peseCode: "PMT_X", years: { "2026": 100 }, total: 100 }],
      empresas: ["COELBA"], tps: ["TK"], peseCodes: ["PMT_X"], years: ["2026"],
    };
    expect(lookupPeseByYear(peseDb, "PMT_X")["2026"]).toBeCloseTo(121.9512, 4);
  });
});

describe("matchPeseCode", () => {
  const peseDb: PeseDb = {
    rows: [], empresas: [], tps: [], peseCodes: ["PMT_SE0931_EQU"], years: [],
  };
  it("exact match case-insensitive", () => {
    expect(matchPeseCode("pmt_se0931_equ", peseDb)).toBe("PMT_SE0931_EQU");
  });
  it("partial contains match", () => {
    expect(matchPeseCode("PMT_SE0931", peseDb)).toBe("PMT_SE0931_EQU");
  });
});
```

**Verify**: `npx vitest run` → all tests pass (≈12 total). Any failure means
real behavior differs from the assertion — adjust the *expected* value to the
real output, note it in your report, do NOT edit the source.

### Step 4: Confirm the whole suite and types are clean

**Verify**:
- `npx vitest run` → all pass.
- `npx tsc --noEmit` → exit 0.
- `npx eslint .` → exit 0 (the new `export` and test files lint clean).

## Test plan

- New files: `src/lib/pan-parser.test.ts` (parseBR), `src/lib/budget-parser.test.ts`
  (matchers + lookups), covering: happy path per function, one null/no-match
  case per matcher, the PESE tax multiplier, and the `29C → 29` digit-prefix
  fallback (the trickiest matcher path).
- No existing test to model after — these files become the pattern for plan 005.
- Verification: `npx vitest run` → all pass.

## Done criteria

ALL must hold:

- [ ] `npx vitest run` exits 0 with ≥10 passing tests across both files
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx eslint .` exits 0
- [ ] `package.json` has a `test` script and `vitest` under devDependencies
- [ ] The only source change outside test files is adding `export` to `parseBR`
      in `src/lib/pan-parser.ts` (`git diff src/lib/pan-parser.ts` shows only that)
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report (do not improvise) if:

- The functions in "Current state" don't match the live code (drift).
- More than one source line needs changing to make a function importable.
- A matcher's real output is so different from the assertions here that you
  can't tell what the intended behavior is — report the discrepancy instead of
  guessing.
- `bun` and `npm` both fail to install Vitest.

## Maintenance notes

- These are *characterization* tests: they assert what the code does today, not
  necessarily what it should. When a matcher is intentionally changed later,
  update the expected values deliberately and in the same commit.
- Plan 005 (extracting the analysis engine) depends on this suite existing.
- A reviewer should check that no assertion silently encodes a real bug as
  "correct" without a note flagging it.
