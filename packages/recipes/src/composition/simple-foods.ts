import type { MealRole } from '../../../domain/src/meal-composition-api';
import type { StandardUnit } from '../../../domain/src/units';

/**
 * T20 simple foods: lightweight items that are not recipes and have no cooking workflow. A
 * portion names an explicit per-serving demand on one canonical ingredient; `null` means the
 * item is not tracked by inventory (it never creates or hides a shopping requirement). No
 * nutrition is claimed: none has reviewed evidence.
 */
export interface SimpleFood {
  id: string;
  title: { vi: string; en: string };
  roles: MealRole[];
  portion: { ingredientId: string; quantity: number; unit: StandardUnit } | null;
  prepMinutes: number;
}

export const SIMPLE_FOODS: readonly SimpleFood[] = Object.freeze([
  { id: 'sf-steamed-rice', title: { vi: 'Cơm trắng', en: 'Steamed rice' }, roles: ['staple', 'simple_food'],
    portion: { ingredientId: 'RICE', quantity: 80, unit: 'g' }, prepMinutes: 25 },
  { id: 'sf-boiled-egg', title: { vi: 'Trứng luộc', en: 'Boiled egg' }, roles: ['side', 'simple_food'],
    portion: { ingredientId: 'CHICKEN_EGG', quantity: 1, unit: 'piece' }, prepMinutes: 10 },
  { id: 'sf-sliced-cucumber', title: { vi: 'Dưa leo thái lát', en: 'Sliced cucumber' },
    roles: ['vegetable', 'side', 'simple_food'],
    portion: { ingredientId: 'CUCUMBER', quantity: 0.5, unit: 'piece' }, prepMinutes: 5 },
  { id: 'sf-boiled-water-spinach', title: { vi: 'Rau muống luộc', en: 'Boiled water spinach' },
    roles: ['vegetable', 'simple_food'],
    portion: { ingredientId: 'WATER_SPINACH', quantity: 0.25, unit: 'bunch' }, prepMinutes: 10 },
  { id: 'sf-steamed-broccoli', title: { vi: 'Bông cải xanh hấp', en: 'Steamed broccoli' },
    roles: ['vegetable', 'simple_food'],
    portion: { ingredientId: 'BROCCOLI', quantity: 0.25, unit: 'piece' }, prepMinutes: 10 },
  { id: 'sf-fresh-milk', title: { vi: 'Sữa tươi', en: 'Fresh milk' }, roles: ['simple_food'],
    portion: { ingredientId: 'FRESH_MILK', quantity: 200, unit: 'ml' }, prepMinutes: 0 },
  { id: 'sf-bread', title: { vi: 'Bánh mì', en: 'Bread' }, roles: ['staple', 'simple_food'], portion: null, prepMinutes: 0 },
  { id: 'sf-seasonal-fruit', title: { vi: 'Trái cây theo mùa', en: 'Seasonal fruit' },
    roles: ['dessert', 'simple_food'], portion: null, prepMinutes: 5 },
  { id: 'sf-yogurt', title: { vi: 'Sữa chua', en: 'Yogurt' }, roles: ['dessert', 'simple_food'], portion: null, prepMinutes: 0 },
] satisfies SimpleFood[]);

const BY_ID = new Map(SIMPLE_FOODS.map((food) => [food.id, food]));
export const getSimpleFood = (id: string): SimpleFood | undefined => BY_ID.get(id);
