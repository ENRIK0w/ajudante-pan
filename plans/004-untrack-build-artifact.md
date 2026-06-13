# Plan 004: Stop tracking `tsconfig.tsbuildinfo` in git

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 10cb7c1..HEAD -- .gitignore`
> If `.gitignore` changed since this plan was written, re-read it before
> proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `10cb7c1`, 2026-06-12

## Why this matters

`tsconfig.tsbuildinfo` is a TypeScript incremental-build cache. It is tracked in
git (`git ls-files` lists it) and is ~232 KB; it is rewritten on every typecheck
or build, so it produces large, meaningless diffs and merge conflicts on a file
that should never be committed. The `.gitignore` already ignores `.next`,
`node_modules`, etc. — this artifact was simply missed.

## Current state

- `git ls-files | grep tsbuildinfo` → returns `tsconfig.tsbuildinfo` (tracked).
- `.gitignore` ignores `node_modules`, `dist`, `.output`, `.next`, `*.local`,
  etc., but does NOT mention `*.tsbuildinfo`.
- `tsconfig.json` has `"incremental": true`, which is what generates the file.

## Commands you will need

| Purpose      | Command                                   | Expected            |
|--------------|-------------------------------------------|---------------------|
| Confirm track| `git ls-files \| grep tsbuildinfo`        | one line before, none after |
| Untrack      | `git rm --cached tsconfig.tsbuildinfo`    | `rm 'tsconfig.tsbuildinfo'` |
| Status       | `git status --short`                      | shows the change    |

## Scope

**In scope**:
- `.gitignore` — add an ignore rule.
- Git index — untrack the file (the file stays on disk).

**Out of scope** (do NOT touch):
- `tsconfig.json` — leave `incremental: true`; the cache is useful locally.
- Any other tracked file.

## Git workflow

- Branch: `advisor/004-untrack-buildinfo`
- Commit: e.g. `untrack tsconfig.tsbuildinfo`.
- Do NOT push or open a PR.

## Steps

### Step 1: Add the ignore rule

Append to `.gitignore` (e.g. under a new `# TypeScript` comment near the build
entries):

```
# TypeScript incremental build cache
*.tsbuildinfo
```

### Step 2: Untrack the file (keep it on disk)

Run: `git rm --cached tsconfig.tsbuildinfo`

This removes it from the index but leaves the local file (so incremental builds
keep working).

**Verify**:
- `git ls-files | grep tsbuildinfo` → no output.
- `test -f tsconfig.tsbuildinfo && echo "still on disk"` → prints `still on disk`.
- `git status --short` → shows `D  tsconfig.tsbuildinfo` (staged deletion) and
  modified `.gitignore`.

## Test plan

- No code tests. Verification is the git state above.
- Optional: run `bun run build`, then `git status` → `tsconfig.tsbuildinfo`
  should NOT reappear as an untracked/modified file (proves the ignore works).

## Done criteria

ALL must hold:

- [ ] `git ls-files | grep tsbuildinfo` returns nothing
- [ ] `.gitignore` contains `*.tsbuildinfo`
- [ ] `tsconfig.tsbuildinfo` still exists on disk
- [ ] After `bun run build`, `git status` does not show `tsconfig.tsbuildinfo`
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report if:

- `git rm --cached` reports the file is not tracked (someone already fixed this —
  just ensure `.gitignore` has the rule and mark the plan DONE/REJECTED).

## Maintenance notes

- This only affects future commits; the file remains in git history. That's fine
  — no need to rewrite history for a build cache.
- A reviewer just confirms the file is gone from `git ls-files` and the app still
  builds.
