# Current takeover receipt - 2026-09-23

**Status: `T19_V2_CODE_COMPLETE_PRODUCTION_BLOCKED`. Production: `UNTOUCHED`.**
Repository ID `1368281478` is `vn-tako4/Frigo-dev`. Application PR #53 merged
normally at `03005fcbc39ab3c964393d2091f726088a4be5d0`; exact-head PR CI
`35810551334` and exact-main CI `35810986000` both PASS (189 files / 4,367 tests).
Integration reviewed head is `dbf32547a07fbc767e044365866a2bdfc4264cd8`; the
original recovery branch remains immutable at `0a04209e512d19293ed56a19d3fd51eb29ffefcd`.

Rechecked after the external merge: main remains `03005fc` and preserves the
exact recovered checkpoint. PR #54 carries this documentation-only handoff;
the application must not be reconstructed or republished as another PR.
Production D1 certification is blocked: this workspace has no Cloudflare API
token and `pnpm wrangler whoami` reports unauthenticated. Earlier takeover
evidence recorded missing GitHub verification secrets. Current repository and
Environment secret/variable listings return HTTP 403, so their present contents
cannot be independently verified here; Worker-side presence remains unverified.
Automatic staging run `35811338820` failed BEFORE deployment on the missing
staging verification secret; its production job was skipped. No deployment,
migration, secret change, rollout or rollback was performed.

See `docs/ai/recipe-catalog/T19_V2_TAKEOVER_AUDIT.md` for evidence and operator
steps. Provision the release prerequisites, certify production read-only, then
use the reviewed rollout workflow and prove rollback. T19 is NOT complete;
T20 remains blocked. Earlier pending/publication-blocked claims below are
historical and superseded by this receipt.

---


# T19 V2 integration handoff (2026-09-22)

# STATUS

```text
T19_V2_APPLICATION_INTEGRATED_CI_PENDING
```

Current truth (freshly verified):

```text
repository ID 1368281478 = vn-tako3/Frigo-dev
origin/main = a3b1564 (integration base)
remote feat/t19-recipe-authority-cutover-v2 = 0a04209 (immutable expected head)
application checkpoint 558be74 = published ancestor of the original branch
active integration branch = feat/t19-recipe-authority-cutover-v2-integration
integration commits = 8205883 (application integration) + 553791a (release-gate hardening checkpoint) + this docs commit
PR #52 = MERGED historical documentation
integration branch publication = BLOCKED (GitHub App token lacks `workflows` permission; see the safe-stop record below)
hosted CI for the integration branch = NOT YET RUN
production = UNTOUCHED
```

The preserved application checkpoint was cherry-picked onto current main; its
later safe-stop documentation was not replayed. The original branch remains
unchanged as a recovery source. Production is untouched and this is not
`T19_COMPLETE`. T20 remains blocked.

# Repository

```text
repository_id=1368281478
repository_full_name=vn-tako3/Frigo-dev
origin_url=https://github.com/vn-tako3/Frigo-dev.git
canonical_main=a3b1564
original_branch=feat/t19-recipe-authority-cutover-v2
original_branch_SHA=0a04209
application_checkpoint=558be74
integration_branch=feat/t19-recipe-authority-cutover-v2-integration
integration_base=a3b1564
integration_application_checkpoint=553791a
original_recovery_branch=feat/t19-recipe-authority-cutover-v2
original_recovery_SHA=0a04209 (remote head token 0a04209e512d19293ed56a19d3fd51eb29ffefcd, unchanged)
```

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

Defect state: **integrated and verified locally; hosted CI pending**.

# Implementation state (safe-stop vocabulary)

```text
A. recipe authority unification    VERIFIED_LOCAL  (planner plans from the same resolveRecipeAuthority snapshot as Recipe API/Week/Shopping/Cooking)
B. authority-scoped fingerprint    VERIFIED_LOCAL  (visible-only catalog/steps/nutrition hashing; hidden D1-only edits cannot stale static plans)
C. stored plan authority identity  VERIFIED_LOCAL  (source+fingerprint+recipeCount; same-source drift typed; CATALOG_AUTHORITY_CHANGED 409; regenerate recovers)
D. cross-flow tests                VERIFIED_LOCAL  (t19 split/persistence/observability suites; all-mode matrix incl. fallback together and authority spoofing)
E. shopping exact-quantity fix     VERIFIED_LOCAL  (non-terminating demand → unresolved/UNRESOLVED_PURCHASE_QUANTITY, never 500, never rounded)
F. full-D1 release policy          VERIFIED_LOCAL  (reviewed states; ref == current main; backwards/stale/skipped/reverse rejected; shadow must prove D1; explicit rollback/bootstrap intent)
G. observability                   VERIFIED_LOCAL  (public summary + protected evidence; canary AND shadow probes exercise D1; production endpoint needs RELEASE_VERIFY_TOKEN, not yet provisioned)
H. integration branch publication  PUBLICATION_BLOCKED (2026-09-23 safe stop: push rejected — GitHub App token lacks `workflows` permission; exact error in the safe-stop record)
I. application PR                  NOT_STARTED
J. hosted CI                       NOT_STARTED
K. merge                           NOT_STARTED
L. production D1 verification      NOT_STARTED
M. production rollout              NOT_STARTED
N. rollback proof (live)           NOT_STARTED (machine proofs + tests are local only; no production rollback was executed)
```

# Files changed (grouped)

Authority integration

- `src/worker/services/meal-planning.ts` — requires `recipeAuthority(scope)` option; per-operation authority snapshot; stored `authority` identity; `catalog_authority_changed` freshness reason; `CATALOG_AUTHORITY_CHANGED` 409 on swap/shopping; regenerate drops invisible locks and re-stamps authority.
  Authority change detection compares source, fingerprint and recipe count (same-source release drift is typed too).
- `src/worker/routes/meal-planning.ts` — route composition installs `resolveRecipeAuthority(c.env, { tenantKey: householdId })`.
- `src/worker/types.ts` — `RELEASE_VERIFY_TOKEN?: string`.
- `src/web/features/planner/presentation.ts` — vi/en labels for `catalog_authority_changed` / `CATALOG_AUTHORITY_CHANGED`.

Planner snapshot

- `packages/db/src/meal-planning-snapshot.ts` — new 4th parameter (authority snapshot); static/shadow/canary-outside read no D1 catalog/nutrition/step rows at all; d1 reads catalog + nutrition enrichment in the same batch and degrades to the authority-only projection if that enrichment fails; exposes `authority` + `visibleRecipeIds`. The unused D1 `recipe_steps` read was removed (steps come from the authority).
- `packages/db/src/planner-catalog-authority.ts` (new) — `projectPlannerCatalogOnAuthority`: recipe definitions and steps always come from the authority snapshot; d1 adds families of visible recipes, classifications, provenance, nutrition and scoped diagnostics; static is authority-only.
- `packages/domain/src/meal-planning-api.ts` — freshness reason enum + `catalog_authority_changed`.

Shopping boundary

- `packages/recipes/src/shopping-demand.ts` — non-terminating aggregate demand is reported `unresolved` (`UNRESOLVED_PURCHASE_QUANTITY`) instead of throwing; never rounds.

Release workflow

- `scripts/release-check.mjs` — reviewed state machine; `validateReleaseSource` requires the ref to equal current `origin/main`; `validateRecipeCatalogTransition` rejects backwards SHAs (ancestry), stale/skipped/reverse promotions, unconfirmed downgrades/bootstraps and requires healthy evidence for every promotion (shadow must prove D1); `verifyRecipeAuthorityEvidence` now checks every stable field (shadow = D1 probe, static = `not_evaluated`); `verifyStableWorkerDeployment`, `verifyWorkerD1Binding`, `verifyRollbackTarget`, `verifyDeployedWorker`, `verifyRecipeCatalogRollback` (new deployment ID + exact version + binding + mutation receipt + complete prior evidence); commands `transition|deployment-snapshot|rollback-target|deployed-binding|rollback|authority`; `scripts/release-check.d.mts` (TS declarations).
- `scripts/d1-migration-check.mjs` — `config` (JSONC `wrangler.jsonc` with duplicate-key rejection, exactly one pinned D1 binding), `catalogQuery()` now returns aggregate + ordered identity statements (exact `orderedRecipeIds`, zero duplicate IDs/slugs, `runtime_order` 0..N-1), approved-batch registry/source/migration provenance + derived `releaseId` check, `runtime-catalog-query`/`runtime-catalog` (Worker reader → hydrator → fingerprint pipeline over remote rows), `release-certify` (complete release + fingerprint expectation + `foreign_key_check` + `quick_check`).
- `scripts/cloudflare-worker-rollback.mjs` (new) — Cloudflare API percentage deployment of the exact previous version; bounded deadline/timeouts; transient retry; one `force=true` retry only for code 10220; token never logged; JSON mutation receipt.
- `.github/workflows/deploy.yml` — reviewed state inputs + rollback checkbox; staging fail-closed proof configuration (`STAGING_URL`, `STAGING_RELEASE_VERIFY_TOKEN`, staging Worker secret) before deploying; production: `config` → identity → schema gate → ledger → catalog/FK/quick_check certification → release-secret + Worker-secret check → current authority → deployment snapshot → `rollback-target` binding proof → transition → deploy → exact-SHA convergence → smoke → `deployed-binding` → authority proof; `(failure() || cancelled()) && preflight succeeded` ⇒ API rollback with full proof; production job guarded by `always() && needs.release.result == 'success'`.
- `.github/workflows/production-d1-migrate.yml` — `config` certification before identity; runtime-content certification when the ledger tip is the complete release.
- `scripts/post-deploy-smoke.sh` — requires valid `recipeAuthority` summary; mode equality when expected; no fallback while D1 configured.

Observability

- `src/worker/services/recipe-authority-status.ts` (new) — public summary + protected evidence + constant-time token compare; canary probes resolve in-cohort and shadow probes resolve through a probe-local D1 configuration, both reporting the configured policy and a truthful fallback.
- `src/worker/routes/health.ts` — `recipeAuthority` in `/health/ready`; protected `/health/recipe-authority` (404 without secret, 401 missing/wrong/non-Bearer token).

Tests

- New: `tests/integration/t19-recipe-authority-split.test.ts` (10), `tests/integration/t19-planner-authority-persistence.test.ts` (18), `tests/integration/t19-recipe-authority-observability.test.ts` (16), `tests/unit/cloudflare-worker-rollback.test.mjs` (10), `tests/helpers/recipe-authority-fixtures.ts` (builds real `Recipe` objects through `createRecipeAuthoritySnapshot`, so synthetic fixtures must satisfy the runtime contract — e.g. cuisine `vietnamese`).
- Updated: `release-check.test.mjs` (155), `d1-migration-check.test.mjs` (32), `meal-planning-http` / `meal-planning-presentation-http` / `meal-planning-snapshot` / `t07-*` / `t07-ai` (authority seam, runtime-contract fixtures), `t07-operations` (enrichment failure keeps the resolved D1 universe and still plans, no SQL leak), `shopping-hardening` (lossy aggregate → truthful unresolved), `recipe-import-output-policy` (CLI case budget 480 s for contended runners), `planner-preview-fixtures.mjs` (preview plans from the real catalog, fixture version `t19-planner-v2`).

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
pnpm vitest run <13 focused files>          → 13 files / 356 tests PASS (before the final hardening pass)
pnpm vitest run tests/unit/release-check.test.mjs
                                             → 155 tests PASS
pnpm vitest run tests/unit/d1-migration-check.test.mjs
                                             → 32 tests PASS
pnpm vitest run tests/unit/cloudflare-worker-rollback.test.mjs
                                             → 10 tests PASS
pnpm vitest run tests/integration/t19-recipe-authority-observability.test.ts
                                             → 16 tests PASS
pnpm vitest run tests/integration/meal-planning-snapshot.test.ts \
  tests/integration/t19-planner-authority-persistence.test.ts
                                             → 23 tests PASS (after removing the D1 recipe_steps read)
pnpm lint                                   → exit 0
pnpm typecheck                              → exit 0 (both tsconfigs)
pnpm check:migrations                       → migration-smoke=ok
pnpm recipe:import:check                    → releaseId=rel-bd00a4f53fcaeee4 recipes=500 batches=2
pnpm build                                  → exit 0
pnpm test (run A, pre-cleanup tree)         → 189 files / 4,364 tests PASS (1,133 s)
pnpm test (run B, final tree)               → 188 files PASS + 1 file with a 5 s contention
                                               timeout: tests/integration/t13-receipt-vision-d1.test.mjs
                                               ("a real D1 observation failure rolls back …" — T13
                                               real-D1/workerd, unrelated to T19; no T19 file failed)
pnpm vitest run tests/integration/t13-receipt-vision-d1.test.mjs
                                             → 22 tests PASS (isolation rerun of the run-B timeout, 7.5 s)
release-certify Wrangler-shaped fixture     → 500 recipes; tip 0037; foreign keys clean; quick_check=ok
git diff --check                            → exit 0
```

The first combined focused run had two five-second timeouts in the 500-recipe
canary-inside/d1 cases. The file passed alone (10/10); those real integration
cases now use a 15-second per-case budget, and the full 13-file focused rerun
passed. No assertion was removed or weakened. Historical sections of the shared
`docs/ai` files were restored to their committed text after an intermediate
formatting pass had rewrapped them (including a `> 200 ms` comparison that
became a blockquote); only the T19 sections changed.

Independent review (two passes) found and this branch fixed: same-source
authority fingerprint drift, incomplete rollback evidence, missing Cloudflare/D1
identity and catalog/integrity certification before deploy, the public canary
readiness probe reporting a fabricated `null` fallback, unfenced D1 families in
the planner projection, shadow promoting without D1 proof, stale older SHAs
redeploying while authority stayed static/shadow, cancellation bypassing
rollback, and staging deploying without verification.

# Known failures / debt

- **Integration branch publication is BLOCKED**: the repository's GitHub App
  credential cannot push commits that create/update workflow files (exact
  error in the safe-stop record). Recovery artifacts are in this workspace.
- Production D1 identity, migration ledger, live catalog counts, deployed-SHA proof, rollout and rollback: NOT STARTED (needs GitHub `production` Environment approval + Cloudflare credentials; not used in this session).
- `RELEASE_VERIFY_TOKEN` (production + staging Worker secret) and `STAGING_RELEASE_VERIFY_TOKEN` (repo secret) must be provisioned before the new release proof can run. Staging is now fail-closed: after merge, the automatic staging job on every main push stops before deploying until those staging secrets exist (production dispatch is unaffected).
- Planner alternatives remain the V1 "sorted, first 50" picker; richer Recipe Picker is T20 (not a T19 debt).
- `pnpm audit --prod` (pre-existing): two moderate React Router 6 advisories; no dependency changed.

# Next exact action

```text
NEXT (takeover, in this exact order):
1. git fetch origin --prune
2. git checkout feat/t19-recipe-authority-cutover-v2-integration
   (absent? restore: git fetch .artifacts/t19-current-safe-stop.bundle
    feat/t19-recipe-authority-cutover-v2-integration, or git am the patch
    from a fresh main checkout; then verify the file list in this handoff)
3. Verify HEAD == the final handoff commit on this branch (application
   checkpoints 8205883 + 553791a plus the docs commit) and origin/main ==
   a3b1564 or a legitimate descendant.
4. Publish with a workflows-capable credential (owner credential or an
   installation granted `workflows`):
     git push origin HEAD:feat/t19-recipe-authority-cutover-v2-integration
   Then verify git ls-remote origin refs/heads/feat/t19-recipe-authority-cutover-v2-integration
   equals local HEAD. Do NOT strip workflow changes or split the branch.
5. Open the application PR (base main, head the integration branch) and wait
   for exact-head hosted CI; fix real findings only, never merge on stale CI.
6. Merge only through normal repository protection; certify exact main.
7. Only then: read-only production D1 identity/ledger/catalog certification,
   RELEASE_VERIFY_TOKEN (+ staging twins) provisioning, GitHub `production`
   Environment approval, staged rollout shadow → canary 1 → 5 → 25 → d1 via
   the reviewed Deploy workflow, representative flows, rollback proof.
8. Do not start T20 until T19_COMPLETE.
```

# Safe-stop publication record (2026-09-23)

Safe stop requested by the owner: no further development, no PR, no rollout.
All valid work is committed locally — application checkpoints `8205883`
(unify recipe authority) and `553791a` (harden release gates and D1
certification) plus this documentation commit. Worktree is clean apart from
gitignored artifacts.

Publication attempt and exact error:

```text
git push origin HEAD:feat/t19-recipe-authority-cutover-v2-integration
  ! [remote rejected] HEAD -> feat/t19-recipe-authority-cutover-v2-integration
  (refusing to allow a GitHub App to create or update workflow
   `.github/workflows/deploy.yml` without `workflows` permission)
```

The active credential is a repository-scoped GitHub App installation token
(repository `1368281478`); it cannot push commits that create or update
workflow files, and rotating the token cannot change the installation's
granted permissions. Per the safe-stop contract the workflow changes were NOT
stripped and no partial branch was created. The immutable original branch
remains published and unchanged at `0a04209` (remote head token
`0a04209e512d19293ed56a19d3fd51eb29ffefcd`).

Portable recovery artifacts (workspace-only; `.artifacts/` is gitignored and
NOT on GitHub — the next account must retain this workspace or publish the
branch before discarding them). Both cover the complete branch history
including this handoff commit; the authoritative SHA-256 values are recorded
in `.artifacts/t19-current-safe-stop.sha256` next to the artifacts (regenerate
with `sha256sum` after any copy):

- `.artifacts/t19-current-safe-stop.bundle` — `git bundle` of the complete
  branch history (`git bundle verify` reports a complete history).
- `.artifacts/t19-current-safe-stop.patch` — `git format-patch
  origin/main..HEAD` of the three integration commits.

Restore path: fetch from the bundle (or `git am` the patch from a fresh main
checkout), then verify HEAD equals the handoff commit and the file inventory
in this handoff. GitHub remains the primary recovery source once a
workflows-capable credential publishes the branch.

# Historical safe-stop takeover contract (completed; retained as evidence)

The following section records the publication-blocked state that PR #52
documented. It is not current: the original branch now exists remotely at the
expected head, and its application checkpoint is the source of this integration.

The remote does NOT contain `feat/t19-recipe-authority-cutover-v2`. The docs
branch `docs/t19-v2-safe-stop-handoff` (PR #52; its remote head advances with
each documentation correction, so verify with `git ls-remote`) is documentation
only and does NOT carry the application implementation.

Portable artifacts:

- `.artifacts/t19-v2-safe-stop.bundle` — `git bundle` of the full application
  branch (SHA-256 `2c7c758f179ef861fafbe33c329e2ddaf2137fdf78b7b800701ee399902a60d8` as printed by `sha256sum`; ~350 MB)
- `.artifacts/t19-v2-safe-stop.patch` — `git format-patch origin/main..HEAD`
  of the application branch (SHA-256 `22101084e71ab8b49bbd334d644d50eb2926e86334e8fa62a9ac5c93bbafda73`)

These artifacts exist ONLY in the original authoring workspace
(`.artifacts/` is gitignored) and are NOT on GitHub. Account takeover is safe
ONLY if the original workspace is retained or the artifacts are explicitly
transferred out of it. The documentation on GitHub is a map, not the
implementation: re-implementing the application code from these documents is a
lossy substitute and is NOT an equivalent recovery.

```text
NEXT (in this exact order):
A. Obtain the original workspace or an explicit transfer of the portable artifacts.
B. Restore the exact application branch:
   git fetch <artifacts-dir>/t19-v2-safe-stop.bundle feat/t19-recipe-authority-cutover-v2
   git checkout -b feat/t19-recipe-authority-cutover-v2 FETCH_HEAD
   (equivalent: git am < artifacts-dir>/t19-v2-safe-stop.patch from a fresh main branch)
C. Verify the expected commit/tree: HEAD token 0a04209e512d19293ed56a19d3fd51eb29ffefcd;
   git log --oneline origin/main..HEAD shows 3 commits (application checkpoint,
   safe-stop handoff, publication-blocker note); git status clean;
   spot-check the file list in this handoff.
D. Publish the branch: git push origin HEAD:feat/t19-recipe-authority-cutover-v2
   (requires a credential with effective capability to publish
   workflow-changing commits; the authoring credential did not have it).
E. Verify the remote: git ls-remote origin refs/heads/feat/t19-recipe-authority-cutover-v2
   must equal the local HEAD.
F. Only then create the application PR, let hosted CI run, and continue T19
   release work (RELEASE_VERIFY_TOKEN provisioning, staged rollout via the
   reviewed Deploy workflow: shadow -> verify -> canary 1 -> 5 -> 25 -> d1).
```

If a restored HEAD differs from `0a04209e512d19293ed56a19d3fd51eb29ffefcd` (token): STOP and
reconcile before continuing. Production mutations in this session: **none**.
