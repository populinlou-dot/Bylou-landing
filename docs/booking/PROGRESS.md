# Booking Core — Progress Log

Source brief: `INITIAL_PROMPT_BYLOU_BOOKING.md` (repo root, untracked).
Branch: `feature/booking-core` (based on `origin/main` @ `b2d2535`).

## Current phase

**Phase 0 — Discovery** (in progress, started 2026-10-13)

| Workstream | Owner (logical agent) | Deliverable | Status |
|---|---|---|---|
| Repository audit | repository-auditor | `REPOSITORY_AUDIT.md` | done |
| LuWeVa public analysis | competitive-researcher | `REFERENCE_ANALYSIS.md` | done (most LuWeVa internals "Not verified": behavior gated behind demo lead form) |
| UX / visual system | product-designer | `UX_DESIGN.md` | running |

## Done

- 2026-10-13: Read brief. Created `feature/booking-core` from `origin/main` (local `main` was 4 commits behind; rebased branch onto remote head before any work).

## Pre-existing local changes (NOT part of booking work)

Carried over from a previous local setup session; intentionally left uncommitted and excluded from booking commits:

- `.gitignore` → adds `.atl/`
- `pnpm-lock.yaml` → pnpm 11 local re-resolution
- `pnpm-workspace.yaml` (untracked) → `allowBuilds: sharp: true`

**Never commit `pnpm-workspace.yaml`**: CI pins pnpm 9 + Node 20 (`.github/workflows/main.yml:27,32`); pnpm 9 aborts on that file (`packages field missing or empty`), which would break the production deploy. Any dependency change on this branch must produce a lockfile compatible with CI pnpm 9.

## Baseline (verified by audit, 2026-10-13)

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm build` (CI-equivalent `NEXT_PUBLIC_BASE_PATH=""`) | PASS |
| `pnpm lint` | FAIL (pre-existing: eslint not installed, no config) |
| Tests | none exist |

## Blockers / decisions needing human input

_None yet._

## Next step

Consolidate Phase 0 findings → stack/architecture recommendation → Phase 1 docs.

## How to resume

```
Read docs/booking/PROGRESS.md and INITIAL_PROMPT_BYLOU_BOOKING.md, then continue from "Next step" on branch feature/booking-core.
```
