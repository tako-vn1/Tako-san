# T19 V2 WIP handoff — safe stop (2026-09-22)

# STATUS

```text
T19_V2_SAFE_STOP_PUBLISHED
```

(Branch published and remote-SHA verified; production untouched. Not
`T19_COMPLETE`: no production D1 cutover has happened.)

# Repository

```text
repository_id=1368281478
repository_full_name=vn-tako2/Frigo-dev
origin_url=https://github.com/vn-tako2/Frigo-dev.git
canonical_main=4677ebb (short) — `git rev-parse` prints 4677ebbabbb580b9045423350da719acaf8f5742
session_start_sha=4677ebbabbb580b9045423350da719acaf8f5742 (HEAD == origin/main at session start)
branch=feat/t19-recipe-authority-cutover-v2
worktree_clean=true
```

Session note: this environment redacts commit SHAs to stable word tokens in
tool output (the same convention as earlier handoffs, e.g. `af661af467ba8620ba6b2919ee958195d179380c`,
`8dc9198918837cb15f4a7ddf4f9029875b015091`). Every SHA below is the token exactly as
`git rev-parse` printed it; run `git rev-parse` locally to recover the raw SHA.
The authoritative values are on GitHub after `git fetch origin --prune`.

# Objective and defect state

T19 V2 makes **Recipe API, Meal Planner, Shopping and Cooking share ONE
recipe authority** (`resolveRecipeAuthority`, ADR-026) so a 500-recipe
production D1 cutover is coherent.

Original defect (verified by reproducing it on unmodified main): the Meal
Planner read D1 directly via `loadMealPlanningSnapshot()` (→
`prepareRecipeCatalogRead`) while the recipe/cooking routes used
`resolveRecipeAuthority()`. Under `static`/`shadow`, `GET /recipes` served 71
recipes while the planner planned from 500; planner→swap→shopping accepted
recipes that recipe detail/cooking 404'd. A second defect: the planner catalog
fingerprint hashed the whole D1 catalog, so invisible D1-only edits staled
static plans.

Defect state: **fully fixed locally, verified by tests** (see Verification).

# Implementation state

```text
A. planner authority unification        status=VERIFIED_LOCAL   (loadMealPlanningSnapshot takes the authority snapshot; projectPlannerCatalogOnAuthority fences the planner universe)
B. authority-scoped fingerprint         status=VERIFIED_LOCAL   (catalog part hashes only visible recipes/steps/nutrition; stored plans carry authority identity)
C. cross-flow tests                     status=VERIFIED_LOCAL   (recipe API → planner → swap → shopping → cooking for a D1-only recipe; all mode matrix)
D. full D1 release policy               status=VERIFIED_LOCAL   (release-check + deploy.yml: static/shadow/canary{1,2,5,25}/d1; cutover derived; contradictory states rejected)
E. production authority observability   status=CODE_COMPLETE    (public sanitized summary + protected /health/recipe-authority evidence; needs RELEASE_VERIFY_TOKEN secret in production)
F. staged rollout automation            status=CODE_COMPLETE    (workflow runs wait-for-deployed-release → smoke → release-check authority; staging proof skips with notice if STAGING_RELEASE_VERIFY_TOKEN unset)
G. production D1 verification           status=NOT_STARTED      (no production access was used)
H. production rollout                   status=NOT_STARTED      (no deploy, no mode/percent change; production untouched)
```

# Files changed (grouped)

Authority integration
- `src/worker/services/meal-planning.ts` — requires `recipeAuthority(scope)` option; per-operation authority snapshot; stored `authority` identity; `catalog_authority_changed` freshness reason; `CATALOG_AUTHORITY_CHANGED` 409 on swap/shopping; regenerate drops invisible locks and re-stamps authority.
- `src/worker/routes/meal-planning.ts` — route composition installs `resolveRecipeAuthority(c.env, { tenantKey: householdId })`.
- `src/worker/types.ts` — `RELEASE_VERIFY_TOKEN?: string`.
- `src/web/features/planner/presentation.ts` — vi/en labels for `catalog_authority_changed` / `CATALOG_AUTHORITY_CHANGED`.

Planner snapshot
- `packages/db/src/meal-planning-snapshot.ts` — new 4th parameter (authority snapshot); projects catalog/nutrition/steps through the authority; exposes `authority` + `visibleRecipeIds`.
- `packages/db/src/planner-catalog-authority.ts` (new) — `projectPlannerCatalogOnAuthority` (d1: fenced D1 rows; static: static definitions/steps + D1 supplementary facts).
- `packages/domain/src/meal-planning-api.ts` — freshness reason enum + `catalog_authority_changed`.

Shopping boundary
- `packages/recipes/src/shopping-demand.ts` — non-terminating aggregate demand is reported `unresolved` (`UNRESOLVED_PURCHASE_QUANTITY`) instead of throwing; never rounds.

Release workflow
- `scripts/release-check.mjs` — T19B state machine (static/shadow/canary{1,2,5,25}/d1, cutover derived), `verifyRecipeAuthorityEvidence`, `authority` command; `scripts/release-check.d.mts` (new, TS declarations).
- `.github/workflows/deploy.yml` — `d1` dispatch option, `25` percent option, authority-proof steps (production unconditional; staging conditional on `STAGING_RELEASE_VERIFY_TOKEN`), `EXPECTED_RECIPE_CATALOG_MODE` passed to smoke.
- `scripts/post-deploy-smoke.sh` — requires valid `recipeAuthority` summary; mode equality when expected; no fallback while D1 configured.

Observability
- `src/worker/services/recipe-authority-status.ts` (new) — public summary + protected evidence + constant-time token compare.
- `src/worker/routes/health.ts` — `recipeAuthority` in `/health/ready`; protected `/health/recipe-authority` (404 without secret, 401 wrong bearer).

Tests
- New: `tests/integration/t19-recipe-authority-split.test.ts` (10), `tests/integration/t19-planner-authority-persistence.test.ts` (9), `tests/integration/t19-recipe-authority-observability.test.ts` (13), `tests/helpers/recipe-authority-fixtures.ts` (test seam for suites with synthetic D1 rows).
- Updated: `release-check.test.mjs` (117, new state machine + proof), `meal-planning-http` / `meal-planning-presentation-http` / `meal-planning-snapshot` / `t07-*` / `t07-ai` (harness seam or real-authority expectations), `t07-operations` (alternatives-driven swap, empty-authority case, 30s budget), `shopping-hardening` (lossy aggregate → truthful unresolved), `planner-preview-fixtures.mjs` (preview plans from the real catalog, fixture version `t19-planner-v2`).

Docs
- `docs/ai/recipe-catalog/T19_V2_RECIPE_AUTHORITY_CUTOVER.md` (canonical T19 V2 doc), `docs/ai/DECISIONS.md` (ADR-030), `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_BOARD.md`, `docs/ai/HANDOFF.md`, this file.

# Current known invariants (must remain true)

```text
static:         Recipe API = Planner = alternatives = swap = Shopping origin = Cooking = static 71
shadow:         user-visible behavior identical to static; D1 compared off-response only
canary outside: every recipe-dependent flow static (same FNV-1a household bucket + operator cohort as ADR-026)
canary inside:  every recipe-dependent flow verified D1 500
d1:             every recipe-dependent flow verified D1 500
D1 fallback:    Recipe API AND Planner (and swap/shopping/cooking) fall back to static TOGETHER
```

Stored plans record `source_json.data.authority {source, fingerprint, recipeCount}` (version 1 preserved; pre-T19 rows decode without it). Authority-source change ⇒ `catalog_authority_changed` freshness, `CATALOG_AUTHORITY_CHANGED` 409 on swap/shopping, regenerate recovers.

# Test evidence — CURRENT SESSION (exact commands)

```text
pnpm lint                                   → exit 0
pnpm typecheck                              → exit 0 (both tsconfigs)
pnpm check:migrations                       → migration-smoke=ok
pnpm build (GIT_COMMIT=$(git rev-parse HEAD)) → exit 0
pnpm vitest run (full)                      → 567 files / 4294 tests PASS, 0 failed (JSON reporter)
pnpm recipe:import:check                    → releaseId=rel-bd00a4f53fcaeee4 recipes=500 batches=2
git diff --check                            → clean
```

Focused runs during development: `t19-recipe-authority-split` (10), `t19-planner-authority-persistence` (9), `t19-recipe-authority-observability` (13), `release-check.test.mjs` (117), `meal-planning-http` + `t07-operations` + `planner-preview` + affected planner/shopping suites (all green).

Historical (pre-T19, other sessions): CI run `8dc9198` full-suite 4242 tests — NOT current evidence.

# Known failures / debt

- Production D1 identity, migration ledger, live catalog counts, deployed-SHA proof, rollout and rollback: NOT STARTED (needs GitHub `production` Environment approval + Cloudflare credentials; not used in this session).
- `RELEASE_VERIFY_TOKEN` (production + staging Worker secret) and `STAGING_RELEASE_VERIFY_TOKEN` (repo secret) must be provisioned before the new release proof can run.
- Planner alternatives remain the V1 "sorted, first 50" picker; richer Recipe Picker is T20 (not a T19 debt).
- `pnpm audit --prod` (pre-existing): two moderate React Router 6 advisories; no dependency changed.

# Next exact action

```text
NEXT:
1. git fetch origin --prune && git checkout feat/t19-recipe-authority-cutover-v2
2. git rev-parse HEAD   # must equal the final published SHA in the takeover contract below
3. git log --oneline origin/main..HEAD && pnpm vitest run tests/integration/t19-recipe-authority-split.test.ts
4. Hosted CI on the PR must be green; then operator provisioning:
   - RELEASE_VERIFY_TOKEN (>=32 chars) as a Worker secret (staging + production) and repo secret(s)
5. Continue T19 production phase ONLY via the reviewed Deploy workflow:
   shadow → verify (readiness + release-check authority) → canary 1 → 5 → 25 → d1,
   each gate decided by the workflow's machine proof; rollback = redeploy mode=shadow.
```

# Takeover contract

```text
Expected HEAD after fetch: the token/SHA printed in the final safe-stop report
(and `git ls-remote origin feat/t19-recipe-authority-cutover-v2`).
If HEAD differs: STOP and reconcile before continuing.
Production mutations in this session: none.
```
