# Plan 003: Delete dead code (rejected pivot dashboard + unused YearDetailCard)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 10cb7c1..HEAD -- src/components/BudgetDashboard.tsx src/app/page.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `10cb7c1`, 2026-06-12

## Why this matters

Two pieces of code are defined but never used:

1. `src/components/BudgetDashboard.tsx` (236 lines) — a pivot/matrix dashboard
   (empresa × TP). It is imported by **no file** (`grep` for `BudgetDashboard`
   matches only its own definition). It also implements the *exact* approach the
   product owner explicitly rejected (a pivot/matrix of empresa × TP). Keeping
   it invites someone to wire it back in.
2. `YearDetailCard` in `src/app/page.tsx:1064` — a 34-line component that is
   defined but **never rendered** anywhere in `page.tsx` (`grep` for
   `YearDetailCard` matches only its definition).

Dead code costs review time, confuses readers about what's live, and (for the
dashboard) preserves a rejected design. Removing it is pure subtraction.

## Current state

- `src/components/BudgetDashboard.tsx` — starts with `"use client";`, exports
  `function BudgetDashboard(...)`. Confirmed unreferenced:
  `grep -rn "BudgetDashboard" src` returns only matches inside this file.
- `src/app/page.tsx:1064` — `function YearDetailCard({ year, empresaPan, empresaCode, empresaValor, tp }: {...})`,
  spanning to its closing brace at line 1098 (end of file). Confirmed
  unreferenced: `grep -rn "YearDetailCard" src` returns only the definition line.
  Note this is the LAST function in the file.

## Commands you will need

| Purpose   | Command                       | Expected on success |
|-----------|-------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`            | exit 0, no output   |
| Lint      | `npx eslint .`                | exit 0              |
| Build     | `bun run build`               | build succeeds      |
| Grep      | `grep -rn "<name>" src`       | (see steps)         |

## Scope

**In scope**:
- `src/components/BudgetDashboard.tsx` — delete the whole file.
- `src/app/page.tsx` — remove only the `YearDetailCard` function (lines
  ~1064–1098) and any now-unused imports it alone used.

**Out of scope** (do NOT touch):
- Any other component in `src/app/page.tsx` (`StatCard`, `PanCard`,
  `HistoricoPanel`, `Num`, `Page`) — all are live.
- Anything in `src/components/ui/`.

## Git workflow

- Branch: `advisor/003-remove-dead-code`
- Commit: e.g. `remove dead dashboard + unused YearDetailCard`.
- Do NOT push or open a PR.

## Steps

### Step 1: Re-confirm both are unreferenced

Run:
- `grep -rn "BudgetDashboard" src` → expect matches ONLY in
  `src/components/BudgetDashboard.tsx`.
- `grep -rn "YearDetailCard" src` → expect ONLY the definition line in
  `src/app/page.tsx`.

If either returns a usage elsewhere, that code is live — STOP.

### Step 2: Delete the dashboard file

Delete `src/components/BudgetDashboard.tsx` entirely.

**Verify**: `grep -rn "BudgetDashboard" src` → no matches; `npx tsc --noEmit` → exit 0.

### Step 3: Remove `YearDetailCard` from page.tsx

Delete the `YearDetailCard` function (from `function YearDetailCard(` at line
~1064 to the final closing brace at the end of the file). It is the last
declaration in the file, so deletion is clean.

Then check whether any import at the top of `page.tsx` was used *only* by
`YearDetailCard`. Inspect the deleted body: it used `useState`, `fmtBRL`,
`AnimatePresence`, `motion`, and `YearCell` (the type). All of these are also
used elsewhere in `page.tsx` (e.g. `HistoricoPanel` uses `useState`; `PanCard`
uses `motion`/`AnimatePresence`/`fmtBRL`; `YearCell` is used in `AnalyzedPan`).
So **no imports should need removing** — but confirm with the lint/typecheck
below, which will flag any now-unused import.

**Verify**:
- `grep -rn "YearDetailCard" src` → no matches.
- `npx tsc --noEmit` → exit 0.
- `npx eslint .` → exit 0 (no unused-import warnings). Note: the repo's eslint
  config sets `@typescript-eslint/no-unused-vars` to `off`, so unused imports
  won't fail lint — double-check manually that you removed nothing still in use
  and added no new unused symbols.

### Step 4: Full verification

**Verify**:
- `npx tsc --noEmit` → exit 0.
- `bun run build` → succeeds.

## Test plan

- No new tests (pure deletion). If plan 001 is merged, `npx vitest run` must
  still pass unchanged.
- The build succeeding is the regression check: it proves no live code
  referenced the deleted symbols.

## Done criteria

ALL must hold:

- [ ] `src/components/BudgetDashboard.tsx` no longer exists
- [ ] `grep -rn "BudgetDashboard" src` → no matches
- [ ] `grep -rn "YearDetailCard" src` → no matches
- [ ] `npx tsc --noEmit` exits 0
- [ ] `bun run build` succeeds
- [ ] `git diff --stat` shows only `BudgetDashboard.tsx` (deleted) and
      `page.tsx` (reduced by ~34 lines)
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report (do not improvise) if:

- Either grep in Step 1 shows a real usage outside the definitions (the code is
  actually live — the drift check or audit was wrong).
- Removing `YearDetailCard` causes a `tsc` error elsewhere (something imported
  it that grep missed, e.g. via a re-export).

## Maintenance notes

- The pivot/matrix dashboard design was deliberately rejected by the product
  owner; if a future request asks for "a dashboard", confirm scope before
  resurrecting this from git history.
- A reviewer only needs to confirm the build passes and no live component was
  touched.
