# T18D HUMAN-STYLE ACCESSIBILITY REVIEW

**Status:** `T18D_READY_FOR_REVIEW`. Implementation is frozen at `d3ef61c`;
focused, repository, and six-width browser gates are green. Publication is
review-only; no merge or deployment is authorized. This is not actual
assistive-technology certification.

## Base

- Repository ID: `1368281478`
- Repository: `vn-tako1/Frigo-dev`
- Exact expected main/base: `07ace57241f8270b2458610979c709bb69b9a65a`
- Branch: `feat/t18d-a11y-human-style-hardening`
- CI #151 / `35584884792`: SUCCESS
- Staging Deploy #53 / `35585265322`: SUCCESS; run head matches exact base
- Production: SKIPPED and untouched
- Implementation freeze: `d3ef61c`
- Checkpoints: `13ccb70` (scan), `bf764cc` (recipe tabs), `5ffcabd`
  (cooking), `7568fb2` (focused certification), `d3ef61c` (application freeze)

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

- Final focused browser run: **14 PASS / 0 FAIL** in **42.8s**, strict axe
  clean; log: `.hoplite/artifacts/t18d/final/focused.log`.
- Earlier serial browser run: **10 PASS / 4 FAIL**.
  The genuine failure was lost scan CTA focus; that was fixed. Two apparent
  axe hangs were caused by a paused test clock and were fixed by resuming the
  clock. A filter locator collision was corrected.
- An earlier **5 PASS / 5 FAIL** run found a genuine completion heading
  h1-to-h3 issue; the current assertion/path now handles the h2/h3 structure.
- Final `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm check:migrations`, and `pnpm build` logs all pass; full Vitest is
  **185 files / 4226 tests** in **333.25s**. Logs:
  `.hoplite/artifacts/t18d/final/{lint,typecheck,test,check-migrations,build}.log`.
- Final six-width browser run: **349 PASS / 5 intentional skips / 0 FAIL**,
  **354 cases**, **23.3m**, no retries/flakes. All **84 T18D cases PASS**.
- Fresh style/contrast rerun: **39 allowlisted / 0 unjustified** style
  residuals and **33/33 PASS** contrast; logs under `final/`.

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

The independent second pass rechecked two boundary questions. The pre-existing
timer store can retain `isTimerRunning` at zero, but the exposed control is now
truthfully completed/disabled, activation is guarded, focus remains, and Reset
works; no AT/keyboard defect remains and the protected timer store is unchanged.
Normal successful scan confirmation still navigates to `/fridge`; the lifecycle
announcement applies when an authoritative confirmed/refetch state remains on
the review page. No artificial delay or business-state transition was introduced.

## Automated evidence

- Focused final run: **14/14 PASS**, strict axe violations **0**, **42.8s**;
  `.hoplite/artifacts/t18d/final/focused.log`.
- Earlier serial browser checkpoint: **10 PASS / 4 FAIL**; genuine CTA-focus
  issue fixed. Two paused-clock axe hangs and a filter locator collision were
  harness issues and are fixed; full focused rerun passed without suppressions.
- Earlier browser checkpoint: **5 PASS / 5 FAIL**; genuine completion heading
  h1-to-h3 issue addressed; current path/assertion supports h2/h3.
- Focused unit tests: **4 files / 60 PASS**, including three voice-boundary tests.
- Final `pnpm lint`, `pnpm typecheck`, `pnpm test` (**185 files / 4226 PASS**,
  333.25s), `pnpm check:migrations` (`migration-smoke=ok`), and `pnpm build`:
  PASS. Logs: `.hoplite/artifacts/t18d/final/{lint,typecheck,test,check-migrations,build}.log`.
- After the test-only settling correction, `pnpm lint`, `pnpm typecheck`, and
  `git diff --check` passed again (`lint-settled.log`, `typecheck-settled.log`).
- `node scripts/t17/style-residuals.mjs`: **39 allowlisted / 0 unjustified**;
  `node scripts/t17/contrast-audit.mjs`: **33/33 PASS**.
- Direct agent-browser check: recipe ArrowRight changes focus/selection/panel;
  cooking Enter advances to step 2/5 while focus stays on Next. Screenshot
  `.hoplite/artifacts/t18d/recipe-keyboard.png` inspected; no browser errors.
- The second full matrix was stopped at approximately case 158 after
  `t17-a11y.e2e.ts` sampled scan-review entrance opacity and receipt
  enable-state before the UI settled; that failure context is retained. The
  parent patched the test to wait **350 ms after** async CTAs become enabled,
  matching the existing T18C settled-state convention. No axe rule or design
  token was altered.
- Final settled matrix: **349 PASS / 5 intentional skips / 0 FAIL**, **354
  cases** in **23.3m**, one uninterrupted runner exit 0. Log:
  `.hoplite/artifacts/t18d/final/matrix-settled.log`; machine-readable result:
  `final/matrix-settled/reports/browser.json`. Exact command:

  ```sh
  PORT=5173 T18C_ARTIFACT_DIR=.hoplite/artifacts/t18d/final/matrix-settled pnpm exec playwright test --config=playwright.t18c.config.ts t18d-human-a11y.e2e.ts t17-a11y.e2e.ts t17-reduced-motion.e2e.ts t18c-gaps.e2e.ts t18c-matrix.e2e.ts t17-ui.e2e.ts payment-authority.e2e.ts
  ```

  Widths: **360/390/430/768/1024/1440**. Breakdown: T18D **84**, T17 axe
  **12**, reduced motion **42**, T17 UI **84**, T18C gaps **67**, T18C matrix
  **6**, payment regression **54**, all PASS. The existing breakpoint sweep
  runs once in mobile-390; its other five project instances are intentionally
  skipped, not missing coverage. No retries or flaky results.
- Strict axe violations **0** across **162 canonical checks** (27 × 6), plus
  focused dynamic contracts. One-h1, image-alt, 44×44 targets, navigation
  `aria-current`, OTP announcements, and labelled dialog entry/trap/Escape/return
  contracts pass. Axe retains **45 color-contrast incomplete rule records**
  across the six manifests; these are not violations or an exhaustive contrast
  certification. Fresh token contrast checks pass 33/33; no exclusions were
  added beyond the existing external iframe boundary.
- Prior CI/staging and T18C counts are historical and are not relabeled as
  T18D evidence.

## Human assistive technology limitation

- Human-style manual semantic review: **PERFORMED**
- Keyboard interaction review/manual interaction simulation: **PERFORMED**
- Accessibility-tree/ARIA review, including focused `ariaSnapshot`
  assertions: **PERFORMED**
- VoiceOver macOS/iOS actual execution: **NOT PERFORMED**
- NVDA Windows actual execution: **NOT PERFORMED**

## Remaining risks

- Two scoped P3 observations remain deferred: shopping repeated delete buttons
  have generic names, and settings cache-cleared feedback has no dedicated
  status. No P0/P1/P2 remains open in the independent review.
- Actual VoiceOver/NVDA, microphone recognition accuracy, real provider delivery,
  and live payments are not certified. Axe incomplete contrast records remain
  available for human inspection; approved T18C composition is unchanged.
- Review-only publication and hosted CI receipt follow this local certification.
  No merge or deployment is allowed.

## Final local report

- Original A/B/C/D: **FIXED**; application freeze `d3ef61c`.
- Additional P2: **7 resolved** (capture alert; grouped filters; completion
  heading; stale callbacks; confirm CTA focus; voice failure; completed-timer
  control). P3: **2 deferred**.
- 27-screen human-style review: **14 PASS / 13 PASS_WITH_NOTE / 0 FAIL**;
  independent review open P0/P1/P2 = **0/0/0**.
- Focused/repository gates PASS; settled matrix **349 PASS / 5 intentional
  skips / 0 FAIL**. `git diff --check` PASS. Protected server, migration,
  workflow, auth/payment/domain boundaries are unchanged.
- Worktree contains the pre-existing `.hoplite/settings.json` modification;
  it is preserved and excluded from all T18D commits.
- Merge/deploy/production/migration/real payment: **NO**.

**Final status:** `T18D_READY_FOR_REVIEW`.
