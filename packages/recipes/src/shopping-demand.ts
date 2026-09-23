import { compareIds } from '../../domain/src/availability';
import {
  CanonicalIngredientIdSchema,
  PositiveQuantitySchema,
  StandardUnitSchema,
  UNIT_DEFINITIONS,
} from '../../domain/src/foundation';
import { convertQuantity, Quantity, QuantityRangeError } from '../../domain/src/quantity';
import type { StandardUnit } from '../../domain/src/units';
import {
  normalizeShoppingMealPlan,
  type ShoppingMealPlanSnapshot,
} from './shopping-plan-snapshot';
import type { WeeklyMealPlan } from './planner-types';

export interface PurchaseRequirementSource {
  slotId: string;
  date: string;
  candidateId: string;
  sourceLineIndices: number[];
  shortageType: 'partial' | 'missing' | 'unresolved';
  quantity: number | null;
  unit: StandardUnit;
}
export interface PurchaseRequirement {
  id: string;
  ingredientId: string;
  unit: StandardUnit;
  requiredQuantity: number | null;
  knownRequiredQuantity: number;
  status: 'known' | 'unresolved';
  isOptional: boolean;
  sourceMealSlots: PurchaseRequirementSource[];
  unresolvedCount: number;
}

export function exactShoppingQuantityNumber(quantity: Quantity): number {
  const value = quantity.toNumber();
  if (Quantity.from(value).compare(quantity) !== 0) {
    throw new QuantityRangeError(
      'Shopping quantity cannot be represented exactly at the output boundary',
    );
  }
  return value;
}

/** T04 has already deducted inventory. Never accept initial stock as a second deficit operand. */
export function aggregateShoppingDemand(
  input: ShoppingMealPlanSnapshot | WeeklyMealPlan,
): PurchaseRequirement[] {
  const plan = normalizeShoppingMealPlan(input);
  const groups = new Map<string, { requirement: PurchaseRequirement; quantity: Quantity }>();
  for (const slot of plan.slots) {
    for (const [index, shortage] of slot.shortages.entries()) {
      if (shortage.status === 'satisfied') continue;
      const ingredientId = CanonicalIngredientIdSchema.parse(shortage.ingredientId);
      const unit = StandardUnitSchema.parse(shortage.unit);
      const definition = UNIT_DEFINITIONS[unit];
      const contextual = definition.dimension === 'contextual';
      const targetUnit = definition.baseUnit;
      const id = JSON.stringify([
        ingredientId,
        targetUnit,
        shortage.isOptional,
        contextual ? [slot.id, index] : null,
      ]);
      const unresolved =
        shortage.status === 'unresolved' || shortage.missingQuantity === null || contextual;
      const group = groups.get(id) ?? {
        quantity: Quantity.from(0),
        requirement: {
          id,
          ingredientId,
          unit: targetUnit,
          requiredQuantity: 0,
          knownRequiredQuantity: 0,
          status: 'known',
          isOptional: shortage.isOptional,
          sourceMealSlots: [],
          unresolvedCount: 0,
        } satisfies PurchaseRequirement,
      };
      if (unresolved) {
        group.requirement.status = 'unresolved';
        group.requirement.unresolvedCount++;
      } else {
        const missing = PositiveQuantitySchema.parse(shortage.missingQuantity);
        group.quantity = group.quantity.add(
          convertQuantity(Quantity.from(missing), unit, targetUnit),
        );
      }
      group.requirement.sourceMealSlots.push({
        slotId: slot.id,
        date: slot.date,
        candidateId: slot.ranked.candidate.id,
        sourceLineIndices: [...shortage.sourceLineIndices],
        shortageType: shortage.status,
        quantity: shortage.missingQuantity,
        unit,
      });
      groups.set(id, group);
    }
  }
  return [...groups.values()]
    .map(({ requirement, quantity }) => {
      // Aggregated demand may be a non-terminating rational (e.g. two meals of a 3-serving recipe at
      // 2 servings). Never round at the output boundary: report the requirement as unresolved instead.
      let known: number | null;
      try { known = exactShoppingQuantityNumber(quantity); }
      catch (error) {
        if (!(error instanceof QuantityRangeError)) throw error;
        known = null;
      }
      const representable = known !== null;
      return {
        ...requirement,
        status: representable ? requirement.status : 'unresolved',
        unresolvedCount: representable ? requirement.unresolvedCount : requirement.sourceMealSlots.length,
        knownRequiredQuantity: known ?? 0,
        requiredQuantity: representable && requirement.status === 'known' ? known : null,
        sourceMealSlots: requirement.sourceMealSlots.sort(
          (a, b) =>
            compareIds(a.slotId, b.slotId) ||
            compareIds(JSON.stringify(a.sourceLineIndices), JSON.stringify(b.sourceLineIndices)),
        ),
      } satisfies PurchaseRequirement;
    })
    .sort((a, b) => compareIds(a.id, b.id));
}
