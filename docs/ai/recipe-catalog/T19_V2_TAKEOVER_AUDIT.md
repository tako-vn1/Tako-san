# Post-merge recheck - 2026-09-23

Status remains `T19_V2_CODE_COMPLETE_PRODUCTION_BLOCKED`. Production is
`UNTOUCHED`; T20 is NOT STARTED. This recheck continues the existing handoff
PR #54 rather than opening another application PR or changing merged history.

## Independently refreshed evidence

- `gh api repositories/1368281478`, `git fetch origin --prune`, remote refs and
  PR #53 confirm `vn-tako4/Frigo-dev`, main `03005fc`, application head `dbf3254`,
  and immutable recovery ref `0a04209`. `git merge-base --is-ancestor` confirms
  both `62d6819` and the final integration head are contained in main. The added
  code diff since `62d6819` is only the three 1/5/25-percent routing regressions;
  the other additions are handoff documentation.
- Read hosted jobs, full logs and annotations for PR CI `35810551334`, exact-main
  CI `35810986000` and the incoming documentation-head CI `35811600094`.
  Each passed 189 files / 4,367 tests, lint, both typechecks, migration smoke and
  build. Compared PR/main run SHAs to fetched refs, not just green status names.
  Annotations are Node action-runtime deprecation and Ubuntu image-transition
  notices, not failed validation. PR #53 and #54 have no review threads.
- Read staging run `35811338820` jobs and `--log-failed`: the proof-configuration
  step failed at 02:41:55 UTC with
  `STAGING_RELEASE_VERIFY_TOKEN must be configured before deployment`.
  Build, deploy and smoke were skipped; the production job was skipped.
- Current `gh secret list --json name` and `gh variable list --json name`, also
  with `--env production` and `--env staging`, all return HTTP 403
  `Resource not accessible by integration`. This is a permission limitation,
  not fresh proof of missing secrets. The earlier inventory below remains
  historical evidence. Environment metadata still identifies the required
  production reviewer `vn-taphoanhatung`; no approval was requested or bypassed.
- Presence-only checks find no local `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `RELEASE_VERIFY_TOKEN` or
  `STAGING_RELEASE_VERIFY_TOKEN`. `pnpm wrangler whoami` reports unauthenticated
  (despite exit code 0). Live D1/Worker identity and release state remain UNKNOWN.
- `node scripts/d1-migration-check.mjs config` passes the committed production
  binding check. This does not certify the live account, binding, ledger,
  catalog, runtime ordering, foreign keys or quick-check.

## Independent review boundaries

Rechecked authority projection, snapshots, planner persistence, shopping,
health/probe evidence, both deployment workflows, release state transitions,
D1 certification and exact-version rollback against the current code and tests.
No new T19-specific P0/P1/P2 defect was confirmed. In particular, canary
`globalSource=mixed` describes cohort policy, not measured traffic distribution;
release verification separately rejects non-D1 `actualSource`, non-null fallback
and unready D1 evidence. The frozen-environment 1/5/25-percent routing regressions
are separate from synthetic content/readiness proof, not production evidence.

One inherited P2 precision limitation remains outside the authority change:
`packages/recipes/src/requirements.ts:46` converts rational serving scaling to a
number before shopping sees it. A zero-stock three-meal fixture (3-serving
recipes, requested servings 2, ingredient quantity 1) reports a known aggregate
`1.9999999999999998` rather than exact `2`. The baseline `a3b1564` accepts the
same value; that scaling code is unchanged by T19. The two-meal case does reach
T19's unresolved path rather than the baseline exception. Do not infer general
end-to-end exactness from the aggregate-output guard. Track serving-scale
precision in a scoped follow-up before claiming that stronger guarantee; no
inventory, lot, FEFO or cooking-deduction arithmetic was changed in this recheck.
The reviewer ran `pnpm vitest run .artifacts/t19-shopping-precision-diagnosis.test.ts`
(2/2 diagnostic cases passed). That temporary fixture was removed and its raw
log was not retained; it is not a committed regression or production proof.

## Fresh local verification

Node `v24.19.0`, pnpm `10.26.0`; `pnpm install --frozen-lockfile` passed.
Application code matches certified main; follow-up changes are documentation only.

- Focused command below: 8 files / 267 tests PASS.
- Fresh `pnpm test`: 189 files / 4,367 tests PASS, 929.89 seconds; no failed or
  skipped tests. No isolated rerun or test weakening was needed.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: PASS.
- `pnpm recipe:import:check`: PASS, 500 recipes / 2 batches,
  release `rel-bd00a4f53fcaeee4`.
- Local migration smoke was not rerun (`sqlite3` CLI is absent); exact-main
  hosted migration smoke passed and was inspected. No migrations were changed.
- `git diff --check`: PASS. Current-receipt consistency assertion: 7/7 PASS.
  Only the eight existing PR #54 documentation paths changed.

```sh
pnpm exec vitest run tests/integration/t19-recipe-authority-split.test.ts tests/integration/t19-planner-authority-persistence.test.ts tests/integration/t19-recipe-authority-observability.test.ts tests/unit/release-check.test.mjs tests/unit/d1-migration-check.test.mjs tests/unit/cloudflare-worker-rollback.test.mjs tests/integration/meal-planning-snapshot.test.ts tests/unit/shopping-hardening.test.ts
```

Raw local verification logs are in `.artifacts/t19-resume/` (gitignored).
Next: finish the documentation PR under normal repository policy, provision
authorized Cloudflare read access and verify matching GitHub/Worker release
secrets through approved controls, then certify current exact-main and live D1
before any rollout. A later main SHA needs its own main-push CI. No workflow
dispatch, remote D1 query/migration, deployment, secret change or rollback was
performed by this recheck. Final D1/500 cross-flow and exact-version rollback
evidence remain required before `T19_COMPLETE`.

---

# Earlier post-merge takeover state - 2026-09-23

Status: `T19_V2_CODE_COMPLETE_PRODUCTION_BLOCKED`. Production: `UNTOUCHED`.

- Application PR https://github.com/vn-tako4/Frigo-dev/pull/53 is MERGED.
- Reviewed integration head: `dbf32547a07fbc767e044365866a2bdfc4264cd8`.
- Application merge / certified main: `03005fcbc39ab3c964393d2091f726088a4be5d0`.
- PR CI https://github.com/vn-tako4/Frigo-dev/actions/runs/35810551334: PASS.
- Exact-main CI https://github.com/vn-tako4/Frigo-dev/actions/runs/35810986000: PASS.
- Both hosted runs passed 189 files / 4,367 tests, lint/typecheck, migration smoke
  and build. Jobs, logs, annotations and empty review threads were inspected.
  Annotations concern GitHub Actions Node runtime deprecation and the scheduled
  Ubuntu image transition; no validation error. Merge used normal protection
  and exact head matching, preserving the full recovered commit ancestry.
- `git merge-base --is-ancestor` proves the exact checkpoint and final application
  head are contained in main. Original recovery branch remains unchanged.

## Production evidence and external blockers

The main checkout's `d1-migration-check.mjs config` passes for DB -> frigo-db /
`f975ec39-b2c8-4a2a-80e1-0366054599d3`; this is source configuration evidence,
not proof of the live binding/database. `pnpm wrangler whoami` reports
"You are not authenticated." `pnpm wrangler d1 list --json` exits 1 because a
non-interactive environment needs `CLOUDFLARE_API_TOKEN`. No remote D1 ledger,
catalog, runtime count, foreign keys, quick_check or Worker version was read.
Those fields remain UNKNOWN, not inferred from fixtures or historical reports.

GitHub repository secrets are empty; production/staging Environment secrets
contain Cloudflare account/token names only. `RELEASE_VERIFY_TOKEN` and
`STAGING_RELEASE_VERIFY_TOKEN` are absent. Worker-side secret presence is UNKNOWN.
Production requires Environment reviewer `vn-taphoanhatung`.

Automatic staging run https://github.com/vn-tako4/Frigo-dev/actions/runs/35811338820
failed at "Require staging proof configuration before deployment" with
`STAGING_RELEASE_VERIFY_TOKEN must be configured before deployment`. Build,
deploy and smoke steps were skipped; production job was skipped. This is an
observed fail-closed gate, not a production incident or rollout attempt.

Production mutations: **none**. Staging mutations: **none**. Rollback previous
version/result: UNKNOWN / NOT RUN. T19_COMPLETE is not certified. T20 NOT STARTED.

## Operator next steps

1. Supply authorized Cloudflare read access in the execution environment so the
   exact account, Worker, DB binding/UUID, full current migration ledger and
   71+30+399 catalog can be certified. Do not expose credential values in chat.
2. Provision matching GitHub/Worker verification secrets: production
   `RELEASE_VERIFY_TOKEN`, staging GitHub `STAGING_RELEASE_VERIFY_TOKEN`, and
   staging Worker `RELEASE_VERIFY_TOKEN` (at least 32 characters). Verify both
   smoke origins and Worker-side presence; do not rotate unrelated secrets.
3. Recheck current main and exact-main CI. Complete read-only D1 certification
   and obtain the production Environment approval before dispatching the
   reviewed rollout. Bootstrap/downgrade confirmation follows the reviewed gate.
4. Verify each stage shadow -> canary 1 -> 5 -> 25 -> d1, representative
   legacy/pilot/scale cross-flow behavior, and exact previous-version rollback
   proof. Preserve D1 data. Only then record T19_COMPLETE; T20 remains blocked.

This final documentation receipt is published separately from the application
branch, so the certified application head and merge SHA remain explicit. Any
later main change needs its own exact-main CI before production release.

---

## Earlier takeover audit (retained; outcome superseded above)

# T19 V2 takeover audit - 2026-09-23

Status: `T19_V2_APPLICATION_PR_PENDING`. Production: `UNTOUCHED`.
Application PR: https://github.com/vn-tako4/Frigo-dev/pull/53 (base main).
This receipt supersedes earlier current-state publication claims; historical
records remain evidence of their original sessions. T20 is blocked.

## Exact recovery and publication

- Stable repository ID: `1368281478`; resolved repository: `vn-tako4/Frigo-dev`.
- Starting canonical main: `a3b1564329932515a047f674e9ab3e5b534716ca`.
- Original recovery branch: `feat/t19-recipe-authority-cutover-v2`, unchanged at
  `0a04209e512d19293ed56a19d3fd51eb29ffefcd`.
- Integration branch: `feat/t19-recipe-authority-cutover-v2-integration`.
- Application: `820588372690229e7a62dd8b54e86d73bae9b08c`, parent exact starting main.
- Hardening: `553791aa0827bd94a4373961214600f71561f44d`, parent exact application.
- Handoff: `62d68196f273e81c8756e29f6a3165769d61837c`, parent exact hardening.
- GitHub comparison: ahead 3, behind 0, 43 files.
- Exact checkpoint published successfully by normal Git push. After fetch,
  local HEAD, origin tracking ref and `git ls-remote` all equaled the handoff SHA.
- PR #52 is merged historical documentation, not this application PR.

The original workspace has an unrelated origin (`Tungjpstore/yaji`) and was
preserved, including its untracked `.hoplite/`. Recovery used the exact fetched
objects in `/Users/tunbee27/Documents/frigo-t19-checkpoint`; no reconstruction,
rebase, amend, force push, migration rewrite or recovery-branch mutation occurred.

## Independent review

P0: 0 confirmed. P1: 0 confirmed. P2: one verification gap addressed.

The protected probe tests did not directly demonstrate that running a forced
probe preserves actual household routing at every required 1/5/25 percent.
`tests/integration/t19-recipe-authority-observability.test.ts` now freezes the
serving environment and checks real authority resolutions for deterministic
inside/outside households both before and after each probe. The probe must
report the configured percentage while independently resolving the verified
500-recipe D1 content. All three new cases pass.

A synthetic forced-in-cohort probe certifies D1 readiness, identity and content;
it does not measure the percentage of live production requests or prove live
cross-flow behavior. Deterministic routing tests provide separate local routing
evidence. Production traffic/cross-flow and rollback certification remain required.

| Area | Inspection and evidence |
| --- | --- |
| Static planner isolation | `planner-catalog-authority.ts` returns an authority-only projection for static; `meal-planning-snapshot.ts` omits catalog/nutrition queries under static/shadow/outside-canary. Hidden D1 mutations cannot change the projected fingerprint. |
| D1 enrichment | Runtime recipe content/steps always come from the resolved snapshot. Metadata, nutrition, families and diagnostics are scoped to visible recipes and references. Enrichment failure retries essential household reads and preserves the authority universe. |
| Stored plans | `MealPlanningApplicationService` stores source/fingerprint/count, recognizes same-source drift, rejects stale swap/shopping, and regenerates with current authority and valid locks. Legacy envelopes remain readable. |
| Cross-flow | Recipe list/detail/recommendations, Week, planner and shopping attribution compose `resolveRecipeAuthority` with the household tenant key. Real Worker tests cover planner/alternatives/swap/detail/cooking and D1 fallback together; inventory/cooking suites remain green. |
| Shopping | `aggregateShoppingDemand` catches unrepresentable exact quantities and yields unresolved demand; no rounding or under-purchase. The optimizer emits `UNRESOLVED_PURCHASE_QUANTITY`. No inventory lot/FEFO/deduction implementation changed. |
| State machine | Static -> shadow -> canary-1 -> canary-5 -> canary-25 -> d1; optional 1 -> 2 -> 5. Skips/reverse promotions and stale code fail. Downgrade/bootstrap needs confirmation; a new SHA restarts safely. |
| Shadow proof | Customers stay static; a local copy of environment drives the protected D1 readiness/fingerprint proof. Promotion rejects fallback/stale readiness. |
| Staging | For provisioned staging, URL, GitHub token and Worker secret are checked before deployment. Missing staging configuration explicitly reports unprovisioned and performs no deployment. |
| Production certification | Deploy validates committed D1 binding, credential-selected account access to exact database name/UUID, ledger, ordered IDs, duplicates, runtime order, hydrated runtime fingerprint, foreign keys and quick_check before mutation. Live identity is still unverified. |
| Migration | Deploy has no migration apply. Manual migration workflow distinguishes exact pre-ledger apply from already-applied certification; verifies pinned chain, captures Time Travel bookmark before apply and fails closed on post-checks. 0036/0037 unchanged. |
| Worker rollback | Previous single 100% version captured before deploy; target/deployed D1 bindings pinned; API restoration targets `frigo` in the credential-selected account. Bounded retries/timeouts, explicit 10220 retry and token redaction reviewed. Post-check requires restored version, new deployment receipt and prior authority fields. Local proof is not live rollback evidence. |
| Workflow validation | YAML parse, JavaScript and shell syntax checks pass; release-check tests assert gate order, no automatic D1 apply, staging prerequisites and failure/cancellation rollback wiring. |

Review scope was the actual recovered diff, especially 553791a, related authority
consumers and release/D1/rollback tests. No application or workflow rewrite was
needed during this takeover. No live Cloudflare operation has been performed.

## Fresh verification

Environment: Node `v25.9.0`, pnpm `10.33.2`; hosted CI uses Node 22.
Dependencies installed with `pnpm install --frozen-lockfile`.

- Recovered checkpoint `pnpm test`: 189 files / 4,364 tests PASS, 116.61 seconds.
- Focused suite after added regression: 10 files / 313 tests PASS, 16.40 seconds.
- Final `pnpm test`: 189 files / 4,367 tests PASS, 105.44 seconds; no failed or skipped tests.
- `pnpm lint`: PASS; final repeat after added test PASS.
- `pnpm typecheck`: PASS, both configs; final repeat after added test PASS.
- `pnpm check:migrations`: PASS (`migration-smoke=ok`).
- `pnpm recipe:import:check`: PASS, 500 recipes, 2 batches,
  `rel-bd00a4f53fcaeee4`.
- `pnpm build`: PASS.
- `git diff --check`: PASS.
- `pnpm audit --prod`: 2 pre-existing moderate React Router advisories;
  dependencies and lockfile unchanged.
- Hosted PR CI: running; exact final head must pass before merge. Exact-main CI: not yet obtained.

Focused command:

```sh
pnpm vitest run tests/integration/t19-recipe-authority-split.test.ts tests/integration/t19-planner-authority-persistence.test.ts tests/integration/t19-recipe-authority-observability.test.ts tests/integration/meal-planning-snapshot.test.ts tests/unit/release-check.test.mjs tests/unit/d1-migration-check.test.mjs tests/unit/cloudflare-worker-rollback.test.mjs tests/unit/shopping-hardening.test.ts tests/unit/recipe-authority.test.ts tests/unit/recipe-canary-test-cohort.test.ts
```

Full raw local logs: `.artifacts/t19-takeover/` (gitignored). This committed
receipt records the durable result; raw logs are not production evidence.

## Release boundary and next action

Production mutations: none. D1 identity/ledger/count/integrity and Worker
version/mode/source remain unverified in this session. Expected D1 UUID is
`f975ec39-b2c8-4a2a-80e1-0366054599d3`; expected catalog is 71 legacy + 30 pilot
+ 399 scale = 500, release `rel-bd00a4f53fcaeee4`. Verify rather than assume.
The current repository ledger tip includes 0038; certification must match the
exact current main migration manifest, not assume historical 0037 is the tip.

Publish review/docs, open a new application PR, inspect exact-head hosted CI,
annotations/logs/review threads, and merge normally only with required checks
and protection satisfied. Then obtain exact-main CI before production read-only
certification. Production requires Environment approval, Cloudflare credentials,
GitHub/Worker `RELEASE_VERIFY_TOKEN`, staging `STAGING_RELEASE_VERIFY_TOKEN` and
Worker counterpart, and configured smoke origins. Never invent secret values.
Use only the reviewed workflow for staged rollout. Final D1/500 cross-flow and
exact previous-version live rollback evidence are required before `T19_COMPLETE`.

## GitHub release prerequisites checked (names only)

Repository secret listing is empty. Both `production` and `staging` Environment
secret listings contain only `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
Consequently the workflow has no GitHub `RELEASE_VERIFY_TOKEN` or
`STAGING_RELEASE_VERIFY_TOKEN`. Worker-side secret presence has not been checked.
Provision matching release verification values (at least 32 characters) in the
appropriate GitHub Environment and Worker before release. No values were read,
generated, disclosed or provisioned during this audit.

`PRODUCTION_URL` and `STAGING_URL` variable names exist. Production has a required
reviewer (`vn-taphoanhatung`); staging has no protection rules. Production rollout
must wait for that Environment approval. These release prerequisites do not
replace PR CI or exact-main CI. No workflow has been dispatched by this session.
