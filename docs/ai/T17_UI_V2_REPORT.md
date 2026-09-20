# T17B — contract reconciliation report — 2026-09-20

T17B was rebuilt from exact `main`
`858759f771baccb85f5ed6fd8e06df2fc0bbb112` on
`feat/t17b-contract-reconciliation`. Repository identity is id `1368281478`,
`omin-vn/Frigo-dev`. Application HEAD is
`0f358f2f8c9da35c2167489ad6fd63eae8ea8c47`; certification checkpoint is
`00594eba755c6895f9edb9d3076282cf42919c44`. This section is the current
authority; the original T17 report below is historical evidence only.

## Status

`T17B_COMPLETE`; overall T17 remains `T17_PARTIAL` only for the two protected
manual checks listed below. T17B has not been merged or deployed to staging or
production.

> Implemented against externally verified reviewer contract; final direct board comparison pending external reviewer.

`HUMAN_SCREEN_READER = NOT_EXECUTED`

### Human screen-reader checklist — every item `NOT_EXECUTED`

- [ ] VoiceOver: traverse all 27 registry surfaces by landmarks, headings,
  links, buttons, and form controls; verify names, roles, states, reading order,
  and current-navigation announcements.
- [ ] NVDA: repeat the same 27-surface traversal and checks.
- [ ] VoiceOver and NVDA: exercise `/auth/verify` pending, invalid-code,
  resend, and success states; verify the grouped six-digit label, digit order,
  error alerts, status announcements, and predictable focus.
- [ ] VoiceOver and NVDA: exercise onboarding screens 04–06; verify route
  heading/progress announcements, radio/checkbox labels and checked states,
  Back/Forward state, save errors, and completion focus/navigation.
- [ ] VoiceOver and NVDA: verify AppShell navigation plus dialogs/sheets on
  scan/review, inventory, planner, recipe/cook, settings, and Plus surfaces;
  check focus entry, containment, Escape/dismissal, focus return, and async
  status announcements. Do not initiate a payment.

## Reconciliation checkpoints

- `029011c39ad67af57752ad4bf68f419742a6fe01` — route-owned onboarding and
  initial registry reconciliation.
- `cbbeb1df74e2f9dbcf1e77c07803822ead460f41` — verification lifecycle,
  ownership, expiry, stale-request, and server-authority hardening.
- `f0349b6d76a06a8185906df2b844586c3008d700` — independent screen-contract,
  onboarding history/refresh, and settled visual-capture certification.
- `fde016a7b391e7f55153a92ffb1f1b9361686301` — accessible-target measurement
  against effective labelled controls.
- `53e950c161a81d77188ac7033f0f9dd248669fea` — nullable delivery truth,
  failed-resend cleanup, and preservation of supported spicy preferences.
- `8b0f050d91e919e4bbbb43d7be0ff1a661f2b050` — preservation of authoritative
  cuisine/restriction drafts across onboarding routes.
- `9a94afb975dee2d15066bf6f6bf2c284c0e76c60` — pending-auth ownership and
  restriction truth across lifecycle transitions.
- `0f358f2f8c9da35c2167489ad6fd63eae8ea8c47` — application HEAD; verification
  exit loading reset and round-trip/review of stored values outside visible
  onboarding chips.
- `00594eba755c6895f9edb9d3076282cf42919c44` — certification-only checkpoint;
  registry layout measurement waits for finite 200–250 ms entry transitions.
- `dd108a29e5747009beb48a9382c9199e16000184` — initial documentation
  checkpoint. This report plus current state, boards, audit, and handoff receive
  one corrective documentation checkpoint after review; its own hash is
  intentionally obtained from `git log` after commit.

## Reviewer-confirmed gaps closed

### Screens 04–06 are route-owned

- `/onboarding/household`, `/onboarding/preferences`, and `/onboarding/goals`
  derive the visible step from the URL. Direct load, refresh, Back, and Forward
  preserve route ownership; `/onboarding` redirects to screen 04.
- Screen 04 owns native single-select household size. Screen 05 owns native
  multi-select cuisine and dietary restrictions: exactly seven visible cuisine
  choices and nine visible restriction choices, both including canonical
  `other`. These visible choices do not narrow server truth: stored values
  outside the chips, including `italian` and `vegetarian`, survive navigation,
  appear in review, and are sent unchanged on completion.
- Screen 06 is the planning-goal screen ("Bạn muốn Takosan giúp việc gì
  trước?"): a native single-select `primary-goal` radio group with exactly the
  pre-existing client values `today`, `week`, and `both` (default `both`),
  followed by a review of the fields the server actually stores. `primaryGoal`
  is client-only: it is kept in the onboarding draft and auth state, steers the
  post-completion route, and is never included in the `/preferences` body. The
  copy states that the goal only decides the starting screen on this device.
  Screen 06 neither infers spicy level from the `spicy` restriction nor forces a
  valid stored preference back to `medium`.
- Household size keeps server truth (1..20). The five visible choices bucket
  stored values `>= 5` as "5+" without rewriting them; an untouched stored `7`
  is sent back as `7`. Only an explicit tap on the "5+" choice writes the
  canonical value `5`, matching the existing `/me/preferences` editor.
- For authenticated sessions, completion updates local auth state only after
  `/preferences` confirms `onboardingComplete: true`; failures and
  non-confirming responses remain on screen 06 without claiming success. The
  preserved offline-guest path intentionally skips the server write and updates
  local state. After confirmed completion, `week` navigates to `/week/setup`
  and `today`/`both` navigate to `/`, as on the PR base.

### Screen 03 lifecycle is tab-scoped and server-authoritative

- `/auth/verify` remains a public route over the existing auth API. Its
  `sessionStorage` context contains only normalized email, presentation-only
  cooldown/expiry metadata, nullable delivery state, and initiating identity
  scope. OTPs, dev OTPs, passwords, tokens, and validity decisions are never
  persisted there.
- Corrupt, unknown-key, unsafe-date, expired, or owner-mismatched records are
  removed. Anonymous legacy context is migrated only for an anonymous owner.
  Route exit/cancel, logout or identity change, and successful verification
  clear the context. Leaving `/auth/verify` also resets route-local loading;
  stale in-flight work cannot restore cleared state or claim a session.
- Registration returns `expiresInMinutes: 10`, from which the client derives
  presentation expiry. Resend has no expiry field, so expiry becomes unknown
  (`null`) rather than fabricated. This unresolved server/API contract is
  recorded below as a pre-existing protected blocker. Delivery remains
  `boolean | null`: a development OTP is not an email-delivery claim, and a
  failed replacement send clears stale delivery/expiry claims.
- Local expiry and delivery values are copy only. The server remains the sole
  OTP-validity and session-creation authority; guest-transfer deferral remains
  unchanged.

### Registry proof is independent of route existence

- `tests/e2e/t17-ui/screen-registry.ts` contains exactly 27 numbered entries,
  including accepted `/scan/:id/review` spelling and concrete landing,
  onboarding, planner-meal, and planner-shopping contracts (no `/.+/` proof).
- Every current registry entry is tagged to the reviewer-verified contract;
  reconstructed-kit wording in the historical T17 material is not current
  authority.
- `assertScreenContract` checks every declared heading, text marker, and test
  id. The suite also checks URL and navigation ownership, progress semantics,
  seeded server truth, and horizontal layout at each viewport.
- The clean registry-only matrix passed **18/18** across 360, 390, 430, 768,
  1024, and 1440. Its route-ownership case covers direct load, refresh,
  history, native radio/checkbox state, persisted review values, and the
  three-value `primary-goal` radio group (selection surviving Back/Forward) at
  every width.

## Changed-file and architecture inventory

- Runtime (9): `src/web/App.tsx`, `src/web/features/auth/AuthShell.tsx`,
  `src/web/features/auth/OtpMode.tsx`,
  `src/web/features/auth/VerifyRouteLifecycle.tsx`,
  `src/web/features/auth/verify-context.ts`, `src/web/pages/AuthPage.tsx`,
  `src/web/pages/OnboardingPage.tsx`, `src/web/services/auth.ts`, and
  `src/web/stores/useAuthStore.ts`.
- Certification/tests (8): `tests/e2e/t17-ui/screen-registry.ts`,
  `tests/e2e/t17-ui/t17-a11y.e2e.ts`,
  `tests/e2e/t17-ui/t17-registry.e2e.ts`,
  `tests/e2e/t17-ui/t17-screenshots.e2e.ts`,
  `tests/unit/auth-funnel-ui.test.tsx`,
  `tests/unit/auth-verify-route.test.tsx`,
  `tests/unit/client-session.test.ts`, and the new
  `tests/unit/onboarding-contract.test.tsx`.
- Documentation checkpoint (6): `TASK_BOARD.md`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/HANDOFF.md`, `docs/ai/T17_UI_V2_AUDIT.md`,
  `docs/ai/T17_UI_V2_REPORT.md`, and `docs/ai/TASK_BOARD.md`.
- The architectural change is frontend-only: URL-owned onboarding, an
  owner-bound verification lifecycle boundary, strict presentation context,
  and stronger independent certification. No schema, dependency, Worker,
  payment, recipe/planner algorithm, or infrastructure architecture changed.

## Verification at certification checkpoint `00594eb` (application `0f358f2`)

### Post-review fix `56fc01b` (screen 06 goal + household truth) — reran

| Exact check | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/onboarding-contract.test.tsx tests/unit/auth-funnel-ui.test.tsx tests/unit/auth-verify-route.test.tsx tests/unit/client-session.test.ts tests/unit/auth-guest-transfer-deferred.test.tsx` | **5 files; 87/87 PASS** (onboarding contract now 20 cases) |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm check:migrations && pnpm build` | exit 0; **180 files / 4094 tests PASS**; `migration-smoke=ok`; build **6.25 s** |
| `pnpm exec playwright test --config playwright.t17.config.ts tests/e2e/t17-ui/t17-registry.e2e.ts` | **18 passed**, six viewports (`.hoplite/artifacts/t17b-validation-p1p2/t17-registry.log`) |
| `pnpm exec playwright test --config playwright.t17.config.ts --grep-invert "screen registry certification"` | **198 passed / 6 intentional skips / 0 failed** (`t17-rest.log`); with the registry run the full matrix is again **216 / 6 / 0** |
| `git diff 858759f -- src/worker`, `-- migrations`, payment-like paths | all **0** |
| `git diff --check` | PASS |

The `00594eb` visual ZIP predates this fix; screen 06 captures in it show the
earlier review-only layout and are superseded for that screen.

| Exact check | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/auth-verify-route.test.tsx tests/unit/onboarding-contract.test.tsx tests/unit/auth-funnel-ui.test.tsx tests/unit/auth-google-credential.test.tsx tests/unit/auth-guest-transfer-deferred.test.tsx tests/unit/auth-resend-turnstile.test.tsx tests/unit/auth.test.ts tests/unit/client-session.test.ts` | **8 files; 102/102 tests PASS** |
| `pnpm exec vitest run tests/unit/auth-verify-route.test.tsx tests/unit/onboarding-contract.test.tsx` | **2 files; 39/39 tests PASS** |
| focused `pnpm exec eslint …` and `git diff --check` (commands recorded in `focused.log`) | both PASS |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm check:migrations && pnpm build` | exit 0; lint/typecheck PASS; **180 files / 4087 tests PASS**; `migration-smoke=ok`; Vite **2501 modules**, build **5.92 s** |
| `node scripts/t17/style-residuals.mjs && node scripts/t17/contrast-audit.mjs` | residuals **43 total / 43 protected-payment allowlisted / 0 unjustified**; contrast **33/33 PASS** |
| `pnpm exec playwright test --config=playwright.t17.config.ts tests/e2e/t17-ui/t17-registry.e2e.ts` | **18/18 PASS**, six viewports |
| clean serial `playwright.t17.config.ts` full projects | **216 passed / 6 intentional skips / 0 failed** across 222 project cases |
| `t17-a11y.e2e.ts` subset within that clean serial matrix | **12/12 PASS**: two automated accessibility cases × six viewports; separate from human screen-reader status |
| `pnpm exec playwright test --config=playwright.config.ts` | T13 **60/60 PASS**, eight files × three projects |

Full T17 breakdown: mobile-360 **36 pass / 1 skip**; mobile-390 **37 / 0**;
mobile-430 **36 / 1**; tablet-768 **36 / 1**; desktop-1024 **35 / 2**;
desktop-1440 **36 / 1**. Each project ran with its own isolated preview/API
ports and output directory under the artifact root.

The first fresh 360px certification attempt measured transient width 364 while
a finite entry transition was still active. Its isolated rerun passed; the
certification-only `00594eb` checkpoint increased settle time from 150 ms to
300 ms, after the documented 200–250 ms transitions. The clean serial matrix
then passed as recorded above. Earlier concurrent mobile attempts had preview
contention, and one T13 start found a leaked local preview; isolated serial
reruns superseded both environmental failures. No failing result is included
in the authoritative clean package.

## Visual evidence

The clean source evidence is private and uncommitted at
`.hoplite/artifacts/t17-playwright/final-00594eb-clean/`. It contains six
successful run logs, a11y reports, and **168 PNGs**, including independent OTP,
onboarding household, onboarding preferences, and onboarding review captures.
Capture waits exceed the finite 200–250 ms entry animations. The 390px OTP and
all three onboarding captures were inspected after the clean run and are
settled, readable, and not mid-opacity. The inspected contact sheet is
`.hoplite/artifacts/t17b-final-00594eb-contact-sheet.png`. Final gate, focused,
style/contrast, boundary, and T13 evidence is under
`.hoplite/artifacts/t17b-validation-00594eb/`.

Packaged evidence:
`.hoplite/artifacts/t17b-final-visuals-00594eb.zip` (18,043,834 bytes, 232
entries, **180 PNGs**: 168 T17 plus 12 T13 validation; SHA-256
`d6f6d4f032c0ac637ce5d1523ecc95b1411bc567538bca8d235a7131e6ad9d70`).
`MANIFEST.tsv` and `MANIFEST.json` record every screenshot's route, viewport,
filename, state, generating command, and SHA-256. The ZIP passed `unzip -t`.
It is workspace-private, not committed, and is not evidence that the
unavailable external boards were compared.

## Historical merge/deployment receipt (not T17B)

PR #44 head `c9525ab997777f259b428d7fc55e3864db064012` merged as current `main`
`858759f771baccb85f5ed6fd8e06df2fc0bbb112`. Exact-main CI run `35504648193`
succeeded. Deploy workflow `35504873956` then succeeded for release and
staging while production was skipped. Those receipts belong to the historical
T17 merge only; **T17B has not deployed to staging or production**.

## Boundaries and remaining external work

- `git diff 858759f771baccb85f5ed6fd8e06df2fc0bbb112 -- src/worker` is empty.
- Diffs are empty for `src/web/components/payment`,
  `src/web/pages/PlusPaywallPage.tsx`, `src/web/services/{api,http}.ts`, and
  `src/worker/routes/billing.ts`.
- **PRE-EXISTING PROTECTED AUTH-CONTRACT BLOCKER:** registration reports
  `expiresInMinutes: 10`, but resend supplies no fresh expiry metadata. T17B
  honestly sets presentation expiry to unknown after resend and has no Worker
  diff. A server/API owner must separately decide and return the authoritative
  resend lifetime.
- **PRE-EXISTING PROTECTED PAYMENT-AUTHORITY BLOCKER:** frontend annual/monthly
  values and the `VietQRModal` amount prop remain `599000`/`79000`, while
  `/billing/payment-intents` authority remains `499000`/`49000`; the QR amount
  is not sourced from the server payment intent. T17B intentionally has zero
  payment diff. A separate owner-authorized payment follow-up should align the
  displayed price, QR amount, and payment-intent authority.
- Migration diff is empty. No remote D1, production configuration, staging,
  production, release, merge, or PR #44 mutation was performed by T17B.
- **In-scope T17B implementation blockers:** none. The two pre-existing
  protected authority blockers above remain unresolved outside this task.
- **Manual blockers:** actual boards/ZIP were unavailable, so direct board
  comparison remains external; human NVDA/VoiceOver testing was not run.
- **Protected external:** hosted PR review/CI follows publication; merge and
  deployment remain operator decisions and are not authorized by T17B.

## Corrective documentation verification

The application and certification checkpoints did not change. Review of the
initial documentation checkpoint found imprecise offline-guest wording and
missing protected-blocker/accessibility detail; this follow-up changes only the
same six documentation files.

- `git diff --check` passed. Fresh base-to-worktree line counts remain
  `src/worker=0`, `migrations=0`, and protected payment paths `=0`.
- Required documentation-marker assertions passed for canonical status,
  blockers, onboarding routes, automated accessibility, and the unexecuted
  human checklist.
- `sha256sum` still reports
  `d6f6d4f032c0ac637ce5d1523ecc95b1411bc567538bca8d235a7131e6ad9d70`;
  `unzip -t` reports no errors. The corrected manifest validator passed with
  232 entries, 180 PNGs, 180 JSON records, 180 TSV records, zero missing fields
  or files, zero SHA-256 mismatches, and `testzip=None`.
- The first ad hoc manifest validator expected a `command` field instead of the
  manifest's declared `generatingCommand` field and therefore reported 180
  missing fields. Correcting that validator produced the passing result above;
  this was a validator-schema mistake, not an artifact defect.
- Application gates were not rerun for this documentation-only follow-up; their
  exact final application/certification results remain the table above.

---

# Historical T17 — Takosan UI V2 report — 2026-09-19 (superseded by T17B above)

Task: T17 Takosan UI V2 Full Product Redesign per the Takosan Redesign OS
v2.0.0 design contract. Branch `feat/t17-takosan-ui-v2`, PR #44 into `main`.
T17 base: remote `main` `769d08597563f816ef9c1dd9523fdafb687de3e2`.

Every statement below describes the **final HEAD of this branch only**.
Superseded intermediate claims from earlier continuations were removed rather
than annotated; the commit list is the history.

## Status: `T17_PARTIAL`

Everything the contract asked for that could be verified inside this sandbox
is implemented, mechanically certified and recorded here. Two Definition-of-
Done items cannot honestly be ticked at this HEAD and are named exactly under
"Remaining blockers". Nothing in this report is marked PASS unless the
command in the "Verification" section was executed at the recorded HEAD.

## Repository / PR identity (verified live)

- Canonical repository id `1368281478` → `tako-san1/Frigo-dev` (GitHub API,
  `gh api repositories/1368281478`; `default_branch=main`, not a fork). The
  task text named `frigo-7/Frigo-dev`; the earlier audit recorded
  `frigo-6` → `frigo-7`. All three are renames of the same id-stable
  repository; history and receipts match.
- PR #44 head at continuation start: `221648477cd720fa2150a3673a8f874f3d491bf4`
  (11 commits over base). All prior T17 commits preserved; this continuation
  adds commits on top (see "Commits").
- Pre-continuation baseline on `2216484`: `pnpm lint` PASS, `pnpm typecheck`
  PASS, `pnpm test` 178 files / 4047 tests — **1 timeout** in
  `client-session.test.ts › does not repopulate Week memory…` (5 s budget,
  concurrent with a Playwright browser download); the file re-run alone passed
  **33/33**, so the baseline is treated as green with a noted flake.

## Contract availability (limitation)

The user-attached `takosan-redesign-os-v2.0.0.zip` was **not present in this
sandbox** (no attachment mount; the earlier extraction under
`.hoplite/extracted/` did not survive the workspace rebuild). Reconciliation
therefore used the contract facts already recorded in-repo — the audit's route
inventory and migration map, the kit document names and screen numbers cited
in code comments (`02`, `03`, `04-06`, `09`, `19-26`), the DoD checklist items
quoted in the previous report, and the explicit requirements in the task text
(`/auth/verify`, canonical `scan-review`, reduced-motion surfaces, WCAG-AA,
27 registered screens). The 27-entry registry used for certification is in
`tests/e2e/t17-ui/screen-registry.ts`; entries whose number is recorded in-repo
are tagged `source: 'kit'`, the rest `source: 'reconstructed'`. Anyone holding
the ZIP can diff that file against `SCREEN_REGISTRY` in one pass.

## Commits in this continuation

- `dfdd0ab` — `/auth/verify` route, semantic-token migration, sheet/dialog
  semantics, registry/state/motion/a11y certification suites.
- `227e36b` — visual-review fixes (canvas width cap, aligned fixed bars,
  Plus/cooking width tokens, 44 px brand links, honest OTP subtitle).
- `8f25fbd` — cooking header title shrinks within 390 px (found by the
  registry overflow gate during the matrix run).
- `463bf29` — chip rails never shrink chips (Recipes/Inventory/Home filter
  rails were clipping labels at 390), rail labels truncate, status chips stay
  single-line; a11y spec audits the settled receipt-review state.
- docs checkpoint (this file, audit, CURRENT_STATE, TASK_BOARD, HANDOFF) —
  the commit after `463bf29` in `git log`.

## 1. Screen 03 — `/auth/verify` (contract discrepancy closed)

Finding: the registry requires `/auth/verify`; the router exposed `/auth`
only and OTP was an internal `AuthPage` mode. Fix (no security change):

- `App.tsx` registers `/auth/verify` with the **same** session guard as
  `/auth` (signed-in non-guest → `/` or `/onboarding`).
- `AuthPage` derives `mode = 'otp_verify'` from the route; the other modes stay
  component state. Registration / unverified-login enter verification by
  `navigate('/auth/verify')`; Back leaves with `replace` to `/auth`.
- `features/auth/verify-context.ts`: tab-scoped (`sessionStorage`)
  `{ email, resendAvailableAt, delivered }`. **Never** stores the OTP code,
  the dev OTP or a token; corrupt/missing values read as absent. It exists
  only so refresh/back/forward does not strand the user; the server remains
  the sole authority on code validity.
- `features/auth/VerifyUnavailable.tsx`: direct load with no context renders
  an honest "Không có yêu cầu xác thực đang chờ" note with real exits
  (register / login). No OTP form, no request is issued for an unknown user.
- Undelivered email (`OTP_DELIVERY_UNAVAILABLE`, `otpDelivered:false`) is
  persisted as `delivered:false` so a refresh cannot upgrade "not sent" into
  "sent": cooldown 0, error alert shown, resend enabled.
- `AuthShell` subtitle no longer prints "đã gửi tới " with an empty email.

Unchanged: Turnstile single-use tokens, `api.verifyOtp`/`resendOtp` bodies,
DEC-012 guest-transfer deferral, private-session capture, exact server error
mapping. `git diff 769d085 -- src/worker` = **0 lines**.

Tests — `tests/unit/auth-verify-route.test.tsx` **14/14**: direct load without
context (no form, no request, both exits); registration → `/auth/verify` with
60 s cooldown and code-free context; refresh restores email + cooldown and
completes against the server, context cleared after success; undelivered
context shows the delivery error and enables resend; six-digit typing / focus
advance / non-digit rejection / Backspace-back; paste of `" 49-38 17abc"` →
`493817` with focus on the last box; short submit refused locally with alert
and no request; wrong/expired code shows the exact server error and stays on
the route; resend locked during cooldown, then re-requests same email+purpose
and restarts the cooldown; `OTP_DELIVERY_UNAVAILABLE` on register reaches the
route honestly; failed resend keeps resend available; Back clears context so
re-entry is honest; corrupt storage treated as absent. Existing suites
`auth-funnel-ui`, `auth-resend-turnstile`, `auth-guest-transfer-deferred`
(router now declares `/auth/verify`), `auth-google-credential` pass.

## 2. Mechanical certification of the 27 registered screens

`tests/e2e/t17-ui/t17-registry.e2e.ts` walks every registry entry in the real
router: public screens without a session (01–03; 03 asserts the honest empty
state and zero OTP inputs), onboarding steps 04–06 by route, then on real
seeded truth: onboarding completed through the UI, T13 scan evidence seeded
(`t13-scans`) for screen 09, a plan generated through the planner for 16–18
(the meal route is followed from the plan's real link), catalog slug
`canh-chua-ca-loc-nam-bo` for 13/14, seeded lot `preview-stock-egg` for 11.
For each: visible proof (h1 / label / test id), navigation rule (visible on
standard screens, absent on immersive ones), no horizontal overflow. Asserts
27 distinct ids and attaches `screen-registry-results` JSON. A second test
certifies legacy redirects (`/profile`, `/family`, `/settings`, `/inventory`,
`/week`, `/week/setup`) land on registered screens.

Result: **PASS at all six widths** (see Verification).

## 3. Semantic-token migration

- Codemod `scripts/t17/migrate-semantic-tokens.mjs` (explicit map, word-
  bounded class tokens only; never touches identifiers, storage keys, headers,
  `frigo-assets.ts` or the payment UI): **991 replacements in 55 files**.
  Remaining dark-context and status-hue sites were migrated by hand
  (`semantic-overlay/*` scrims, `text-white` on green heroes, `takosan-yellow`
  for the torch/upgrade accents, `text-semantic-text-inverse` dark chips).
- Two arbitrary hex values removed (`hover:bg-[#164E3D]` →
  `takosan-green-hover`; `text-[#FACC15]` → `takosan-yellow`).
- Tokens added (mirrored in `takosan-tokens.css` and `tailwind.config.js`):
  `semantic-overlay` (kit scrim colour), `semantic-warning-strong` `#8F5307`,
  `semantic-danger-strong` `#B53434`; `semantic-text-muted` darkened from the
  kit's `#7B776F` (4.24:1 on background — fails AA body text) to `#6F6B64`
  (5.04:1). These are the only deviations from kit values and are documented
  as contrast corrections.
- Residual authority: `scripts/t17/style-residuals.mjs` scans `src/web` for
  raw palette classes, arbitrary colour values and legacy motion utilities and
  fails unless each hit matches an allowlist entry with a written reason.
  Enforced by `takosan-brand.test.tsx`. **Result: total=43, allowlisted=43,
  unjustified=0.** The single allowlist entry is `payment-boundary`
  (`components/payment/VietQRModal.tsx`, 43 occurrences): the PayOS/payment UI
  is a protected boundary (AGENT_RULES rule 7); this continuation added **0
  lines** to it. Zero `emerald-*`, zero `transition-all`, zero
  `animate-in|zoom-in-95|slide-in-from-*` in `src/web`.
- `rg -o 'slate-[0-9]+' src/web | wc -l` → **41** (all in the allowlisted
  payment file; 856 before).

## 4. Visual-regression contract

`t17-screenshots.e2e.ts` canonical loop now captures **25 surfaces** at
390/768/1440: landing, auth, onboarding, home, inventory, **scan**,
**scan-review**, **receipt-review**, recipes, recipe-detail, cook, planner,
shopping, **notifications**, profile, preferences, **household**,
planning-settings, notification-preferences, privacy, app-settings, plus,
**otp-empty** (+ logout-dialog, notifications-empty from the existing tests).
State evidence (`t17-states.e2e.ts`, deterministic, seeded preview, network
shaped with Playwright routes/controls — never production): loading (held
inventory read → announced `role=status`), error (armed synthetic 500 →
`role=alert` + retry recovers), empty (shopping/notifications honest empties),
offline (banner from `offline`/`online` events), bottom sheet (labelled
`role=dialog`, focus in, Tab cycling, Escape, focus return), destructive dialog
(`alertdialog`, cancel focused first, danger styling, Escape + focus return),
long Vietnamese text (93-char name through sheet → list → detail with no
overflow), keyboard focus (Tab order over /me: only interactive elements, each
with a visible ring), mobile fixed action (scan-review CTA above the bottom
nav; stays inside a 55 %-height viewport with an input focused — the
virtual-keyboard proxy available headlessly).

The historical branch used an ephemeral private capture directory that is no
longer present in this workspace. T17B replacement evidence is preserved under
`.hoplite/artifacts/t17-playwright/final-00594eb-clean/` and in the ZIP named
in the current report above.

## 5. Reduced-motion certification

`t17-reduced-motion.e2e.ts` emulates `prefers-reduced-motion: reduce` and, on
auth (login/register/`/auth/verify`), onboarding (3 steps), inventory sheet +
logout dialog, cooking (next/back), planner (setup → generated week →
shopping) and scan review, asserts: the surface is usable, **no CSS keyframe
animation is running** (spinners excluded — they signal progress) and **no
spatial transition (`transform`/`all`/`width`/`height`) longer than 200 ms is
declared**. Product changes this required: `animate-pulse/bounce/ping` and
`transition-tap/transition-transform` collapse under the media query
(`index.css`). Animation is never part of functional logic — the timer,
step index and plan truth are asserted independently.

## 6. Accessibility certification

Measured, not asserted:

- **Contrast** — `scripts/t17/contrast-audit.mjs` computes WCAG ratios for 33
  semantic pairs read from `tailwind.config.js`: **33/33 pass** (text ≥ 4.5,
  UI ≥ 3.0). Lowest text pair: `action-primary on background` 4.75;
  `text-muted on background` 5.04 after the correction above. `border-strong
  on surface` 1.77 is reported as *decorative* (inputs also change fill and
  show a 3 px focus ring). Translucent white body copy on green heroes
  (`text-white/80-90`, 3.8–4.4:1) was made solid white (5.0:1+).
- **axe-core** (`@axe-core/playwright` 4.10.2, tags wcag2a/2aa/21a/21aa +
  best-practice) over 25 surfaces + the OTP flow: **0 serious/critical
  violations** at final HEAD. Fixed on the way: `meta viewport` had
  `maximum-scale=1, user-scalable=no` (WCAG 1.4.4 critical → removed);
  onboarding progress grid carried `aria-label` on a `div` → `role=progressbar`
  with value attributes; scan-review outline button text 3.9:1 → primary text;
  preferences chips → `*-strong`/`hover` shades.
- **Heading structure** — exactly one `h1` per canonical surface (Fridge,
  Recipes, Cook and Scan had none; fixed — Scan uses `sr-only`).
- **Image alternatives** — 0 `<img>` without `alt` on any surface; scan
  preview alt made descriptive.
- **44×44 targets** — every interactive element measured ≥ 44 px (counting a
  positioned `::before` hit-area on the Switch). Fixed: TopBar/Header icon
  buttons 36→44, rail/sidebar brand link 32→44, onboarding cuisine chips,
  Home "Không mua thêm gì", Profile "Nâng cấp", auth "Quên mật khẩu?",
  receipt-review inputs/selects 34→44.
- **Dialog/sheet semantics** — shared `design-system/use-modal-focus.ts`
  (focus in, Tab trap, Escape, focus return) now drives `ConfirmDialog`, the
  new `BottomSheet` primitive (inventory add, scan manual-add), `MealSwapSheet`
  and `WeekExportModal`; all expose `role=dialog|alertdialog`, `aria-modal`,
  `aria-labelledby`. Inventory add-sheet fields are label-associated; expiry
  chips are a labelled group with `aria-pressed`.
- **OTP announcements** — digits are a `role=group` labelled "Mã OTP 6 chữ số"
  with per-digit names, `inputmode=numeric`, `autocomplete=one-time-code`;
  delivery outcome is a `status` (sent) or `alert` (not sent); short-submit
  and server errors are `role=alert`; success is `role=status`.
- **200 % zoom, keyboard order, visible focus, non-colour state** — covered by
  `t17-ui.e2e.ts` (200 % on 5 surfaces), `t17-states.e2e.ts` (Tab order +
  ring), status chips carry text labels not only colour, `aria-current` on
  nav, `aria-pressed` on toggles.
- **Not executed** (recorded honestly): a human screen-reader walkthrough
  with NVDA/VoiceOver. Semantics were verified through the accessibility tree
  (axe + role queries) only.

## 7. Human visual review of captures (390 / 768 / 1440)

Reviewed by inspecting the freshly captured PNGs at final HEAD. Fixes made
before baselining (none blindly accepted):

- Desktop canvas stretched reading lines edge-to-edge → `AppLayout` caps the
  content canvas at `--content-wide` (75 rem) and centres it.
- Fixed action bars spanned the full viewport, detached from content → inner
  content of all seven fixed bars capped to the same width; inventory floating
  CTA clears the nav/rail and is right-aligned auto-width on desktop.
- Plus page still used a `max-w-md` phone wrapper (clipped TopBar on desktop)
  → `--content-compact`; cooking wrapper likewise; auth shell keeps its narrow
  form column by design.
- Cooking header title truncated at 180 px on desktop → responsive max width.
- Home "use soon" chip showed UNKNOWN expiry in warning tone → neutral tone
  (UNKNOWN ≠ warning; ESTIMATED = info; KNOWN countdown = warning).
- Boards vs truth: the boards were unavailable in this sandbox (see
  "Contract availability"), so the review used the per-screen contracts as
  recorded in-repo and Takosan brand rules. Screenshots are **not** baselined
  as golden images; they are evidence for the human reviewer holding the
  boards.

## Verification (exact, at final HEAD)

Environment: Node v24.19.0, pnpm 10.26.0, Playwright 1.63.0 chromium
headless-shell (installed in-session), `sqlite3` 3.45.1 installed via the
repo setup script's own `apt-get` line (sandbox lacked it).

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | PASS |
| Typecheck | `pnpm typecheck` | PASS (app + worker) |
| Unit/integration | `pnpm test` | **179 files / 4062 tests PASS** (+1 file, +15 tests vs. start) |
| Migration smoke | `pnpm check:migrations` | PASS (`migration-smoke=ok`) |
| Production build | `pnpm build` | PASS — `index-*.js` 437.01 kB / 121.08 kB gzip |
| Style residuals | `node scripts/t17/style-residuals.mjs` | total 43 / allowlisted 43 / unjustified 0 |
| Contrast | `node scripts/t17/contrast-audit.mjs` | 33/33 pass |
| Raw greps | `rg emerald- src/web` / `rg transition-all src/web` / `rg 'animate-in\|zoom-in-95\|slide-in-from' src/web` | 0 / 0 / 0 |
| T17 suite 360×800 | `playwright test --config playwright.t17.config.ts --project mobile-360` | **35 passed / 1 skipped (by design) / 0 failed** |
| T17 suite 390×844 | `… --project mobile-390` | **36 passed / 0 failed** |
| T17 suite 430×932 | `… --project mobile-430` | **35 passed / 1 skipped (by design) / 0 failed** |
| T17 suite 768×1024 | `… --project tablet-768` | **35 passed / 1 skipped (by design) / 0 failed** |
| T17 suite 1024×768 | `… --project desktop-1024` | **34 passed / 2 skipped (by design) / 0 failed** |
| T17 suite 1440×900 | `… --project desktop-1440` | **35 passed / 1 skipped (by design) / 0 failed** |
| Canonical captures | part of the 390/768/1440 runs above | historical run reported 25 surfaces × 3 widths; the old ephemeral directory is unavailable, and T17B replacement evidence is named above |
| T13 inventory suite | `pnpm exec playwright test` (playwright.config.ts, 20 cases × 360/390/430) | **60 passed / 0 failed** (7.4 m) |
| Worker boundary | `git diff 769d085 -- src/worker` | **0 lines** |
| Payment boundary | `git diff 769d085 -- src/web/components/payment src/web/services` | `VietQRModal.tsx` 16+/16− presentation-only lines from earlier T17 commits (class names, "Takosan Plus" copy); **0 lines added by this continuation**; services untouched |
| Whitespace | `git diff --check` | clean |
| Worktree | `git status --short` | clean after the docs checkpoint (only the platform-managed `.hoplite/settings.json` may show as modified in-session; it is restored and never committed) |

Skips by design: the mobile-only fixed-action test skips at ≥768 (1 skip at
768/1440, 2 at 1024 together with the screenshot skip); the canonical
screenshot test skips at 360/430/1024 (captures are 390/768/1440 per the
visual-regression plan). All six widths were run **after** the last product
commit `463bf29`; the 390/430 runs in the first matrix pass caught the cooking
header overflow (`8f25fbd`) and the a11y run at 390 caught the transitional
receipt-review CTA frame (test-only wait), both re-verified green.

Test changes (justified, none weakened): `t13b-browser.e2e.ts` UNKNOWN-expiry
class assertion `bg-slate-100` → `bg-semantic-border/60` (+ asserts not
mint/emerald) because the token migration renamed the class, not the
behaviour; `auth-guest-transfer-deferred.test.tsx` declares the new
`/auth/verify` route in its MemoryRouter.

## DoD evidence (QA/definition-of-done.md)

- [x] 27 screen contracts represented — mechanically certified per width
  (`t17-registry.e2e.ts`), including `/auth/verify`.
- [x] One semantic design system + shared primitive authority — residual audit
  zero-unjustified; `BottomSheet`/`useModalFocus` shared.
- [x] Mobile/tablet/desktop AppShell; fullscreen exceptions (suite).
- [x] Required motion works; reduced motion certified on auth, onboarding,
  sheet/dialog, cooking, Planner (+ scan review).
- [x] Settings/account IA separated correctly (suite).
- [x] Planner canonical with Week compatibility redirects (suite).
- [x] Visible Frigo presentation leaks removed (greps; seeded display name
  "Frigo Preview" is fixture data, not UI copy).
- [x] No fake success/data/truth clone introduced; `/auth/verify` without
  context is an honest empty state.
- [x] Auth, Inventory Truth, OCR/AI, recipe authority, planning algorithms
  preserved — worker diff 0; full regression green.
- [x] PayOS/payment: zero application change; payment UI untouched by this
  continuation.
- [x] Required regression commands pass (table above).
- [x] T17 Playwright suite passes at all six widths; canonical `scan-review`
  captured; state matrix evidenced.
- [~] Accessibility: contrast measured, axe clean, headings/alt/targets/
  dialogs/OTP semantics verified. **Not executed:** assistive-technology
  walkthrough (screen reader).
- [~] Human design review against the **three Takosan boards** — the boards
  (in the ZIP) were not available in this sandbox; captures were reviewed
  against in-repo contracts and fixed, but the board comparison itself is
  outstanding.
- [x] Audit + this report reflect final HEAD only.
- [x] Branch pushed to `feat/t17-takosan-ui-v2`; `main` untouched; no merge;
  no deploy; production untouched.

## Remaining blockers (why not `T17_COMPLETE`)

1. **Board comparison** — a reviewer with the original design ZIP must compare
   the T17B package named in the current report against the three Takosan
   boards and `screens/*.md`, and diff
   `tests/e2e/t17-ui/screen-registry.ts` against `SCREEN_REGISTRY`.
2. **Screen-reader walkthrough** — NVDA/VoiceOver pass over the canonical
   surfaces (automated semantics are clean; the human check is unexecuted).

## Known limitations

- Kit ZIP absent in sandbox (above). Contrast corrections to `text-muted`,
  `warning-strong`, `danger-strong` deviate from kit hexes for AA compliance.
- Virtual keyboard is approximated by a reduced-height viewport; real
  `visualViewport` resize on device is not reproducible headlessly.
- The payment UI keeps 43 raw neutral classes by explicit allowlist.
- Screenshot PNGs live in the private artifact directory, not in git.
