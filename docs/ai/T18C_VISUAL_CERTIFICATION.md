# T18C — Takosan redesign visual certification

Status: **T18C_READY_FOR_REVIEW** — local certification complete, review only
Branch: `feat/t18c-final-redesign-certification`
Source-led implementation checkpoint: `5d831aa`; keyboard checkpoints:
`592b386`, `ef5a619`, `b024b0d`. Final application freeze: `6f8f6f4`
(Home enlarged-text reflow).
Resume context: [T18C_WIP_HANDOFF.md](T18C_WIP_HANDOFF.md)

This document replaces the historical safe-pause baseline while retaining its
failure history. The `b024b0d` browser run exposed one Home text-zoom P2,
corrected at `6f8f6f4`. Fresh verification on that application freeze accounts
for **379 browser passes / 11 intentional skips / 390 unique cases** and
**184 unit/integration files / 4222 tests PASS**. All 27 identities have fresh
six-width screenshots and direct approved-board/contract review. This is not
a production, human-screen-reader, merge, or deployment certification.
The only dispositions used in the registry are `PASS`,
`PASS_WITH_DOCUMENTED_DIFFERENCE`, `FAIL`, and
`BLOCKED_REFERENCE_UNAVAILABLE`.

## Authority and scope

- Protected scope remains unchanged: no PayOS, payment, billing, checkout,
  migration, authentication-contract, Inventory Truth, OCR/AI, planner
  algorithm, household-isolation, or Week compatibility redesign is certified
  here.
- Authority order is security/current domain truth, approved tokens and
  primitives, approved per-screen contracts, responsive/accessibility/state
  contracts, then schematic boards. Boards communicate composition, hierarchy,
  and tone; they do not authorize fictional names, dates, counts, prices,
  expiry values, inventory facts, provider states, or entitlements.
- Canonical source registry: `.hoplite/extracted/t18c-approved/takosan-redesign-os-v2.0.0/screens/SCREEN_REGISTRY.json`.
- Approved source root: `.hoplite/extracted/t18c-approved/takosan-redesign-os-v2.0.0`.
- Approved source archive: `.hoplite/artifacts/t18c/approved-source.zip`,
  8,257,059 bytes, SHA-256
  `cbf5c32dd51ce9f068766cd20591c3cfd8a946ca6632aa2349725f4ef0d6492d`.
  The extracted kit's `CHECKSUMS.sha256` validation passed for all entries;
  the validation output is retained in
  `.hoplite/artifacts/t18c/resume/reports/source-checksums.log`.
- Direct boards are `references/board-01-entry-home-scan.png`,
  `references/board-02-food-planner.png`, and
  `references/board-03-account-settings.png`, each 1055 × 1491.

The approved source is therefore available and checksum-validated for **27/27
identities**. This supersedes the historical reference-unavailable condition;
it does not erase the fact that the original baseline could not compare boards.

## Preserved baseline and current evidence state

The historical baseline remains material evidence, not a current result:

- The baseline captured **162 screenshots** across 27 identities and six
  viewports (360, 390, 430, 768, 1024, and 1440). All 162 route contracts and
  horizontal-overflow checks passed.
- The baseline aggregate axe gate failed on every viewport with **15 moderate
  rule instances across 11 identities per viewport, 90 instances total**.
  No finding was suppressed. The original archive is
  `.hoplite/artifacts/t18c/baseline.zip`.
- The preserved fixed-tree checkpoint at `2e770f8` later recorded six passed
  matrix projects, 162 captures, zero strict axe violations, and zero overflow.
  It is historical, not a substitute for the final post-fix rerun.
- Source-led presentation/accessibility work at `5d831aa` includes the
  landing/home/app-shell/recipe/inventory/settings surfaces, reduced-motion
  handling, modal focus behavior, deterministic local font evidence, and the
  Board 3 privacy-row alignment fix. It does not change business or payment
  authority.
- Fresh post-fix evidence is under `.hoplite/artifacts/t18c/final/`, never
  substituted from baseline or `pre-zoom/`. Final canonical screenshots:
  **162 (27 × 6)**; additional regression screenshot files: **449**.
- Final route, shell and horizontal-overflow checks: **162/162 PASS**.
  Strict axe violations: **0** across all six projects. Axe incomplete/manual
  records remain visible (13/12/7/5/4/5 by ascending viewport width).
- Final Board 1/2/3 reports inspect top-fold and full-page evidence at
  360/390/430/768/1024/1440. **2 PASS / 25 PASS_WITH_DOCUMENTED_DIFFERENCE**;
  **0 FAIL / 0 BLOCKED_REFERENCE_UNAVAILABLE**, no unresolved P0/P1/P2.

Final repository receipt on `6f8f6f4`, completed 2026-09-21 08:23:33 UTC:
`pnpm lint`, `pnpm typecheck`, unfiltered `pnpm test` (**184 files / 4222
tests**, 554.62s), `pnpm check:migrations`, `pnpm build`, and
`git diff --check origin/main...HEAD` PASS. `git diff --check` also PASS.
`node scripts/t17/style-residuals.mjs`: **39 allowlisted / 0 unjustified**.
`node scripts/t17/contrast-audit.mjs`: **33/33 PASS**, one informational
border pair. Exact commands and receipts are in `final/reports/`.

All T17/T18C suites run under the unchanged six-project configuration. Three
outer 40-minute command timeouts left five cases unfinished; successful targeted
recovery plus strict manifest reconciliation accounts for all 390 unique cases.
This is **not one uninterrupted green runner exit**. The 11 intentional skips
are three T17 screenshot-width exclusions (covered by T18C's full matrix),
three non-mobile fixed-action exclusions, and five redundant boundary sweeps
(the 639/640/767/1024 sweep runs once from mobile-390). No retries, reduced
coverage, suppressed axe rules, or increased test timeouts were used.

The preserved axe results also retain incomplete/manual-review limitations:
zero strict axe violations is not a substitute for complete contrast review,
state coverage, or human assistive-technology review. Human VoiceOver:
**NOT PERFORMED**. Human NVDA: **NOT PERFORMED**.

## Canonical 27-screen registry

Shell vocabulary: `bottom nav` is the mobile shell, `navigation rail` is the
tablet shell, `sidebar` is the desktop shell, and `none` is intentional for a
public, onboarding, or immersive surface. The table records the source-led
final review disposition. Every row has verified screenshots, route/shell,
overflow and strict axe evidence at **all six widths**, plus direct board and
higher-priority contract comparison.

| ID | Canonical route | Screen | Auth | Mobile shell | Tablet shell | Desktop shell | Board | Final disposition |
|---:|---|---|---|---|---|---|---|---|
| 01 | `/landing` | Landing | public | none | none | none | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 02 | `/auth` | Auth | public | none | none | none | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 03 | `/auth/verify` | OTP Verification | public | none | none | none | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 04 | `/onboarding/household` | Onboarding Household | session | none | none | none | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 05 | `/onboarding/preferences` | Onboarding Food Preferences | session | none | none | none | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 06 | `/onboarding/goals` | Onboarding Goals | session | none | none | none | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 07 | `/` | Home | session | bottom nav | navigation rail | sidebar | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 08 | `/scan` | Scan Camera | session | none | none | none | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 09 | `/scan/:scanId/review` | Scan Review | session | bottom nav | navigation rail | sidebar | 01 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 10 | `/fridge` | Inventory | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 11 | `/fridge/:id` | Ingredient Detail | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 12 | `/recipes` | Recipes | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 13 | `/recipes/:slug` | Recipe Detail | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 14 | `/cook/:slug` | Cooking Mode | session | none | none | none | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 15 | `/shopping` | Shopping List | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 16 | `/planner` | Planner Overview | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 17 | `/planner/:planId/meal/:slotId` | Planner Meal Detail / Swap | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 18 | `/planner/:planId/shopping` | Planner Shopping Optimization | session | bottom nav | navigation rail | sidebar | 02 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 19 | `/me` | Profile Hub | session | bottom nav | navigation rail | sidebar | 03 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 20 | `/me/preferences` | Food Preferences | session | bottom nav | navigation rail | sidebar | 03 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 21 | `/me/household` | Household & Sharing | session | bottom nav | navigation rail | sidebar | 03 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 22 | `/settings/planning` | Planning Settings | session | bottom nav | navigation rail | sidebar | 03 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 23 | `/notifications` | Notifications Inbox | session | bottom nav | navigation rail | sidebar | 03 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 24 | `/settings/notifications` | Notification Preferences | session | bottom nav | navigation rail | sidebar | 03 | PASS_WITH_DOCUMENTED_DIFFERENCE |
| 25 | `/settings/app` | App Settings / PWA | session | bottom nav | navigation rail | sidebar | 03 | PASS |
| 26 | `/settings/privacy` | Privacy & Data | session | bottom nav | navigation rail | sidebar | 03 | PASS |
| 27 | `/plus` | Takosan Plus | session | bottom nav | navigation rail | sidebar | 03 | PASS_WITH_DOCUMENTED_DIFFERENCE |

Registry accounting: **27/27 identities**, **27/27 references available**,
**27/27 direct source comparisons**, no identity missing. Compatibility routes
in `src/web/App.tsx` (including `/inventory`, ingredient aliases, receipt
review, `/week/*`, cooking-complete, family, and planner compatibility paths)
remain regression scope and are not additional Takosan identities.

## Reviewed differences and disposition rationale

The following are explicit source-backed differences, not waived defects or
missing-reference exceptions. The archived per-board reports include exact
viewport paths and visual findings; the registry above owns final dispositions.

| ID | Source-backed comparison rationale |
|---:|---|
| 01 | Canonical supplied mascot replaces schematic food art; real guest/auth actions remain the entry hierarchy. |
| 02 | Unconfigured Google is honestly unavailable; current auth form/security states outrank a mock provider button. |
| 03 | Canonical capture has no pending verification; no delivered code, email or lifetime is invented. Sent/error/resend states have separate coverage. |
| 04 | Native household choices preserve exact 1/2/3/4/5+ values rather than the board's example grouping. |
| 05 | Current cuisine/restriction vocabulary is retained; no unsupported dislike persistence or allergy-safety claim is added. |
| 06 | Supported today/week/both goals and real saved-preference review replace example goal categories. |
| 07 | Empty Week and unknown-expiry states remain truthful; normal wide hierarchy reflows to stacked regions under enlarged text. |
| 08 | Local camera-unavailable state retains gallery input; no fake live-camera photograph or unsupported hardware control. |
| 09 | Explicit provenance, rejection, units and unknown expiry replace compact mock confidence rows; confirmation remains required. |
| 10 | Actual freshness and inventory state replace fictional expiry counts/dates; the full-width add action preserves the mobile action hierarchy. |
| 11 | Default read mode exposes the same-route editor; canonical delete ownership stays in Inventory rather than being duplicated. |
| 12 | Image-first feature/grid composition uses real catalog titles, match values and nutrition, not board example content. |
| 13 | Image hero and recipe facts retain real coverage; instruction-first initial tab is allowed by the contract. |
| 14 | The captured first step has no structured timer; no timer is fabricated. Immersive cooking has no AppShell navigation. |
| 15 | Actual empty shopping list retains manual add and explanation instead of fabricated items or costs. |
| 16 | Real generated plan, day/meal surfaces and available explanation fields replace board-only dates/progress values. |
| 17 | Swap entry is reachable but its sheet is closed in the canonical capture; source-backed ingredient/method/feedback content remains. |
| 18 | Supported currency/budget inputs are shown without inventing an uncalculated optimization outcome. |
| 19 | Synthetic local account identity and real navigation ownership replace the board's example portrait/name. |
| 20 | Serving count belongs to this editor; combined restrictions preserve the existing server representation. |
| 21 | Unsupported invite/join/member-list capabilities are honestly unavailable; no QR code or household members are fabricated. |
| 22 | Planning fields save preferences without generating a plan; serving ownership is not duplicated here. |
| 23 | Actual reminder rows and empty-state coverage replace fictional promotional/category notifications. |
| 24 | Real in-app switches are separate from unavailable channels; unsupported quiet hours are not claimed. |
| 25 | Real PWA/cache/language/build capabilities satisfy the contract; no fake offline or install-success switch. |
| 26 | Browser-permission copy wraps as one sentence; privacy/AI and unavailable export/delete states are truthful. |
| 27 | Server-owned 49000 monthly / 499000 annual VND and entitlement truth outrank promotional mock prices. |

### Board 1 — screens 01–09

The parent comparison completed the nine entry/home/scan identities against
Board 1 and their screen contracts. The accepted differences are source-safe:
the current auth, OTP, guest, onboarding, scan, and review flows retain their
real security, session, privacy, OCR, and confirmation behavior rather than
copying board-only data or adding a duplicate auth gate. Public/onboarding and
immersive scan surfaces intentionally use `none` navigation shells; Home and
Scan Review use the canonical shell shown in the registry. Fresh post-fix
six-width verification is complete in `final/review/board-01-final.md`.

### Board 2 — screens 10–18

The direct review is retained at
`.hoplite/artifacts/t18c/final/review/board-02-final.md`.

- Inventory's use-soon presentation uses the existing freshness query and
  preserves `UNKNOWN ≠ ESTIMATED ≠ KNOWN`; it does not invent board expiry
  counts/dates or duplicate quantity mutation.
- Ingredient Detail exposes a real same-route editor and keeps canonical delete
  ownership in the inventory list; a board tomato or always-open editor is not
  product truth.
- Recipes now use image-first feature/grid presentation and real recipe links;
  current catalog names, availability, match values, and nutrition remain
  authoritative rather than board examples.
- Planner, cooking, shopping, and optimization surfaces retain their real
  unavailable/empty/provider states and responsive workspace shells. Board-only
  recipes, prices, stock, dates, and optimization outcomes are not fabricated.

All six fresh post-fix evidence paths and exact PNG dimensions are recorded
in the Board 2 report; earlier captures are not used as final proof.

### Board 3 — screens 19–27

The direct review is retained at
`.hoplite/artifacts/t18c/final/review/board-03-final.md`.

- The account/settings family preserves the coherent Takosan shell and honest
  unavailable collaboration/notification states instead of board-fabricated
  identities, members, counts, rows, dates, or prices.
- Screen 20's household/serving context is owned by `/me/preferences`.
  Screen 22 has no serving field/default in its current contract; no serving
  default is claimed here.
- Screen 24 does not claim quiet-hours support because that capability is not
  implemented. No business quiet-hours behavior is fabricated.
- The screen 26 browser-permission row alignment P2 was fixed at `5d831aa` by
  keeping the permission message as one inline, wrapping sentence. Fresh
  screenshot confirmation at all six widths is complete.
- Takosan Plus follows current server-owned product truth; the board's example
  price or promotional copy is not copied into the application.

## Evidence index and final handoff

### Evidence-led corrections

| Finding | Severity | Localized correction | Proof |
|---|---|---|---|
| Missing landmarks / heading order | P2 | Semantic markup; no data or navigation-policy change | Baseline 90 moderate instances; fixed-tree 162 strict audits clean |
| Camera laser ignores reduced motion | P1 | `motion-safe` decoration | Red/green reduced-motion regression |
| VietQR focus escapes / does not return | P1 | Existing shared focus hook, scroll lock, trigger ref | Focus/Escape/return and strict dialog axe checks; no payment authority change |
| Click-only recipe and inventory detail actions | P1 | Native links/buttons with independent quantity/delete controls | Keyboard red/green at six widths; sibling mutation/delete checks |
| 768px shell instead of approved 640px boundary | P2 | Shared shell and fixed-action class breakpoint | 639/640/767/1024 boundary and CTA-clearance assertions |
| Landing/Home wide hierarchy; recipe discovery layout | P2 | Split hero / primary-secondary regions / feature and grid variants | Geometry and fresh source comparison |
| Missing control names/state, broad countdown announcements | P2 | Native radio labels, named Plus group, narrow status regions, item-specific shopping checkbox | Focused browser assertions; unchanged handlers |
| Privacy permission sentence split by flex layout | P2 | One wrapping inline text span | Sentence-layout regression and final pixels |
| Legacy Week card/setup keyboard actions | P2 | Native state-labelled controls; no-op non-recipe titles remain inert | Five compatibility units; routed flag-off browser flow |
| New title/brand targets lack explicit 44px bounds | P2 | Existing `tap-target` utility, no gate relaxation | Strict failure retained; focused rerun 14 PASS / 1 intentional project skip |
| Home overflows 46px at 1024px with 200% text zoom | P2 | Wrapping rem-based region widths, preserving normal primary dominance | Original zoom gate plus explicit Home stack regression 12/12; full final matrix accounted |

### Failure and recovery ledger

None of these earlier attempts substitutes for the clean final gates:

- Original baseline: six aggregate failures, 90 moderate axe instances. Immutable
  `baseline.zip` remains separate from fixed-tree and final evidence.
- Resumed fixed-tree: six matrix tests passed, 162 screenshots/strict axe audits.
- Source-led diagnostic: mixed 7 failures / 1 skip / 6 passes, because one
  recipe-link edit was already present during the run; not a clean red baseline.
- Initial 306-case T17 run and later final attempts were intentionally stopped
  as additional evidenced corrections were made. Logs are retained, not called
  passing suites.
- Boundary fixture initially retained an authenticated session; clearing public
  session state fixed the test without changing routing behavior.
- Inventory keyboard and shopping semantics: two focused failures, then 12
  passes. The sibling-action extension exposed a positional row locator after
  refetch; stable item identity fixed that test (1 pass).
- Native recipe Link exposed a missing export in an inventory unit-test router
  mock: 25 failures / 12 passes. Mounting actual MemoryRouter/Link restored all
  37 focused units with original inventory assertions intact. Two new fixture
  type errors were corrected (`appendChild`, lowercase `dinner`).
- Review found non-recipe Week title buttons whose existing caller has no
  detail destination: two red cases, then five green cases after removing the
  no-op actions. The real choose/change controls remain intact.
- The next full attempt failed the unchanged strict 44px-target gate on brand
  links and inventory titles. Explicit target bounds are the correction; the
  failed attempt and concurrent unit run are non-final, not hidden.
- The complete 390-case run on `b024b0d` ended 378 passed / 11 intentional
  skips / 1 failed. Home overflowed 46px at 1024px with 200% text zoom because
  a fixed breakpoint forced two columns into the rem-expanded shell. Three
  presentation classes now use wrapping, rem-based region widths. The unchanged
  five-route zoom gate plus explicit Home stacking regression pass at all six
  widths (12/12). The failed run is preserved as `pre-zoom/`; complete final
  browser/repository regeneration after this correction is now verified.
- Scheduling three isolated browser groups concurrently with full Vitest caused
  the unchanged recipe-import CLI case to exceed its 120s timeout (141.6s,
  versus 61.8s in the previous complete gate). No assertion failure was reported
  for that case. The contended unit attempt was intentionally interrupted and
  retained under `resource-contention/`. Full repository gates passed serially
  after browser completion; no timeout or coverage was relaxed. Transient local D1
  teardown stderr also remains in that attempt's log (its 44 tests passed).
- Three outer shell wrappers expired at 40 minutes (exit 124), with 385
  completed case receipts and no assertion failure. Five unfinished cases
  passed in targeted recovery. The manifest validator proves exactly 390
  unique accounted cases, rejecting missing, duplicate or unexpected outcomes.

The browser runs use isolated local Preview and synthetic fixtures. No live
payment/provider transaction, remote migration, production check, VoiceOver,
or NVDA session is represented by these logs.

- Source provenance and archive/checksum details:
  `docs/ai/T18C_SOURCE_PROVENANCE.md`.
- Historical safe handoff and preserved command ledger:
  `docs/ai/T18C_WIP_HANDOFF.md`.
- Baseline archive: `.hoplite/artifacts/t18c/baseline.zip`.
- Preserved review captures: `.hoplite/artifacts/t18c/mobile-390/`,
  `.hoplite/artifacts/t18c/tablet-768/`,
  `.hoplite/artifacts/t18c/desktop-1024/`, and
  `.hoplite/artifacts/t18c/desktop-1440/`.
- Final Board review reports: `final/review/board-01-final.md`,
  `board-02-final.md`, and `board-03-final.md` within the evidence root.
- Fixed-tree matrix and gap evidence:
  `.hoplite/artifacts/t18c/resume/reports/fixed-tree-matrix.log` and
  `.hoplite/artifacts/t18c/resume/reports/gaps-after.log`.
- Final evidence: `final-matrix.zip` (canonical screenshots, registry/axe JSON,
  review sheets/reports, exact commands, case receipts, summary and final
  repository logs), `final-shard-a.zip`, `final-shard-b.zip`,
  `final-shard-c.zip`, and `final-recovery.zip` (raw browser receipts and
  regression screenshots). Extract these into `.hoplite/artifacts/t18c/` to
  reconstruct `final/`; from the repository root, revalidate with
  `python3 .hoplite/artifacts/t18c/final/reports/summarize-evidence.py`.
- Failed/interrupted evidence stays separate: `pre-zoom-matrix.zip`,
  `pre-zoom-regressions.zip`, and `resource-contention.zip`. Baseline and
  approved-source archive hashes are unchanged.
- Archive integrity and checksums: `.hoplite/artifacts/t18c/EVIDENCE.md`.

Protected-diff review: no changes under `src/worker`, `src/shared`, `packages`,
`migrations`, `.github/workflows`, or `wrangler*`. Auth-shell semantics and
payment focus/ARIA/scroll-lock presentation do not change T18A auth, T18B
49000/499000 VND prices, issued-intent authority, signed verification,
idempotency, entitlement confirmation, Inventory Truth, OCR/AI, or Week logic.
Two independent code reviews found no unresolved P0/P1/P2.

Published evidence checkpoint: `321824d`.
[Review-only PR #48](https://github.com/vn-tako/Frigo-dev/pull/48) is OPEN
against `main`; CI/review auto-fix is enabled and auto-merge is disabled.
Initial check inspection: `validate` pending, no reviews/comments/unresolved
threads, no merge conflict. Local readiness does not claim hosted CI has passed.
The enabled loop resumes this task when CI/review settles; inspect its exact
head and feedback then. Human VoiceOver/NVDA checks remain separate work.
No merge, deploy, T18D, real provider transaction, or remote migration was
performed or authorized.
