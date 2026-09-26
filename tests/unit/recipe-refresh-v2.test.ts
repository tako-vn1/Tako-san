import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNutritionAgreement,
  assertRefreshCatalog,
  assertReleaseExceptions,
  classifyIngredientSemantics,
  compileRefreshCatalog,
  fingerprintRefreshArtifact,
  ingredientConceptKey,
  RefreshRecipeSchema,
  runtimeIngredientFromSource,
  type RefreshRecipe,
} from '../../packages/recipes/src/refresh';

const root = process.cwd();
const dataRoot = path.join(root, 'data', 'recipe-refresh', 'v2');
const artifactRoot = path.join(root, 'artifacts', 'recipe-refresh-v2');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const emptyNutrients = () => ({
  energyKcal: null,
  proteinG: null,
  carbohydrateG: null,
  fatG: null,
  fiberG: null,
  sugarG: null,
  sodiumMg: null,
});

function recipeFixture(): RefreshRecipe {
  return RefreshRecipeSchema.parse({
    schemaVersion: 2,
    recipeVersion: 2,
    identity: { id: 'fixture-1', slug: 'fixture-1', title: 'Fixture' },
    content: {
      description: 'Fixture recipe',
      cuisine: 'vietnamese',
      cookTimeMinutes: 10,
      servings: 2,
      difficulty: 'easy',
      tags: [],
    },
    research: { inputPath: 'fixture.json', rawSchemaSignature: 'fixture', sources: [], notes: [] },
    ingredients: [{
      position: 0,
      sourceName: 'Muối vừa đủ',
      canonicalIngredientId: 'ING_ENR_SALT',
      reconciliation: 'new_reviewed_canonical_id',
      reconciliationReason: 'fixture',
      usageRole: 'qualitative',
      nutritionRole: 'consumed',
      optional: false,
      includeInShopping: true,
      includeInNutrition: false,
      quantity: {
        kind: 'qualitative',
        text: 'vừa đủ',
        gramEquivalent: null,
        basis: null,
        evidence: 'missing',
        runtime: null,
      },
      note: null,
      sourceNutritionPer100g: null,
      sourceNutritionReference: null,
      sourceNutritionNote: null,
    }],
    steps: [{ stepNumber: 1, instruction: 'Nấu theo nguồn.' }],
    nutrition: {
      certification: 'null_truthful',
      profileId: null,
      basis: 'per_serving',
      servings: 2,
      perServing: emptyNutrients(),
      candidatePerServing: emptyNutrients(),
      originalPerServing: emptyNutrients(),
      blockers: [{ code: 'QUALITATIVE_CONSUMED_AMOUNT', ingredientPosition: 0, detail: 'quantity is qualitative' }],
      remediation: [],
    },
    media: { sourceImageUrl: null, legacyRuntimeImageUrl: '/fixture.webp', canonicalStatus: 'source_metadata_only' },
    audit: { schemaRepairs: [], encodingRepairs: [], runtimeExcludedIngredientPositions: [0] },
  });
}

describe('Recipe Content Refresh V2 contracts', () => {
  it('keeps nutrition evidence separate from ingredient identity', () => {
    expect(ingredientConceptKey('Miso trắng')).not.toBe(ingredientConceptKey('Nước tương'));
    expect(ingredientConceptKey('Riềng tươi (galangal)')).not.toBe(ingredientConceptKey('Gừng tươi'));
    expect(ingredientConceptKey('Tỏi (pha nước chấm)')).toBe(ingredientConceptKey('Tỏi'));
    expect(ingredientConceptKey('Hành tím')).not.toBe(ingredientConceptKey('Hành tây'));
    expect(ingredientConceptKey('Me chín')).not.toBe(ingredientConceptKey('Mè rang'));
    expect(ingredientConceptKey('Mẻ')).not.toBe(ingredientConceptKey('Me chín'));
    expect(ingredientConceptKey('Bạc hà (dọc mùng)')).not.toBe(ingredientConceptKey('Bạc hà tươi'));
    expect(ingredientConceptKey('Rượu nấu ăn (Mirin)')).not.toBe(ingredientConceptKey('Rượu nấu ăn'));
  });

  it('classifies salt beds, deep-frying media and mixed process use without counting full quantities as eaten', () => {
    expect(classifyIngredientSemantics({
      name: 'Muối hột (lót đáy nồi)', note: 'môi trường truyền nhiệt, không ăn', basis: '', optional: false, qualitative: false,
    })).toMatchObject({ usageRole: 'process_only', nutritionRole: 'excluded_process', includeInNutrition: false });
    expect(classifyIngredientSemantics({
      name: 'Dầu ăn để chiên ngập', note: 'phần lớn còn lại trong chảo', basis: '', optional: false, qualitative: false,
    })).toMatchObject({ usageRole: 'process_only', nutritionRole: 'unresolved_absorption', includeInNutrition: false });
    expect(classifyIngredientSemantics({
      name: 'Gừng', note: 'một nửa băm ướp, một nửa lót đáy nồi', basis: '', optional: false, qualitative: false,
    })).toMatchObject({ usageRole: 'mixed_process', nutritionRole: 'unresolved_absorption', includeInNutrition: false });
  });

  it('never fabricates runtime quantities for qualitative source rows', async () => {
    const source = recipeFixture();
    const compiled = await compileRefreshCatalog([source]);
    expect(compiled.recipes[0].ingredients).toEqual([]);
    expect(compiled.recipes[0].nutrition).toBeUndefined();
  });

  it('keeps water and estimated process quantities out of the shopping-backed runtime projection', () => {
    const ingredient = recipeFixture().ingredients[0];
    const water = {
      ...ingredient,
      sourceName: 'Nước lọc',
      includeInShopping: false,
      quantity: { kind: 'measured' as const, amount: 500, unit: 'ml', text: '500 ml', gramEquivalent: 500, basis: 'source', evidence: 'source_explicit' as const, runtime: { amount: 500, unit: 'ml' as const } },
    };
    expect(runtimeIngredientFromSource(water)).toBeNull();
    const estimatedFryingOil = {
      ...water,
      sourceName: 'Dầu ăn để chiên ngập',
      usageRole: 'process_only' as const,
      nutritionRole: 'unresolved_absorption' as const,
      includeInShopping: true,
      quantity: { ...water.quantity, amount: 1000, text: 'ước lượng 1 lít', evidence: 'estimated' as const, runtime: { amount: 1, unit: 'l' as const } },
    };
    expect(runtimeIngredientFromSource(estimatedFryingOil)).toBeNull();
  });

  it('rejects invalid runtime units, ingredient IDs and measured quantities', () => {
    const recipe = recipeFixture();
    const measured = {
      ...recipe.ingredients[0],
      canonicalIngredientId: 'invalid-id',
      quantity: {
        kind: 'measured',
        amount: 0,
        unit: 'tbsp',
        text: '1 tbsp',
        gramEquivalent: null,
        basis: null,
        evidence: 'missing',
        runtime: { amount: 1, unit: 'tbsp' },
      },
    };
    expect(() => RefreshRecipeSchema.parse({ ...recipe, ingredients: [measured] })).toThrow();
  });

  it('rejects duplicate IDs, duplicate slugs and broken step numbering', () => {
    const first = recipeFixture();
    const duplicateId = RefreshRecipeSchema.parse({ ...first, identity: { ...first.identity, slug: 'other' } });
    expect(() => assertRefreshCatalog([first, duplicateId])).toThrow(/duplicate recipe ID/);
    const duplicateSlug = RefreshRecipeSchema.parse({ ...first, identity: { ...first.identity, id: 'fixture-2' } });
    expect(() => assertRefreshCatalog([first, duplicateSlug])).toThrow(/duplicate recipe slug/);
    const broken = RefreshRecipeSchema.parse({ ...first, steps: [{ stepNumber: 2, instruction: 'Broken.' }] });
    expect(() => assertRefreshCatalog([broken])).toThrow(/broken step numbering/);
  });

  it('rejects nutrition disagreement and unknown release exceptions', () => {
    const recipe = recipeFixture();
    expect(() => assertNutritionAgreement(recipe, {
      id: recipe.identity.id,
      slug: recipe.identity.slug,
      title: recipe.identity.title,
      description: recipe.content.description,
      cuisine: recipe.content.cuisine,
      cookTimeMinutes: recipe.content.cookTimeMinutes,
      servings: recipe.content.servings,
      difficulty: recipe.content.difficulty,
      imageUrl: recipe.media.legacyRuntimeImageUrl,
      nutrition: { calories: 1, proteinG: 1, fatG: 1, carbG: 1 },
      ingredients: [],
      steps: recipe.steps,
      tags: [],
    })).toThrow(/blocked\/null nutrition/);
    expect(() => assertReleaseExceptions(
      [{ code: 'UNKNOWN_EXCEPTION' }],
      new Set(['SOURCE_RELEVANCE_EXCEPTION']),
      { code: 'SOURCE_RELEVANCE_EXCEPTION', recipeId: 'known' },
    )).toThrow(/unknown release exception/);
  });

  it('detects artifact hash ordering/path drift', async () => {
    const first = { path: 'a.json', sha256: 'a'.repeat(64) };
    const second = { path: 'b.json', sha256: 'b'.repeat(64) };
    expect(await fingerprintRefreshArtifact([first, second])).not.toBe(await fingerprintRefreshArtifact([
      first,
      { ...second, sha256: 'c'.repeat(64) },
    ]));
    await expect(fingerprintRefreshArtifact([second, first])).rejects.toThrow(/strictly sorted/);
    await expect(fingerprintRefreshArtifact([{ path: '../escape', sha256: 'a'.repeat(64) }])).rejects.toThrow(/invalid canonical artifact path/);
  });
});

describe('committed Recipe Content Refresh V2 package', () => {
  it('contains the independently audited 500-recipe corpus and reproduces the runtime fingerprint', async () => {
    const manifest = readJson(path.join(dataRoot, 'manifest.json')) as {
      orderedRecipeIds: string[];
      expectedRuntimeFingerprint: string;
      auditSummary: Record<string, unknown>;
    };
    const audit = readJson(path.join(artifactRoot, 'audit-summary.json')) as {
      recipes: number;
      steps: number;
      ingredients: number;
      qualitativeIngredients: number;
      processOnlyIngredients: number;
      nutritionPublishable: number;
      nutritionBlocked: number;
      nutritionNull: number;
      rawStepShapes: { strings: number; titleDescription: number; titleDescriptionRecipes: number };
      rawQuantityShapes: { numeric: number; quantityText: number; nullWithUnit: number; whollyQualitative: number };
    };
    expect(audit).toEqual(manifest.auditSummary);
    expect(audit).toMatchObject({
      recipes: 500,
      steps: 4938,
      ingredients: 6766,
      rawStepShapes: { strings: 34, titleDescription: 27, titleDescriptionRecipes: 3 },
      rawQuantityShapes: { numeric: 6714, quantityText: 30, nullWithUnit: 16, whollyQualitative: 6 },
      nutritionPublishable: 1,
      nutritionBlocked: 288,
      nutritionNull: 211,
    });
    const files = readdirSync(path.join(dataRoot, 'recipes')).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(500);
    const byId = new Map(files.map((name) => {
      const recipe = RefreshRecipeSchema.parse(readJson(path.join(dataRoot, 'recipes', name)));
      return [recipe.identity.id, recipe] as const;
    }));
    const recipes = manifest.orderedRecipeIds.map((id) => byId.get(id)!);
    assertRefreshCatalog(recipes, manifest.orderedRecipeIds);
    const compiled = await compileRefreshCatalog(recipes);
    expect(compiled.recipes.every((recipe) => recipe.ingredients.length > 0)).toBe(true);
    expect(compiled.fingerprint).toBe(manifest.expectedRuntimeFingerprint);
    const drifted = recipes.map((recipe, index) => index === 0
      ? RefreshRecipeSchema.parse({ ...recipe, identity: { ...recipe.identity, title: `${recipe.identity.title} drift` } })
      : recipe);
    expect((await compileRefreshCatalog(drifted)).fingerprint).not.toBe(compiled.fingerprint);
  });

  it('preserves truthful qualitative rows and remediates the confirmed nutrition process defects', () => {
    const qualitative = RefreshRecipeSchema.parse(readJson(path.join(dataRoot, 'recipes', 'imp-389f525ea854b373.json')));
    const qualitativeRows = qualitative.ingredients.filter((ingredient) => ingredient.quantity.kind === 'qualitative');
    expect(qualitativeRows).toHaveLength(6);
    expect(qualitativeRows.every((ingredient) => ingredient.quantity.runtime === null)).toBe(true);

    const saltBed = RefreshRecipeSchema.parse(readJson(path.join(dataRoot, 'recipes', 'vn-hap-01.json')));
    expect(saltBed.ingredients.find((ingredient) => ingredient.sourceName.startsWith('Muối hột (lót đáy'))).toMatchObject({
      usageRole: 'process_only', nutritionRole: 'excluded_process', includeInNutrition: false,
    });
    expect(saltBed.nutrition.originalPerServing.sodiumMg).toBe(51497.78);
    expect(saltBed.nutrition.perServing.sodiumMg).toBeNull();

    const frying = RefreshRecipeSchema.parse(readJson(path.join(dataRoot, 'recipes', 'imp-6eaf6ed6d417c52c.json')));
    expect(frying.ingredients.find((ingredient) => ingredient.sourceName.includes('chiên ngập'))).toMatchObject({
      usageRole: 'process_only', nutritionRole: 'unresolved_absorption', includeInNutrition: false,
    });
    expect(frying.nutrition.originalPerServing.energyKcal).toBe(2994.53);
    expect(frying.nutrition.perServing.energyKcal).toBeNull();
    expect(frying.nutrition.blockers.some((blocker) => blocker.code === 'UNRESOLVED_ABSORPTION')).toBe(true);
  });

  it('keeps approved title corrections and the explicit source exception', () => {
    const pho = RefreshRecipeSchema.parse(readJson(path.join(dataRoot, 'recipes', 'vn-bun-01.json')));
    const squid = RefreshRecipeSchema.parse(readJson(path.join(dataRoot, 'recipes', 'imp-7d38862afc164a8d.json')));
    expect(pho.identity.title).toBe('Phở bò tái lăn Hà Nội');
    expect(squid.identity.title).toBe('Mực xào xì dầu kiểu Hàn');
    const exceptions = readJson(path.join(dataRoot, 'exceptions.json')) as Array<{ code: string; recipeId: string | null }>;
    expect(exceptions).toContainEqual(expect.objectContaining({ code: 'SOURCE_RELEVANCE_EXCEPTION', recipeId: 'imp-0d6c454ae1073ef6' }));
  });
});
