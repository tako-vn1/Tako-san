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
- Staging Deploy #53 / `35585265322`: SUCCESS; exact SHA verified
- Production: SKIPPED and untouched
- Checkpoints: `13ccb70` (scan), `bf764cc` (recipe tabs), `5ffcabd`
  (cooking)

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

Six additional P2 findings are resolved in the current implementation:

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

These are **CODE_ONLY: PASS_WITH_NOTE** dispositions pending the primary
agent's complete browser evidence and final roll-up. They do not claim
VoiceOver/NVDA execution.

| ID | Route | Semantic / keyboard / dynamic disposition | Note |
|---:|---|---|---|
| 01 | `/landing` | CODE_ONLY: PASS_WITH_NOTE — heading, public actions, order | Static entry; browser pending |
| 02 | `/auth` | CODE_ONLY: PASS_WITH_NOTE — labels, native form, loading/error | Auth contract protected |
| 03 | `/auth/verify` | CODE_ONLY: PASS_WITH_NOTE — OTP fields, resend order, status | TTL/resend unchanged |
| 04 | `/onboarding/household` | CODE_ONLY: PASS_WITH_NOTE — heading, native choices, submit state | Browser pending |
| 05 | `/onboarding/preferences` | CODE_ONLY: PASS_WITH_NOTE — groups, choices, save/error | Persistence unchanged |
| 06 | `/onboarding/goals` | CODE_ONLY: PASS_WITH_NOTE — goal group, native navigation, completion | Browser pending |
| 07 | `/` | CODE_ONLY: PASS_WITH_NOTE — h1, landmark, primary actions, loading | No Home redesign |
| 08 | `/scan` | CODE_ONLY: PASS_WITH_NOTE — capture, pressed mode, alert, isolated stage | Capture P2 resolved |
| 09 | `/scan/:id/review` | CODE_ONLY: PASS_WITH_NOTE — review controls, lifecycle status, focus | Normal confirm still routes fridge |
| 10 | `/fridge` | CODE_ONLY: PASS_WITH_NOTE — heading, rows, controls, pressed filters | Inventory logic unchanged |
| 11 | `/fridge/:id` | CODE_ONLY: PASS_WITH_NOTE — lot labels, edit order, expiry errors | Browser pending |
| 12 | `/recipes` | CODE_ONLY: PASS_WITH_NOTE — filters, cards, loading/empty states | Pressed-filter P2 resolved |
| 13 | `/recipes/:slug` | CODE_ONLY: PASS_WITH_NOTE — tablist, roving keys, panels, Tab exit | Checkpoint B; browser pending |
| 14 | `/cook/:slug` | CODE_ONLY: PASS_WITH_NOTE — progress, step, timer, voice, completion focus | Highest-priority dynamic surface |
| 15 | `/shopping` | CODE_ONLY: PASS_WITH_NOTE — checkbox names, form, row actions | Generic delete name is deferred P3 |
| 16 | `/planner` | CODE_ONLY: PASS_WITH_NOTE — heading, plan actions, async states | Planner unchanged |
| 17 | `/planner/:planId/meal/:slotId` | CODE_ONLY: PASS_WITH_NOTE — meal, ingredients, edit/navigation | Browser pending |
| 18 | `/planner/:planId/shopping` | CODE_ONLY: PASS_WITH_NOTE — purchase controls, async states | Business behavior unchanged |
| 19 | `/me` | CODE_ONLY: PASS_WITH_NOTE — profile heading, actions, navigation | Browser pending |
| 20 | `/me/preferences` | CODE_ONLY: PASS_WITH_NOTE — groups, native controls, save/error | No speculative status |
| 21 | `/me/household` | CODE_ONLY: PASS_WITH_NOTE — sharing labels, member actions, feedback | Isolation unchanged |
| 22 | `/settings/planning` | CODE_ONLY: PASS_WITH_NOTE — labels, native controls, save/error | Planner settings unchanged |
| 23 | `/notifications` | CODE_ONLY: PASS_WITH_NOTE — heading, list, read actions, state | Browser pending |
| 24 | `/settings/notifications` | CODE_ONLY: PASS_WITH_NOTE — heading, controls, save/error | Browser pending |
| 25 | `/settings/app` | CODE_ONLY: PASS_WITH_NOTE — settings, PWA/cache behavior | Cache-cleared status deferred P3 |
| 26 | `/settings/privacy` | CODE_ONLY: PASS_WITH_NOTE — heading, destructive actions, dialogs | Session/privacy unchanged |
| 27 | `/plus` | CODE_ONLY: PASS_WITH_NOTE — plan heading, actions, payment status | Payment authority protected |

## Automated evidence

- Focused serial browser checkpoint: **10 PASS / 4 FAIL**; genuine CTA-focus
  issue fixed. Two paused-clock axe hangs and a filter locator collision were
  harness issues and are fixed; rerun is pending.
- Earlier browser checkpoint: **5 PASS / 5 FAIL**; genuine completion heading
  h1-to-h3 issue addressed; current path/assertion supports h2/h3.
- Focused unit tests: **4 files / 60 PASS**, including three voice-boundary
  tests. Expected full total: **185 files / 4226 tests**, full run pending.
- T17/T18C browser suites, final strict axe, full lint, typecheck, migration
  smoke, build, final diff check, and exact final Git/PR values: **PENDING**.
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

