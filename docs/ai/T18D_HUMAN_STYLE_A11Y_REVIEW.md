# T18D HUMAN-STYLE ACCESSIBILITY REVIEW

**Draft status:** implementation and focused browser gates are complete.
Final gates, counts, and review status remain the primary agent's work. This is
not a `T18D_READY_FOR_REVIEW` or actual assistive-technology certification.

## Base

- Repository ID: `1368281478`
- Repository: `vn-tako1/Frigo-dev`
- Exact expected main/base: `07ace57241f8270b2458610979c709bb69b9a65a`
- Branch: `feat/t18d-a11y-human-style-hardening`
- CI #151 / `35584884792`: SUCCESS
- Staging Deploy #53 / `35585265322`: SUCCESS; run head matches exact base
- Production: SKIPPED and untouched
- Checkpoints: `13ccb70` (scan), `bf764cc` (recipe tabs), `5ffcabd`
  (cooking), `7568fb2` (focused certification/application freeze)

## Methodology

The review combines semantic code inspection, deterministic keyboard/browser
automation, accessibility-tree assertions, and dynamic-state reasoning. It
does not claim VoiceOver, NVDA, or any other human assistive-technology run.

Inspected contracts include the 27 registered routes, scan processing/review,
recipe tabs, cooking mode, capture errors, inventory filters, recipe filters,
focus return, modal behavior, and protected business callers. The focused
Playwright assertions now include `ariaSnapshot` attachments for the relevant
roles, names, live regions, tab/panel relationships, progress values, and
focus states. Timer/countdown assertions distinguish event announcements from
per-second visual updates.

### Evidence currently available

- Final focused desktop browser rerun: **14 PASS / 0 FAIL** (39.9s), strict
  axe clean and accessibility-tree attachments retained in
  `.hoplite/artifacts/t18d/focused-green`. Six-width regression run pending.
- Earlier serial browser run: **10 PASS / 4 FAIL**.
  The genuine failure was lost scan CTA focus; that was fixed. Two apparent
  axe hangs were caused by a paused test clock and were fixed by resuming the
  clock. A filter locator collision was corrected.
- An earlier **5 PASS / 5 FAIL** run found a genuine completion heading
  h1-to-h3 issue; the current assertion/path now handles the h2/h3 structure.
- Focused unit run: **4 files / 60 PASS**, including three new voice-boundary
  tests. Full Vitest is pending; expected count is 185 files / 4226 tests.
- Full lint/typecheck PASS. Serial full Vitest/migration/build and complete
  browser gates are running/pending. No counts are inferred from T18C history.

## Findings at start

### A — Scan processing live-region timer noise (P1) — FIXED

`ScanProcessingState` now exposes a dedicated polite stage status while the
visible elapsed timer remains outside it. Stage transitions announce once;
one-second elapsed updates do not create live-region noise or nested duplicate
status sources.

### B — Scan review lifecycle announcement gap (P2) — FIXED

`ScanResultPage` has one controlled announcement for pending-to-ready,
pending-to-failed, and ready-to-confirmed transitions. Poll retry feedback is
separate, focus is not moved into the list, and the normal successful confirm
still navigates to the fridge. The conflict/refetch case is an authority case,
not an invented normal success flow.

### C — Recipe-detail tab semantics (P2) — FIXED

The named tablist has stable tab/panel IDs, roving tabindex, `aria-controls`,
`aria-labelledby`, automatic arrow activation, ArrowLeft/ArrowRight wrapping,
Home, End, and hidden non-selected panels. T17 focus styling and `onFocus`
automatic activation preserve keyboard semantics without changing mouse/touch
behavior.

### D — Cooking dynamic interaction (P1) — FIXED

Cooking mode has isolated step, timer-event, listening, and heard-text status
sources; step-valued progress semantics; focus-preserving next/previous;
completion replacement focus; and ingredient-specific deduction names. Timer
countdown remains visual-only while start/pause/resume/reset/completion events
are announced. Repeated timer resets now use an event-only announcement
sequence.

## Additional scoped findings

Seven additional P2 findings are resolved in the current implementation:

1. Scan capture errors now use `role="alert"` (`ScanPage`).
2. Visual-only selected filters now expose `aria-pressed` (grouped
   `InventoryPage` and `RecipesPage` finding).
3. Completion replacement now enters the completion heading with the intended
   h2/h3-compatible semantic contract.
4. Scan processing cancels stage-only scheduled callbacks in `finally`, so an
   early failure cannot re-enable processing after it has ended.
5. Narrow scan-review lost-body confirmation restores the CTA focus without a
   new focus override or list jump.
6. Voice-recognition capability failure is no longer silent: the
   `voice-chef` non-`no-speech` `onError` callback stops automatic restart and
   reports capability state; voice commands and business actions are unchanged.
7. A completed timer no longer exposes an active pause action: `aria-disabled`
   retains focus, a page-level terminal-state guard prevents misleading pause
   feedback, and Reset remains available. Duration/store/tick logic is unchanged.

Two P3 observations remain deliberately deferred: shopping repeated delete
buttons have generic names, and settings cache-cleared feedback has no
dedicated status. No speculative scope was added for either observation.

## Fixes

| File | Semantic change and reason |
|---|---|
| `src/web/components/scan/ScanProcessingState.tsx` | Isolated stage status from elapsed timer to prevent per-second announcements. |
| `src/web/pages/ScanResultPage.tsx` | Added transition-only lifecycle status, separate poll feedback, and narrow CTA focus restoration without overriding normal focus. |
| `src/web/pages/RecipeDetailPage.tsx` | Added complete named tab pattern, roving keyboard interaction, hidden panels, T17 focus style, and focus activation. |
| `src/web/pages/CookingModePage.tsx` | Added step/progress, event-only timer, listening/heard status, completion focus, and contextual deduction names. |
| `src/web/pages/ScanPage.tsx` | Added capture alert and cancellation of stale stage callbacks; scan/OCR/AI behavior is unchanged. |
| `src/web/pages/InventoryPage.tsx` / `RecipesPage.tsx` | Added `aria-pressed` to existing filters; filter values and behavior are unchanged. |
| `src/web/lib/voice-chef.ts` | Stopped automatic restart for non-`no-speech` capability errors and surfaced the state; command handling is unchanged. |
| `tests/e2e/t17-ui/t18d-human-a11y.e2e.ts` and focused unit tests | Added deterministic ARIA, keyboard, dynamic, timer, voice-boundary, and axe contracts. |

### Protected boundaries

No auth backend, OTP, payment/PayOS/billing/checkout/webhook, inventory
reconciliation, household isolation, OCR/AI provider, recipe data, timer
duration source, voice command action, deduction math, planner, Week behavior,
server file, migration, workflow, or production configuration changed. There
were no remote migrations, merge, deploy, real payment, or business-state
changes.

## 27-screen review

Every row received source-level reasoning over first meaningful heading,
landmarks, names, truthful roles/states, errors/success, updates, focus order,
native activation, modal entry/trap/Escape/return where present, decorative
content, loading, and unavailable states. Keyboard dispositions combine native
control/shared-focus inspection with executed targeted browser interactions;
they do not claim an exhaustive manual keystroke traversal of every state.
Six-width settled-screen automation is recorded separately below.

| ID | Route | Semantic | Keyboard | Dynamic | Notes |
|---:|---|---|---|---|---|
| 01 | `/landing` | PASS | PASS | PASS | Main/h1, native CTAs, guest failure alert |
| 02 | `/auth` | PASS | PASS | PASS_WITH_NOTE | Labels, pressed mode, errors/status; external GSI not exercised |
| 03 | `/auth/verify` | PASS | PASS | PASS | Named six-digit group, delivery/error/status; OTP authority untouched |
| 04 | `/onboarding/household` | PASS | PASS | PASS | Heading, progressbar, native household choices |
| 05 | `/onboarding/preferences` | PASS | PASS | PASS | Grouped native inputs and selected state |
| 06 | `/onboarding/goals` | PASS | PASS | PASS | Named goals, progress, completion/error feedback |
| 07 | `/` | PASS | PASS | PASS_WITH_NOTE | H1, progress, pressed filters; async variants inspected, not exhaustive |
| 08 | `/scan` | PASS | PASS | PASS | Stage-only status, capture alert; synthetic upload, no real OCR |
| 09 | `/scan/:id/review` | PASS | PASS | PASS | Lifecycle, retry separation, controls, narrow lost-focus restoration |
| 10 | `/fridge` | PASS | PASS | PASS | H1, row controls, alerts, pressed category filters |
| 11 | `/fridge/:id` | PASS | PASS | PASS_WITH_NOTE | Named lot controls and status; all domain error variants not replayed |
| 12 | `/recipes` | PASS | PASS | PASS | Named cards/search, pressed filters, loading/empty semantics |
| 13 | `/recipes/:slug` | PASS | PASS | PASS | Automatic tabs, real associations, roving focus, normal Tab exit |
| 14 | `/cook/:slug` | PASS | PASS | PASS_WITH_NOTE | Steps/timer/progress/voice/completion; microphone and speech accuracy untested |
| 15 | `/shopping` | PASS | PASS | PASS_WITH_NOTE | Checkbox name/state and Space work; generic delete naming deferred P3 |
| 16 | `/planner` | PASS | PASS | PASS_WITH_NOTE | H1, native language/actions, loading/error; no algorithm certification |
| 17 | `/planner/:planId/meal/:slotId` | PASS | PASS | PASS_WITH_NOTE | Heading context, ingredients, links, labelled modal; not all async variants |
| 18 | `/planner/:planId/shopping` | PASS | PASS | PASS_WITH_NOTE | Named purchase controls, alert/status; business algorithms out of scope |
| 19 | `/me` | PASS | PASS | PASS_WITH_NOTE | H1, real account links, labelled logout dialog; real account changes untested |
| 20 | `/me/preferences` | PASS | PASS | PASS | Fieldsets, pressed choices, save/error/status |
| 21 | `/me/household` | PASS | PASS | PASS_WITH_NOTE | Truthful unavailable sharing state; no fabricated member actions |
| 22 | `/settings/planning` | PASS | PASS | PASS | Named choices, checkbox/pressed state, save feedback |
| 23 | `/notifications` | PASS | PASS | PASS_WITH_NOTE | Heading/sections, honest empty/error states; live delivery not exercised |
| 24 | `/settings/notifications` | PASS | PASS | PASS | Named switches, checked state and descriptions |
| 25 | `/settings/app` | PASS | PASS | PASS_WITH_NOTE | Native settings/install dialog; cache-cleared feedback deferred P3 |
| 26 | `/settings/privacy` | PASS | PASS | NOT_APPLICABLE | Informational h1/sections; decorative icons hidden; no destructive dialog |
| 27 | `/plus` | PASS | PASS | PASS_WITH_NOTE | Pressed plans, alerts/status, labelled modal; synthetic payment boundary only |

Overall human-style disposition: **14 PASS / 13 PASS_WITH_NOTE / 0 FAIL**.
Independent final source review: **P0/P1/P2 open = 0/0/0**; seven added P2s
resolved, two P3 observations explicitly deferred.

## Automated evidence

- Focused serial desktop rerun: **14/14 PASS**, strict axe clean, 39.9s.
  `PORT=5173 T18C_ARTIFACT_DIR=.hoplite/artifacts/t18d/focused-green pnpm exec
  playwright test --config=playwright.t18c.config.ts t18d-human-a11y.e2e.ts
  --project=desktop-1440`.
- Earlier serial browser checkpoint: **10 PASS / 4 FAIL**; genuine CTA-focus
  issue fixed. Two paused-clock axe hangs and a filter locator collision were
  harness issues and are fixed; full focused rerun passed without suppressions.
- Earlier browser checkpoint: **5 PASS / 5 FAIL**; genuine completion heading
  h1-to-h3 issue addressed; current path/assertion supports h2/h3.
- Focused unit tests: **4 files / 60 PASS**, including three voice-boundary tests.
- Serial `pnpm lint`, `pnpm typecheck`, `pnpm test` (**185 files / 4226 PASS**,
  331.37s), `pnpm check:migrations` (`migration-smoke=ok`), `pnpm build`: PASS.
  Full gate logs: `.hoplite/artifacts/t18d/full-*.log`, 2026-09-22 00:07–00:14 UTC.
- `node scripts/t17/style-residuals.mjs`: **39 allowlisted / 0 unjustified**;
  `node scripts/t17/contrast-audit.mjs`: **33/33 PASS**.
- Direct agent-browser check: recipe ArrowRight changes focus/selection/panel;
  cooking Enter advances to step 2/5 while focus stays on Next. Screenshot
  `.hoplite/artifacts/t18d/recipe-keyboard.png` inspected; no browser errors.
- A first six-width matrix was deliberately stopped at case 96 before the
  terminal timer-control correction; it is not counted as final certification.
  Final focused rerun first returned 13/14: axe sampled the existing 250 ms
  entrance fade (4.48:1 interpolated text, not settled #8F5307). The focused
  helper now matches T18C's 350 ms settled-color audit; no rule/token changed.
- Six-width T17/T18C/T18D/payment matrix and final Git/PR values: **PENDING**.
- Prior CI/staging and T18C counts are historical and are not relabeled as
  T18D evidence.

## Human assistive technology limitation

- Human-style manual semantic review: **PERFORMED**
- Keyboard/manual interaction simulation: **PERFORMED**
- Accessibility-tree/ARIA review, including `ariaSnapshot` attachments:
  **PERFORMED in the focused automation work**
- VoiceOver macOS/iOS actual execution: **NOT PERFORMED**
- NVDA Windows actual execution: **NOT PERFORMED**

## Remaining risks

- Complete the focused rerun and inspect every attached accessibility tree;
  current 10/4 is not a final result.
- Rerun the relevant T17/T18C suites and full repository gates, then record
  exact final counts and failures.
- Complete the independent second pass and establish final scoped P0/P1/P2
  counts. Current code review has six resolved additional P2s and two deferred
  P3 observations.
- Commit/push the final documentation checkpoint and open, but do not merge,
  the review PR. Do not deploy.

## Draft final report

- Original A/B/C/D: **FIXED in `13ccb70`, `bf764cc`, `5ffcabd`; final browser
  certification pending**.
- New P2: **6 resolved** (capture alert; grouped filters; completion heading;
  stale callbacks; confirm CTA focus; voice failure). P3: **2 deferred**.
- 27-screen matrix: **27/27 code-only PASS_WITH_NOTE**; final browser roll-up
  pending.
- Final SHA, remote SHA, ahead/behind, PR number/state/head/base, axe count,
  full Vitest count, lint, typecheck, migration smoke, build, and final
  worktree status: **PENDING primary**.
- Merge/deploy/production/migration/real payment: **NO**.

**Final status:** `PENDING PRIMARY CERTIFICATION` (not `T18D_COMPLETE`).
