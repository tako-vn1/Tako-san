# T18C — Takosan final redesign certification baseline

Status: **IN_PROGRESS**  
Safe pause: **T18C_PAUSED_SAFE** — implementation halted by owner instruction;
resume plan, test ledger and artifact paths:
[T18C_WIP_HANDOFF.md](T18C_WIP_HANDOFF.md).  
Checkpoint: **A — reference discovery, registry, and baseline gap report**  
Base: `b8447e85f099b800a9a8ebc6c4c137adc9e45a32`  
Branch: `feat/t18c-final-redesign-certification`

This is a baseline record, not a visual-parity certification. The complete
27-screen × six-viewport baseline captured **162 screenshots**. All 162
route contracts and horizontal-overflow checks passed, but all six aggregate
tests failed the new all-severity axe gate: **15 moderate rule instances on
11 identities per viewport** (90 instances total). No finding was suppressed.
The baseline is preserved in `.hoplite/artifacts/t18c/baseline.zip` (committed).
Final dispositions below remain pending fixes and final regeneration.

## Start gate and scope

- Repository ID: `1368281478` (`omin-jp/Frigo-dev`).
- Starting main: `b8447e85f099b800a9a8ebc6c4c137adc9e45a32`.
- CI for the exact base: run `35559555318` / CI #145 — **SUCCESS**.
- Staging Deploy #52: run `35559832493` — **SUCCESS**.
- Production: **SKIPPED**; no production deployment was performed by T18C.
- Open-PR overlap observed at the start gate: PR #7 is documentation-only;
  PR #8 concerns unrelated recipe code; PR #4 concerns scan backend work. No
  open PR was identified as modifying the Takosan redesign UI surfaces.
- Protected scope: no PayOS, payment, billing, checkout, OTP, migration,
  Inventory Truth, OCR/AI, planner-algorithm, or workflow redesign is part of
  this baseline.

## Authoritative source distinction

### A. Direct reference source — unavailable

The expected direct authority is the approved
`takosan-redesign-os-v2.0.0.zip`, including its approved boards,
`screens/*.md`, and `SCREEN_REGISTRY`. Historical T17 records say that it was
previously extracted under `.hoplite/extracted/`, but that attachment and
extraction are not present in this workspace. At discovery time,
`.hoplite/artifacts/` was empty; the baseline is now running and uses
`.hoplite/artifacts/t18c/` for current evidence. No matching ZIP, board image,
PDF, design file, or alternate extraction was found in the available workspace
locations. Direct board comparisons are therefore **0/27** and every registry row has
`BLOCKED_REFERENCE_UNAVAILABLE` for reference availability.

The older `frigo_frontend_prompt_kit_v1/` is not an approved Takosan OS source.
It is a Frigo kit containing legacy Frigo masters/reference images and must not
be used to claim Takosan board parity. The separate `takosan-brand-kit.zip`
named by `docs/brand/TAKOSAN_MIGRATION.md` is also unavailable as an original
source archive; only its installed runtime assets are present.

### B. Reconstructed requirements and installed runtime evidence

These are usable for deterministic certification, but are not equivalent to
direct board inspection:

- `tests/e2e/t17-ui/screen-registry.ts` — current 27-entry reconstructed,
  reviewer-verified route/contract registry.
- `tests/e2e/t17-ui/t17-registry.e2e.ts` — registry route, state, and viewport
  certification consumer.
- `docs/ai/T17_UI_V2_AUDIT.md`, `docs/ai/T17_UI_V2_REPORT.md`,
  `docs/ai/CURRENT_STATE.md`, and `docs/ai/HANDOFF.md` — historical contract,
  evidence, and limitation records; they explicitly retain direct-board
  comparison as pending.
- `docs/brand/TAKOSAN_MIGRATION.md` — installed Takosan brand provenance and
  compatibility classification.
- `src/web/lib/takosan-brand.ts`, `src/web/styles/takosan-tokens.css`, and
  `public/takosan/` — current runtime brand/token evidence, not board images.
- `scripts/generate-takosan-icons.mjs` — deterministic derivation of selected
  runtime PNGs from the unavailable brand-kit masters.

Installed runtime inventory: `public/takosan/brand/` 8 files,
`app-icons/` 15, `mascot/` 10 SVGs, and `ui-icons/` 14 SVGs (34 SVGs and 13
PNGs total). These assets establish runtime branding provenance only; they do
not establish direct comparison to the approved redesign boards.

## Baseline findings

- Matrix: `tests/e2e/t17-ui/t18c-matrix.e2e.ts`, all **27 × 6** canonical
  screen/viewport combinations, **underway**. The six widths are 360, 390,
  430, 768, 1024, and 1440.
- Screenshots: fresh final evidence generation is **IN_PROGRESS**. Existing
  historical T17/T17B captures are not being counted as final T18C evidence.
- Automated accessibility baseline: **15 moderate axe rule instances** were
  observed across **11 identities** at 360 and 390. The observed groups are
  landmark findings on screens 01–03 and heading-order findings on screens 01,
  07, 10, 11, 12, 15, 19, 23, and 25. The primary agent is coordinating
  small fixes. This is an interim observation, not a completed accessibility
  result.
- Confirmed severity so far: **P0 = 0, P1 = 0**. The full matrix remains
  incomplete; P2/P3 classification is pending direct comparison and complete
  evidence.
- Style residual baseline: **39 allowlisted / 0 unjustified**.
- Contrast baseline: **33 pass**, including **1 informational** result.
- Typography limitation: the current Preview strips external fonts, so final
  typography evidence is not yet representative of the intended font loading
  environment. Final font evidence is planned; fallback rendering must not be
  mistaken for final board typography parity.
- State matrix: planned coverage includes loading, empty, populated,
  validation error, network error, success, disabled, offline, auth-required,
  Plus-gated, modal/sheet open, confirmation, destructive-action, and pending
  states where supported. Real provider-dependent states that cannot be safely
  produced in this environment (including live payment/provider settlement or
  real inbox/provider delivery) are **NOT APPLICABLE**, not fabricated.

## Canonical 27-screen baseline registry

Shell terms: `bottom nav` is the mobile shell, `navigation rail` is the tablet
shell, and `sidebar` is the desktop shell. `none` denotes a public or
immersive surface where the primary navigation is intentionally hidden.

Every row is intentionally incomplete at this checkpoint. All baseline status
fields are **IN_PROGRESS**, except `Reference availability`, which is
**BLOCKED_REFERENCE_UNAVAILABLE** for every row.

| ID | Canonical route | Screen name | Auth | Mobile shell | Tablet shell | Desktop shell | Reference availability | Screenshots | A11y | Visual parity | Issues | Final disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | `/landing` | landing | public | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: landmark + heading-order observations; no P0/P1 so far | IN_PROGRESS |
| 02 | `/auth` | auth | public | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: landmark observation; no P0/P1 so far | IN_PROGRESS |
| 03 | `/auth/verify` | otp | public | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: landmark observation; no P0/P1 so far | IN_PROGRESS |
| 04 | `/onboarding/household` | onboarding-household | session | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 05 | `/onboarding/preferences` | onboarding-preferences | session | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 06 | `/onboarding/goals` | onboarding-goals | session | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 07 | `/` | home | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 08 | `/scan` | scan | session | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 09 | `/scan/:id/review` | scan-review | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 10 | `/fridge` | fridge | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 11 | `/fridge/:id` | fridge-detail | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 12 | `/recipes` | recipes | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 13 | `/recipes/:slug` | recipe-detail | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 14 | `/cook/:slug` | cook | session | none | none | none | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 15 | `/shopping` | shopping | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 16 | `/planner` | planner | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 17 | `/planner/:planId/meal/:slotId` | planner-meal | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 18 | `/planner/:planId/shopping` | planner-shopping | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 19 | `/me` | profile | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 20 | `/me/preferences` | preferences | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 21 | `/me/household` | household | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 22 | `/settings/planning` | planning-settings | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 23 | `/notifications` | notifications | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 24 | `/settings/notifications` | notification-preferences | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 25 | `/settings/app` | app-settings | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | Moderate axe baseline: heading-order observation; no P0/P1 so far | IN_PROGRESS |
| 26 | `/settings/privacy` | privacy | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; matrix pending | IN_PROGRESS |
| 27 | `/plus` | plus | session | bottom nav | navigation rail | sidebar | BLOCKED_REFERENCE_UNAVAILABLE | IN_PROGRESS | IN_PROGRESS | IN_PROGRESS | No P0/P1 observed so far; provider-dependent live states are N/A | IN_PROGRESS |

### Registry accounting

- Screen identities accounted for: **27/27**.
- Missing identities: **0**.
- Direct board comparisons: **0/27**.
- Reference-blocked identities: **27/27**.
- Supplemental compatibility routes in `src/web/App.tsx` (for example
  `/inventory`, `/ingredients/:id`, `/inventory/:id`, receipt review,
  `/week/*`, cooking-complete, family, and planner compatibility paths) are
  not additional Takosan screen identities. They remain in scope for
  compatibility/regression checks and are not silently removed from the app.

## Business-truth guardrails for visual work

Visual alignment must not replace verified product truth:

- T18A OTP expiry and resend state remain server-authoritative. Missing or
  malformed expiry metadata is presented as unknown; no client lifetime is
  fabricated.
- T17B onboarding `primaryGoal` remains client-only (`today`, `week`, `both`);
  `week` routes to `/week/setup`. Stored household values above five display as
  `5+` without being silently clamped; an explicit `5+` choice uses the
  established canonical behavior.
- T18B payment presentation remains server-owned: monthly `49000 VND`, annual
  `499000 VND`, immutable issued intent values, server-generated VietQR
  instructions, and server-confirmed entitlement. Historical `79000`/`599000`
  values are not valid redesign copy.
- Existing household isolation, Inventory Truth, OCR/AI, recipes, planner
  algorithms, Week compatibility, and protected deployment policy are outside
  visual redesign scope.

## Next baseline actions

1. Complete `t18c-matrix.e2e.ts` across 27 identities and all six widths.
2. Capture fresh screenshots from the current branch, organized by identity and
   viewport; do not reuse historical T17 artifacts as final evidence.
3. Coordinate small fixes for the observed axe findings, then rerun the
   affected accessibility cases and full matrix.
4. Produce representative shell, modal, motion/reduced-motion, state-matrix,
   and typography evidence. Re-run typography evidence in an environment that
   does not strip the intended external fonts.
5. Obtain the approved Takosan Redesign OS board source before making any
   direct parity claim or changing a layout solely to match a board.

This checkpoint intentionally does not update `CURRENT_STATE.md`,
`TASK_BOARD.md`, or `HANDOFF.md`; those files are outside this baseline-doc
creation request and will be updated by the parent task at a later checkpoint.
