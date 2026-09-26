# Recipe Content Refresh V2 Audit

## Status

RECIPE_REFRESH_V2_CANONICAL_SOURCE_READY

The canonical source is deterministic and truthful. Nutrition that cannot be certified is null at runtime rather than fabricated. This status certifies the source/compiler package, not a migration or remote rollout.

## ZIP audit

- Input SHA-256: `ebc18f06ee7fb4498f8cd2a7886f333a85b385f32af4407ae1b44b4ec3cc06fe`
- Recipes / unique IDs: 500 / 500
- Steps: 4938 (4904 objects, 34 strings, 27 title/description objects)
- Ingredient lines: 6766; raw numeric quantity 6714, quantity_text 30, null-with-unit 16, wholly qualitative 6
- Root schema variants: 15
- Source references: 1102 (1072 unique URLs)
- ZIP ingredient total is 6,766, not the reported production count 6,720. No data was changed to force reported handoff numbers.

## What was wrong

- The ZIP used 15 root shapes and three step representations instead of one release schema.
- 52 raw ingredient rows lacked numeric `quantity`; only evidence-backed quantity_text rows were parsed, leaving 23 truthful canonical qualitative rows.
- Nutrition counted process media such as 500 g salt beds and deep-frying oil as fully eaten.
- Nutrition references cannot be ingredient identity authority: the same FDC proxy was reused for materially different foods. Identity now uses exact catalog aliases or conservative reviewed name keys.
- The V1 import compiler is INSERT-only and remains unchanged; refresh V2 is a separate source/projection path.

## Repairs

- Schema repair operations: 64; encoding repairs: 0.
- Process-only / mixed-process rows: 166 / 7.
- Ingredient concepts: 1438; reconciliation rows: 2515.
- Reconciliation: existing 505, new reviewed 1642, duplicate aliases 368, ambiguous 0, invalid 0.
- 499/500 recipes have at least two structurally relevant source URLs; the one reviewed exception is explicit and not padded with a fabricated second recipe source.
- Approved titles applied: `vn-bun-01` → “Phở bò tái lăn Hà Nội”; `imp-7d38862afc164a8d` → “Mực xào xì dầu kiểu Hàn”.

## Nutrition

- Original numeric profiles: 289.
- Recomputed candidates: 353.
- Certified publishable: 1; blocked: 288; truthful null: 211.
- Original energy outliers >= 2,000 kcal/serving: 1; sodium outliers >= 10,000 mg/serving: 2. They are quarantined, not clipped.
- `vn-hap-01` no longer publishes 51,497.78 mg sodium/serving from the salt bed. `imp-6eaf6ed6d417c52c` no longer publishes 2,994.53 kcal/serving from 1 L frying oil.
- Blocker classes:
- ESTIMATED_EDIBLE_QUANTITY: 4495
- INCOMPLETE_NUTRIENT_REFERENCE: 420
- UNRESOLVED_ABSORPTION: 168
- MISSING_NUTRIENT_REFERENCE: 17
- QUALITATIVE_CONSUMED_AMOUNT: 14
- MISSING_EDIBLE_QUANTITY: 3

## Canonical package

- Path: `data/recipe-refresh/v2`
- Recipes: 500
- Canonical artifact SHA-256: `fc7eefe6573ee9de1083728db1f34b058954fa60ff478f7c5e41dce9e4570dbe`
- Runtime fingerprint from the real `fingerprintRecipes()`: `6d0e3eb85696bb7c31bc54ac62783bc94432aaf008028eca79b17041f3eaed87`
- Machine-readable audit: `artifacts/recipe-refresh-v2`

## Runtime compatibility

Measured positive quantities already in StandardUnit project directly. Reviewed gram equivalents may project to grams only when the source derivation is explicit and non-estimated. Qualitative rows, unsupported culinary measures, water/non-shopping rows, and estimated process quantities remain source-only. The current planner/inventory/shopping contracts are not made nullable. Process metadata and full cooking-display fidelity remain an explicit architecture gap until a future runtime contract supports them.

## Source spot-check

A bounded online check covered the known source exception, both approved title corrections, the salt-bed defect, the deep-frying defect, and nine referenced FDC IDs. Nine of ten recipe pages returned HTTP 200; one Điện Máy Xanh request timed out and is not classified as dead. All nine FDC IDs returned HTTP 200 with the expected food descriptions through the official API. Keyless normalized API references returned HTTP 403 as expected, and two legacy human-facing FDC page routes returned 404 even though the underlying API IDs are valid. See `artifacts/recipe-refresh-v2/source-spot-check.json`; this mutable-web check is evidence, not part of the canonical content hash.

## Exceptions

- SOURCE_RELEVANCE_EXCEPTION: Only one exact-recipe source; the second source supports chayote preparation only.
- RUNTIME_QUALITATIVE_GAP: Canonical source retains qualitative and unsupported-unit ingredient rows; current RuntimeRecipe projects only positive quantities in StandardUnit.
- NUTRITION_EVIDENCE_BLOCKED: Blocked/null profiles remain intentionally absent from runtime nutrition until edible quantity and all material nutrients are evidenced.

## Findings

- P0: none.
- P1: 288 researched nutrition profiles remain blocked from runtime publication because material edible quantity, absorption/yield, or all seven nutrient values are not sufficiently evidenced.
- P1: 2996 source ingredient rows cannot safely enter the current shopping-backed RuntimeRecipe ingredient shape without invention or semantic loss.
- P2: live URL verification is a separate mutable-web concern; the committed source-quality artifact records structural coverage and the audit report records only bounded spot checks.

## Remote boundary

`staging_mutation=NO`  
`production_mutation=NO`  
`deploy=NO`  
`T20_enablement=NO`
