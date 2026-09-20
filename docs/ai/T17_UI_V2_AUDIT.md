# T17B — reviewer-contract audit — 2026-09-20

Current authority: repository id `1368281478`, `omin-vn/Frigo-dev`; exact
starting `main` `858759f771baccb85f5ed6fd8e06df2fc0bbb112`; branch
`feat/t17b-contract-reconciliation`; application HEAD `0f358f2`; certification
checkpoint `00594eb`. The 2026-09-19 audit is retained below as historical
context and is superseded where it conflicts with this section.

## Confirmed gap-to-proof map

| Confirmed gap on starting main | T17B correction | Independent proof |
| --- | --- | --- |
| Screens 04–06 shared one component-internal step instead of URL ownership | URL-derived steps at `/onboarding/household`, `/onboarding/preferences`, `/onboarding/goals`; root redirect | unit route contract plus six-width direct-load/refresh/Back/Forward browser case |
| Screen 06 goal buttons lacked native single-select semantics and `primaryGoal` was sent in the completion body | native `primary-goal` radio group with the existing `today`/`week`/`both` values; goal kept client-only and excluded from `/preferences`; server-confirmed completion then routes `week` → `/week/setup`, otherwise `/` | unit API-body (no `primaryGoal` key), routing, and navigation-survival cases; browser three-radio and Back/Forward assertions |
| Onboarding presentation clamped stored household size to 5 | stored `6..20` displayed as "5+" but sent back unchanged unless the user explicitly picks a size; explicit "5+" writes canonical `5` | unit round-trip of `householdSize = 7` through all steps and explicit-choice case |
| Registry could certify route existence with broad or partial markers | concrete weak contracts replaced; all declared contract fields asserted | 27 result records per viewport, **18/18** registry matrix |
| Verify context accepted insufficiently bounded lifecycle/expiry state | strict shape, identity binding, safe dates, cleanup on route/identity/cancel/success | verify-route and client-session tests for corrupt/owner mismatch/history/stale requests |
| Resend could imply a fabricated new OTP lifetime | resend expiry becomes explicitly unknown without server metadata | unit assertion plus honest UI copy |
| Delivery state could overclaim email send or survive a failed replacement | `boolean | null` truth; development OTP is not delivery; failures clear stale delivery/expiry | verify-route resend/delivery regressions and 102-test auth run |
| Review completion could overwrite a valid supported spicy preference | preserve the authoritative stored value through review/completion | onboarding regression for `hot` review and request body |
| Visible onboarding chips could narrow persisted server truth | exactly seven cuisine and nine restriction choices, both with canonical `other`; preserve values outside the visible set | regressions round-trip and review `italian` cuisine plus `vegetarian` restriction |
| Leaving `/auth/verify` during an async operation could retain loading UI | reset route-local loading whenever the route is no longer verify | verification-abandonment regression |
| Target audit measured labelled children rather than effective controls | measure enclosing labelled control hit areas | six-width a11y matrix in the 216-pass clean run |

## Authority and data audit

- The server remains the only OTP/session authority. Browser context is
  presentation metadata, tab-scoped, owner-bound, and credential-free.
- `primaryGoal` has no worker, migration, domain, query, or persisted
  `user_preferences` authority; it is a client-only draft/auth-state value that
  selects the post-onboarding route and is never sent to the server. Supported
  server onboarding fields are household size, spicy level, favorite cuisines,
  dietary restrictions, and the server-confirmed completion flag.
- For authenticated sessions, onboarding preference state is a draft until the
  server confirms completion. The preserved offline-guest path intentionally
  skips the server write and completes locally. The visible choice set does not
  redefine server truth: unknown-to-this-screen stored values remain in the
  draft, review, and completion body. Spicy level is an independent persisted
  field, not inferred from the `spicy` restriction. Existing household
  isolation, session guards, guest-transfer deferral, and Week compatibility
  are preserved.
- Accepted screen 09 route spelling remains `/scan/:id/review`.
- Current registry entries are the reviewer-verified contract. Any older
  reconstructed-kit wording retained below is historical only.

## Scope audit

- Application changes are limited to frontend auth/onboarding routing,
  lifecycle, and their tests. `src/worker` has no T17B diff.
- No PayOS/payment/billing/checkout/webhook behavior or protected Plus pricing
  code changed. No migration or production infrastructure changed.
- `PRE-EXISTING PROTECTED AUTH-CONTRACT BLOCKER`: registration returns a
  10-minute lifetime, while resend supplies no new expiry metadata. T17B keeps
  the client honest with unknown expiry; a server/API owner must resolve the
  protected contract separately.
- `PRE-EXISTING PROTECTED PAYMENT-AUTHORITY BLOCKER`: frontend/VietQR-prop
  prices `599000`/`79000` differ from payment-intent authority
  `499000`/`49000`, and the QR does not source its amount from the server
  intent. A separate owner-authorized payment follow-up is recommended; T17B
  intentionally has zero payment diff.
- Final evidence is 180 files/4087 Vitest tests, focused auth 102/102,
  verify/onboarding 39/39, T13 60/60, registry 18/18,
  clean T17 216 pass/6 intentional skips, automated accessibility 12/12 across
  six viewports, residual 43/43 allowlisted/0 unjustified, and contrast 33/33.
  Full commands and superseded environment failures are recorded in
  `docs/ai/T17_UI_V2_REPORT.md`.
- Private visual source is
  `.hoplite/artifacts/t17-playwright/final-00594eb-clean/`; the validated
  package is `.hoplite/artifacts/t17b-final-visuals-00594eb.zip` (232 entries,
  180 PNGs; SHA-256
  `d6f6d4f032c0ac637ce5d1523ecc95b1411bc567538bca8d235a7131e6ad9d70`).
- Actual redesign boards/ZIP were unavailable. Implemented against externally verified reviewer contract; final direct board comparison pending external reviewer.
- `HUMAN_SCREEN_READER = NOT_EXECUTED`.

---

# Historical T17 — Takosan UI V2 audit — 2026-09-19 (superseded where noted)

Pre-edit record required by `03_REPO_BASELINE.md` of the Takosan Redesign OS
v2.0.0 kit. Design contract: attached `takosan-redesign-os-v2.0.0.zip`,
extracted outside tracked paths under `.hoplite/extracted/` (untracked,
git-ignored attachment area).

## Continuation record — 2026-09-19 (certification pass)

- Canonical repository re-verified live: id `1368281478` → `tako-san1/Frigo-dev`
  (renamed again since `frigo-7`; same id, `main` default, not a fork).
  PR #44 head at start `2216484`. Kit ZIP **not present** in this sandbox
  (attachment did not survive the workspace rebuild); reconciliation used the
  in-repo record (this audit, code comments, the previous report) plus the
  task text. Registry used for certification:
  `tests/e2e/t17-ui/screen-registry.ts` (`source: kit|reconstructed` per row).
- New contract facts recorded: screen 03 lives at `/auth/verify` (was an
  internal `AuthPage` mode — fixed); canonical `scan-review` is a required
  capture (was missing — added); reduced-motion coverage is required on auth,
  onboarding, sheet/dialog, cooking and Planner (was Planner-only — added).
- Baseline before product edits (HEAD `2216484`): lint PASS, typecheck PASS,
  vitest 4046/4047 with one 5 s timeout in `client-session.test.ts` under
  concurrent load; the file alone re-ran 33/33.
- Token deviations from kit values, all for WCAG-AA: `--semantic-text-muted`
  `#7B776F` → `#6F6B64`; added `--semantic-warning-strong #8F5307`,
  `--semantic-danger-strong #B53434`; `semantic-overlay` exposed as a Tailwind
  colour. `index.html` viewport no longer disables zoom.

## Environment record

- Checkout path: `/tmp/hoplite/workspace` (Hoplite thread workspace).
- `git remote -v`: `origin https://github.com/frigo-7/Frigo-dev.git` (fetch/push).
  The kit names `frigo-6/Frigo-dev`; `docs/ai` records canonical repository ID
  `1368281478` resolving to `frigo-6/Frigo-dev`. The GitHub account has been
  renamed/transferred to `frigo-7`; history, task packets, and prior receipts
  match this exact project, so this is the same canonical repository. The kit
  itself says it does not pin a SHA and the org rename is a display identity
  change, not a different codebase. Recorded as an identity note, not a blocker.
- Worktree at audit start: only `.hoplite/settings.json` (platform-managed
  preview metadata, rewritten by Hoplite, excluded from T17 commits) and the
  untracked `.hoplite/extracted/` kit copy. No user work overlaps T17 files.
- Fetched remote `main` SHA (live, after `git fetch origin main`):
  `769d08597563f816ef9c1dd9523fdafb687de3e2` — ahead of the kit's historical
  observation `14f06ff7f3ede72e676e2cb42b9949cca074a070` (T15C/T16 work merged
  since). Per the kit, the live SHA is used and history was not moved.
- Branch created: `feat/t17-takosan-ui-v2` from `769d085` (commit
  `90b6ea1` adds only canonical kit icon assets that the previous brand
  migration had not installed). `main` untouched.
- Node `v24.19.0`, pnpm `10.26.0`, lockfile installed with
  `pnpm install --frozen-lockfile` (no lockfile changes).
- T13 Playwright config: `playwright.config.ts` targets
  `t13b-*.e2e.ts`/`t13r-*.e2e.ts` at 360/390/430 mobile widths via
  `scripts/security-preview.mjs`; T17 coverage must be isolated from it.

## Baseline gates (on `769d085`, before any T17 edit)

- `pnpm lint` — pass (no output).
- `pnpm typecheck` — pass (app + worker configs).
- `pnpm test` — pass: **178 files / 4046 tests**.
- `pnpm check:migrations` — pass through tip `0038_auth_onboarding_completion.sql`.
- `pnpm build` — pass (vite build + worker tsc).
- Known pre-existing debt (not introduced by T17): `pnpm audit --audit-level
  high` reports 21 advisories (6 high) in wrangler/miniflare/jsdom/sharp
  dev/deploy tooling per prior receipts; no browser-bundle impact.

## Routes inventory (current)

| Route | Page | Notes |
| --- | --- | --- |
| `/landing` | LandingPage | public, no forced auth |
| `/auth` | AuthPage | 930-line monolith (login/register/OTP/GG in one file) |
| `/onboarding` | OnboardingPage | single route, internal step state |
| `/` | HomePage | inside AppLayout |
| `/fridge`, `/inventory`→`/fridge` | InventoryPage | |
| `/ingredients/:id`, `/inventory/:id` | IngredientDetailPage | kit target is `/fridge/:id`; today detail lives at `/ingredients/:id` and `/inventory/:id` |
| `/inventory-reconciliation` | ReconciliationPage | |
| `/scan`, `/scan/:id/review`, `/scan/receipt-review` | ScanPage/ScanResultPage/ReceiptReviewPage | |
| `/recipes`, `/recipes/:slug`, `/recipes/id/:id` | RecipesPage/RecipeDetailPage | |
| `/cook/:slug`, `/cooking/:id`, `/cooking/complete` | CookingModePage/CookingCompletePage | fullscreen |
| `/week`, `/week/setup`, `/week/generating`, `/week/:planId`, `/week/:planId/meal/:mealId`, `/week/:planId/shopping`, `/week/:planId/settings` | Week* pages + MealDetailPage | legacy Week surface |
| `/planner`, `/planner/new`, `/planner/:planId`, `/planner/:planId/meal/:slotId`, `/planner/:planId/shopping` | PlannerPage (gated by `VITE_MEAL_PLANNER_ENABLED`) | redirects to `/week` when flag off |
| `/shopping` | ShoppingPage | |
| `/notifications` | NotificationsPage | inbox + device-local toggles mixed in |
| `/profile` | ProfilePage | menu dump; links food prefs → generic `/settings`, planning → `/week/setup` |
| `/family` | FamilySharingPage | |
| `/settings` | SettingsPage | PWA + language + cache + logout mix |
| `/plus` | PlusPaywallPage | visible "Frigo Week Planner" copy; emerald styling |

## Migration map (mandatory audit findings)

| Current file/pattern | Current responsibility | Target authority | Action | Risk/tests |
| --- | --- | --- | --- | --- |
| `AppLayout.tsx` centered `max-w-md sm:max-w-lg md:max-w-2xl` shell | phone-emulation container on desktop | AppShell V2 owns width; mobile bottom nav, tablet rail, desktop sidebar | adapt | all pages gain responsive canvas; T17 visual suite at 360/390/430/768/1024/1440 |
| `BottomNav.tsx` `<button onClick=navigate>` items | nav without real links | one Navigation primitive rendering bottom bar/rail/sidebar with real `<Link>` + `aria-current` | adapt | unit tests for nav semantics; T13 e2e untouched |
| `hideBottomNavPaths` hides nav on `/planner`, `/week/*` | nav lost on planner screens | AppShell keeps nav on standard pages; hide only in immersive contexts (scan/cook/auth/onboarding) | adapt | planner reachable via nav at all widths |
| 28 pages with `max-w-md mx-auto` phone wrappers | per-page width emulation | `Page` primitive requests semantic width; AppShell owns gutters | adapt | visual suite overflow checks per viewport |
| `pages/AuthPage.tsx` 930 lines (login+register+OTP+Google+forgot) | monolith | `features/auth/*` composed by thin page; mode transition with presence | adapt | existing auth unit tests + e2e keep passing; no endpoint/CSRF/Turnstile/GSI change |
| `pages/OnboardingPage.tsx` internal steps | onboarding flow | decompose into step components per kit; server draft authority preserved | adapt | onboarding unit tests; completion redirect unchanged |
| local `Button/Card/Badge/StatusChip/EmptyState/ConfirmDialog/QuantityStepper` in `components/common` | existing shared primitives | keep as the primitive authority; extend to kit semantics (focus ring, loading, sizes) — no parallel family | retain+extend | unit tests around primitives |
| `components/payment/VietQRModal.tsx` "Frigo Plus", "Frigo Week" strings + emerald | payment success UI copy | Takosan Plus naming + semantic tokens; **payment logic zero change** | adapt (presentation only) | PayOS path diff must be zero; manual copy inventory |
| `pages/PlusPaywallPage.tsx` "Frigo Week Planner" copy, emerald pricing | Plus presentation | Takosan Plus value section, real entitlement/price source | adapt | Plus tests; no grant/payment change |
| 15 `emerald-*` usages in tsx | hardcoded legacy green presentation | semantic `action` tokens | adapt (done: 0 remain) | grep gate + visual checks |
| 856 `slate-*` + 210 status-hue (`rose/amber/sky/orange/red`) raw palette sites | legacy neutral/status palette | `semantic-*` tokens; `payment/VietQRModal.tsx` allowlisted (protected) | adapt (done: 991 codemod + manual; residual audit 43/43 allowlisted) | `scripts/t17/style-residuals.mjs` guarded by `takosan-brand.test.tsx` |
| `pages/AuthPage.tsx` OTP as internal mode | screen 03 not a route | `/auth/verify` route over the same state machine; tab-scoped, code-free context; honest empty state | add (done) | `auth-verify-route.test.tsx` 14 cases; registry e2e |
| plain-div bottom sheets (Inventory add, Scan manual-add, MealSwapSheet, WeekExportModal) | no dialog semantics / trap | `BottomSheet` primitive + shared `useModalFocus` (also drives `ConfirmDialog`) | adapt (done) | states e2e (sheet/dialog), a11y e2e |
| `transition-all`/`animate-in`/`fade-in`/`slide-in` across 21 files | ad-hoc animation classes | motion primitives with token durations; reduce `transition-all` | adapt | reduced-motion suite |
| `/week/*` routes + Week pages; `/planner/*` behind `VITE_MEAL_PLANNER_ENABLED` redirecting to `/week` | competing Week/Planner products | Planner canonical when enabled; Week routes redirect with params preserved; flag-off fallback keeps Week (honor existing deployments) | bridge | legacy-redirect tests: `/week/:planId` → `/planner/:planId`, `/week/:planId/shopping` → `/planner/:planId/shopping`, `/week/:planId/meal/:mealId` → `/planner/:planId/meal/:mealId`, `/week/setup` → `/planner/new`, `/week` → `/planner` |
| `/week/:planId/settings` (WeekSettingsPage) | plan-scoped settings used as global settings | when planner enabled redirect to `/settings/planning`; WeekSetup stays the new-plan flow | redirect | settings tests |
| ProfilePage menu dump (`/profile`) | identity + mixed settings nav | `/me` hub; `/me/preferences`, `/me/household` dedicated screens; `/profile` redirects to `/me` | adapt+redirect | nav tests |
| NotificationsPage inbox + device-local toggles | inbox mixed with delivery preferences | `/notifications` inbox only; `/settings/notifications` preferences (device-local persistence stays, clearly labelled) | adapt | notification tests |
| SettingsPage PWA/lang/cache/logout mix | generic settings | `/settings/app` (PWA/lang/cache/version) + `/settings/privacy` (AI/data) split; `/settings` redirects to `/settings/app` | adapt | settings tests |
| `/family` (FamilySharingPage) | household sharing | `/me/household` authority; `/family` redirects there | redirect | family tests |
| no `/fridge/:id` route | ingredient detail | kit target `/fridge/:id`; keep old paths redirecting | add+redirect | detail tests |
| `styles/frigo-tokens.css` legacy `--frigo-*` aliases | compatibility aliases onto Takosan values | keep until no consumer reads them, then retire after proof | bridge→retire | grep for `var(--frigo-` consumers |
| `public/frigo/*` legacy PNG brand assets | old icons/mark | superseded by `/takosan/*`; retire only when no live consumer | retire after proof | grep + build |
| `services/http.ts` `X-Frigo-Expected-*` headers | internal API contract | internal identifier — keep (rule 11: cosmetic rename forbidden) | retain | integration tests |
| `TakosanIcon.tsx` inline SVG icon set | icon component | keep; extend with kit icon set where nav/feature icons needed | retain+extend | icon rendering tests |

## Duplicate/overlap findings

- Duplicate plan surfaces: WeekDashboardPage/WeekSetupPage/WeekShoppingPage/
  MealDetailPage vs `features/planner` (PlannerShell/PlannerWeek/PlannerMeal/
  PlannerShopping) — two presentation layers over the same plan truth.
- Settings overlap: Profile menu links food preferences to `/settings`;
  SettingsPage mixes PWA, language, cache, logout, privacy copy.
- Notification overlap: delivery toggles live inside the inbox page.
- Modal variants: ConfirmDialog, LogoutDialog, VietQRModal, MealSwapSheet,
  WeekExportModal are separately styled overlay components — one overlay
  authority (Dialog/AlertDialog/BottomSheet) with shared focus semantics.
- Honest-state survey: household invite in FamilySharingPage has no backend
  invite contract — must show unavailable, not a fake success; guest upgrade
  path must keep honest gating; WeekExportModal local text export is real and
  stays labelled as local download.

## Baseline conclusion

Safe to proceed. No stop condition from `03_REPO_BASELINE.md` applies: the
worktree is clean apart from platform-managed `.hoplite/settings.json`
(excluded from T17 commits), remote `main` resolves, and baseline gates pass.
Canonical kit icon assets referenced by `takosan-brand.ts` that were missing
from the earlier brand migration (search, notification, expiry, settings,
budget, nutrition, scan, shopping-list, leaf) were installed in the baseline
commit so existing code paths render the canonical assets.
