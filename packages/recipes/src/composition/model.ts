import {
  MAX_COMPONENTS_PER_MEAL,
  type ComponentProvenance,
  type ComponentTarget,
  type CompositionMode,
  type MealRole,
} from '../../../domain/src/meal-composition-api';

/**
 * T20 Meal Composition domain (ADR-031). One slot → one composition → ordered components.
 * Manual, Assisted and Auto share this model; they differ only in which operation produced a
 * change and in the component provenance recorded. All operations are pure and return a new
 * component list; persistence and authorization live elsewhere.
 */
export interface MealComponent {
  id: string;
  kind: 'recipe' | 'simple_food';
  role: MealRole;
  ordinal: number;
  locked: boolean;
  provenance: ComponentProvenance;
  recipeId: string | null;
  simpleFoodId: string | null;
  createdRevision: number;
  updatedRevision: number;
}

export interface MealComposition {
  slotId: string;
  source: 'v1_projection' | 'v2';
  mode: CompositionMode | null;
  components: MealComponent[];
}

export type CompositionErrorCode = 'COMPONENT_NOT_FOUND' | 'COMPONENT_LIMIT' | 'DUPLICATE_COMPONENT'
  | 'ROLE_NOT_PERMITTED' | 'TARGET_NOT_FOUND' | 'LOCKED_COMPONENT' | 'INVALID_COMPONENT_ID';

export class CompositionDomainError extends Error {
  constructor(readonly code: CompositionErrorCode, message: string) {
    super(message);
    this.name = 'CompositionDomainError';
  }
}

/** Server-resolved facts about a target; `null` means it is not in the trusted universe. */
export interface TargetFacts { permittedRoles: readonly MealRole[] }
export interface CompositionContext {
  resolve(target: ComponentTarget): TargetFacts | null;
  newId(): string;
  /** Revision the mutation will commit (current plan revision + 1). */
  revision: number;
}

export const legacyComponentId = (slotId: string) => `v1.${slotId}`;
export const targetKey = (value: { kind: string; recipeId?: string | null; simpleFoodId?: string | null }) =>
  value.kind === 'recipe' ? `recipe:${value.recipeId}` : `simple_food:${value.simpleFoodId}`;
const targetOf = (component: MealComponent): ComponentTarget => component.kind === 'recipe'
  ? { kind: 'recipe', recipeId: component.recipeId! } : { kind: 'simple_food', simpleFoodId: component.simpleFoodId! };

/**
 * Read-time V1 compatibility: an unedited V1 slot `Dinner → pho-bo` is the one-component
 * composition `main: pho-bo (legacy_v1)`. The stored V1 plan is never rewritten.
 */
export function projectV1Composition(input: {
  slotId: string;
  meal: { source: { kind: 'recipe' | 'family'; id: string } } | null;
  locked: boolean;
  revision: number;
}): MealComposition {
  const components: MealComponent[] = input.meal?.source.kind === 'recipe' ? [{
    id: legacyComponentId(input.slotId), kind: 'recipe', role: 'main', ordinal: 0, locked: input.locked,
    provenance: 'legacy_v1', recipeId: input.meal.source.id, simpleFoodId: null,
    createdRevision: input.revision, updatedRevision: input.revision,
  }] : [];
  return { slotId: input.slotId, source: 'v1_projection', mode: null, components };
}

function component(target: ComponentTarget, fields: Omit<MealComponent, 'kind' | 'recipeId' | 'simpleFoodId'>): MealComponent {
  return target.kind === 'recipe'
    ? { ...fields, kind: 'recipe', recipeId: target.recipeId, simpleFoodId: null }
    : { ...fields, kind: 'simple_food', recipeId: null, simpleFoodId: target.simpleFoodId };
}

function assertTarget(context: CompositionContext, target: ComponentTarget, role: MealRole) {
  const facts = context.resolve(target);
  if (!facts) throw new CompositionDomainError('TARGET_NOT_FOUND', 'Component is not in the trusted catalog');
  if (!facts.permittedRoles.includes(role)) {
    throw new CompositionDomainError('ROLE_NOT_PERMITTED', 'Role is not permitted for this component');
  }
}

function find(composition: MealComposition, componentId: string): MealComponent {
  const found = composition.components.find((item) => item.id === componentId);
  if (!found) throw new CompositionDomainError('COMPONENT_NOT_FOUND', 'Component is not part of this meal');
  return found;
}

/** Renumbers ordinals and enforces the structural invariants every stored composition satisfies. */
export function normalizeComponents(components: readonly MealComponent[]): MealComponent[] {
  if (components.length > MAX_COMPONENTS_PER_MEAL) {
    throw new CompositionDomainError('COMPONENT_LIMIT', `A meal holds at most ${MAX_COMPONENTS_PER_MEAL} components`);
  }
  const keys = components.map(targetKey);
  if (new Set(keys).size !== keys.length) {
    throw new CompositionDomainError('DUPLICATE_COMPONENT', 'The same dish is already part of this meal');
  }
  const ids = components.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new CompositionDomainError('INVALID_COMPONENT_ID', 'Component IDs must be unique');
  return components.map((item, ordinal) => (item.ordinal === ordinal ? item : { ...item, ordinal }));
}

export function addComponent(composition: MealComposition, input: { target: ComponentTarget; role: MealRole; locked: boolean },
  context: CompositionContext): MealComponent[] {
  assertTarget(context, input.target, input.role);
  return normalizeComponents([...composition.components, component(input.target, {
    id: context.newId(), role: input.role, ordinal: composition.components.length, locked: input.locked,
    provenance: 'manual', createdRevision: context.revision, updatedRevision: context.revision,
  })]);
}

export function removeComponent(composition: MealComposition, componentId: string): MealComponent[] {
  find(composition, componentId);
  return normalizeComponents(composition.components.filter((item) => item.id !== componentId));
}

/** Explicit user swap: replaces the dish (keeping identity, order and lock) and records manual provenance. */
export function swapComponent(composition: MealComposition, componentId: string,
  input: { target: ComponentTarget; role?: MealRole }, context: CompositionContext): MealComponent[] {
  const current = find(composition, componentId);
  const role = input.role ?? current.role;
  assertTarget(context, input.target, role);
  return normalizeComponents(composition.components.map((item) => item.id !== componentId ? item : component(input.target, {
    id: item.id, role, ordinal: item.ordinal, locked: item.locked, provenance: 'manual',
    createdRevision: item.createdRevision, updatedRevision: context.revision,
  })));
}

export function updateComponent(composition: MealComposition, componentId: string,
  input: { locked?: boolean; role?: MealRole; ordinal?: number }, context: CompositionContext): MealComponent[] {
  const current = find(composition, componentId);
  if (input.role !== undefined && input.role !== current.role) assertTarget(context, targetOf(current), input.role);
  const updated: MealComponent = { ...current, locked: input.locked ?? current.locked, role: input.role ?? current.role,
    updatedRevision: context.revision };
  const others = composition.components.filter((item) => item.id !== componentId);
  const index = Math.min(input.ordinal ?? composition.components.indexOf(current), others.length);
  return normalizeComponents([...others.slice(0, index), updated, ...others.slice(index)]);
}

/** Manual "save": the complete ordered list. Existing IDs keep provenance unless their dish changed. */
export function replaceComponents(composition: MealComposition,
  input: ReadonlyArray<{ id?: string; target: ComponentTarget; role: MealRole; locked: boolean }>,
  context: CompositionContext): MealComponent[] {
  const next = input.map((entry, ordinal) => {
    assertTarget(context, entry.target, entry.role);
    if (entry.id === undefined) {
      return component(entry.target, { id: context.newId(), role: entry.role, ordinal, locked: entry.locked,
        provenance: 'manual', createdRevision: context.revision, updatedRevision: context.revision });
    }
    const existing = find(composition, entry.id);
    const sameDish = targetKey(existing) === targetKey({ kind: entry.target.kind,
      recipeId: entry.target.kind === 'recipe' ? entry.target.recipeId : null,
      simpleFoodId: entry.target.kind === 'simple_food' ? entry.target.simpleFoodId : null });
    const unchanged = sameDish && existing.role === entry.role && existing.locked === entry.locked && existing.ordinal === ordinal;
    return component(entry.target, { id: existing.id, role: entry.role, ordinal, locked: entry.locked,
      provenance: sameDish ? existing.provenance : 'manual', createdRevision: existing.createdRevision,
      updatedRevision: unchanged ? existing.updatedRevision : context.revision });
  });
  return normalizeComponents(next);
}

export interface GeneratedAddition { target: ComponentTarget; role: MealRole }

/**
 * Applies an Assisted/Auto result. Locked components are carried over byte-for-byte and can never
 * be removed; only listed unlocked components are removed. Additions are unlocked.
 */
export function applyGenerated(composition: MealComposition, input: { removeIds: readonly string[];
  additions: readonly GeneratedAddition[]; provenance: 'assisted' | 'auto' }, context: CompositionContext): MealComponent[] {
  for (const id of input.removeIds) {
    if (find(composition, id).locked) throw new CompositionDomainError('LOCKED_COMPONENT', 'Locked components cannot be regenerated');
  }
  const kept = composition.components.filter((item) => !input.removeIds.includes(item.id));
  const added = input.additions.map((entry, index) => {
    assertTarget(context, entry.target, entry.role);
    return component(entry.target, { id: context.newId(), role: entry.role, ordinal: kept.length + index, locked: false,
      provenance: input.provenance, createdRevision: context.revision, updatedRevision: context.revision });
  });
  const result = normalizeComponents([...kept, ...added]);
  for (const locked of composition.components.filter((item) => item.locked)) {
    const after = result.find((item) => item.id === locked.id);
    if (!after || targetKey(after) !== targetKey(locked) || after.role !== locked.role || !after.locked) {
      throw new CompositionDomainError('LOCKED_COMPONENT', 'Locked component changed during generation');
    }
  }
  return result;
}
