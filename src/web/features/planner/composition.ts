import { useQuery } from '@tanstack/react-query';
import type { MealRole, PickerCuisine } from '../../../../packages/domain/src/meal-composition-api';
import type { MealPlanDto } from '../../../../packages/domain/src/meal-planning-api';
import { queryKeys } from '../../lib/queryKeys';
import { mealCompositionApi } from '../../services/meal-composition';
import type { PlannerLocale } from './copy';

/** Build-time UI gate; the server `MEAL_COMPOSITION_V2_ENABLED` flag stays authoritative. */
export const isMealCompositionEnabled = () => import.meta.env.VITE_MEAL_COMPOSITION_V2_ENABLED === 'true';

export function usePlanCompositions(plan: MealPlanDto | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.mealPlanningCompositions(plan?.id ?? 'none', plan?.revision ?? 0),
    queryFn: () => mealCompositionApi.plan(plan!.id),
    enabled: enabled && !!plan && isMealCompositionEnabled(),
    retry: false,
  });
}

const ROLE_LABELS: Record<PlannerLocale, Record<MealRole, string>> = {
  vi: { main: 'Món chính', side: 'Món phụ', vegetable: 'Món rau', soup: 'Món canh', staple: 'Cơm / tinh bột', dessert: 'Tráng miệng', simple_food: 'Món đơn giản' },
  en: { main: 'Main', side: 'Side', vegetable: 'Vegetable', soup: 'Soup', staple: 'Staple', dessert: 'Dessert', simple_food: 'Simple food' },
};
export const roleLabel = (role: MealRole, locale: PlannerLocale) => ROLE_LABELS[locale][role];

const CUISINE_LABELS: Record<PlannerLocale, Record<PickerCuisine, string>> = {
  vi: { vietnamese: 'Việt Nam', korean: 'Hàn Quốc', japanese: 'Nhật Bản', chinese: 'Trung Hoa', thai: 'Thái Lan', italian: 'Ý' },
  en: { vietnamese: 'Vietnamese', korean: 'Korean', japanese: 'Japanese', chinese: 'Chinese', thai: 'Thai', italian: 'Italian' },
};
export const cuisineLabel = (cuisine: PickerCuisine, locale: PlannerLocale) => CUISINE_LABELS[locale][cuisine];

const SIMPLE_FOOD_EN: Record<string, string> = {
  'sf-steamed-rice': 'Steamed rice', 'sf-boiled-egg': 'Boiled egg', 'sf-sliced-cucumber': 'Sliced cucumber',
  'sf-boiled-water-spinach': 'Boiled water spinach', 'sf-steamed-broccoli': 'Steamed broccoli', 'sf-fresh-milk': 'Fresh milk',
  'sf-bread': 'Bread', 'sf-seasonal-fruit': 'Seasonal fruit', 'sf-yogurt': 'Yogurt',
};
export function componentTitle(item: { kind: string; simpleFoodId?: string | null; id?: string; title: string }, locale: PlannerLocale) {
  const id = item.simpleFoodId ?? (item.kind === 'simple_food' ? item.id : undefined);
  return locale === 'en' && id && SIMPLE_FOOD_EN[id] ? SIMPLE_FOOD_EN[id] : item.title;
}

export const compositionCopy = {
  vi: {
    heading: 'Các món trong bữa', editHint: 'Mọi thay đổi được lưu trên máy chủ ngay khi bạn chọn.', addDish: 'Thêm món',
    complete: 'Hoàn thiện bữa này', build: 'Để Takosan gợi ý cả bữa', swapDish: 'Đổi món', remove: 'Bỏ món', lock: 'Khoá món',
    unlock: 'Mở khoá món', locked: 'Đã khoá', moveUp: 'Chuyển lên', moveDown: 'Chuyển xuống', role: 'Vai trò',
    emptyMeal: 'Bữa này chưa có món nào.', missing: (role: string) => `Bữa này chưa có ${role.toLowerCase()}. Thêm một món?`,
    suggestionTitle: 'Gợi ý của Takosan', suggestionNote: 'Đây chỉ là gợi ý. Bữa ăn chỉ thay đổi khi bạn chấp nhận.',
    accept: 'Dùng gợi ý này', dismiss: 'Bỏ qua', noSuggestion: 'Chưa tìm được món phù hợp với ràng buộc hiện tại.',
    options: 'Phương án bữa ăn', option: 'Phương án', kept: 'Giữ nguyên', added: 'Thêm', removedLabel: 'Sẽ bỏ các món chưa khoá',
    pickerTitle: 'Chọn món', search: 'Tìm món', allRoles: 'Mọi vai trò', loadMore: 'Xem thêm', choose: 'Chọn', close: 'Đóng',
    noResults: 'Không có món phù hợp.', safetyUnknown: 'Chưa xác minh an toàn với hạn chế đã yêu cầu',
    cuisine: 'Ẩm thực', allCuisines: 'Mọi nền ẩm thực', noFilteredResults: 'Không có món nào khớp với bộ lọc hiện tại.',
    clearFilters: 'Xoá bộ lọc',
    cook: 'Nấu món này', detail: 'Xem công thức', noCooking: 'Món đơn giản — không có hướng dẫn nấu.', unavailable: 'Món này không còn trong danh mục hiện tại.',
    covered: 'Đủ nguyên liệu trong tủ', needsShopping: 'Cần mua thêm', unresolved: 'Cần kiểm tra số lượng', notTracked: 'Không theo dõi tồn kho',
    changed: 'Đã cập nhật bữa ăn.', proposalReady: 'Đã có gợi ý. Xem bên dưới.', more: (count: number) => `+${count} món`,
    reasons: {
      USES_INVENTORY: (count: number) => `Dùng ${count} nguyên liệu có sẵn trong tủ.`, EXTRA_INGREDIENTS: (count: number) => `Chỉ cần mua thêm ${count} nguyên liệu.`,
      NO_EXTRA_PURCHASES: () => 'Không cần mua thêm nguyên liệu.', LOCKED_PRESERVED: (count: number) => `Giữ nguyên ${count} món đã khoá.`,
      INGREDIENT_REUSE: (count: number) => `Dùng chung ${count} nguyên liệu giữa các món.`,
    },
    roleAdded: (role: string) => `Thêm ${role.toLowerCase()} cho bữa ăn cân đối.`, roleUnfilled: (role: string) => `Chưa tìm được ${role.toLowerCase()} phù hợp.`,
  },
  en: {
    heading: 'Dishes in this meal', editHint: 'Every change is saved on the server as soon as you choose it.', addDish: 'Add dish',
    complete: 'Complete this meal', build: 'Let Takosan build the meal', swapDish: 'Swap dish', remove: 'Remove dish', lock: 'Lock dish',
    unlock: 'Unlock dish', locked: 'Locked', moveUp: 'Move up', moveDown: 'Move down', role: 'Role',
    emptyMeal: 'This meal has no dishes yet.', missing: (role: string) => `This meal has no ${role.toLowerCase()} component. Add one?`,
    suggestionTitle: 'Takosan suggestion', suggestionNote: 'This is only a suggestion. Your meal changes only if you accept it.',
    accept: 'Use this suggestion', dismiss: 'Dismiss', noSuggestion: 'No suitable dish found under the current constraints.',
    options: 'Meal options', option: 'Option', kept: 'Kept', added: 'Added', removedLabel: 'Unlocked dishes will be replaced',
    pickerTitle: 'Choose a dish', search: 'Search dishes', allRoles: 'All roles', loadMore: 'Load more', choose: 'Choose', close: 'Close',
    noResults: 'No matching dishes.', safetyUnknown: 'Safety not verified for your requested restrictions',
    cuisine: 'Cuisine', allCuisines: 'All cuisines', noFilteredResults: 'No dishes match the current filters.',
    clearFilters: 'Clear filters',
    cook: 'Cook this dish', detail: 'View recipe', noCooking: 'Simple food — no cooking steps.', unavailable: 'This dish is no longer in the current catalog.',
    covered: 'Covered by your fridge', needsShopping: 'Needs shopping', unresolved: 'Quantity needs review', notTracked: 'Not tracked in inventory',
    changed: 'Meal updated.', proposalReady: 'A suggestion is ready below.', more: (count: number) => `+${count} more`,
    reasons: {
      USES_INVENTORY: (count: number) => `Uses ${count} ingredients already in your fridge.`, EXTRA_INGREDIENTS: (count: number) => `Only ${count} additional ingredients needed.`,
      NO_EXTRA_PURCHASES: () => 'No additional ingredients needed.', LOCKED_PRESERVED: (count: number) => `Keeps ${count} locked dishes.`,
      INGREDIENT_REUSE: (count: number) => `Shares ${count} ingredients between dishes.`,
    },
    roleAdded: (role: string) => `${role} added for meal balance.`, roleUnfilled: (role: string) => `No suitable ${role.toLowerCase()} found.`,
  },
} as const;
