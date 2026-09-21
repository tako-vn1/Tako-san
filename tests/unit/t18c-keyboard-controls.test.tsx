// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MealSlotItem } from '@frigo/domain';
import { ALL_RECIPES } from '@frigo/recipes';
import { MealCard } from '../../src/web/features/week/MealCard';
import { WeekSetupPage } from '../../src/web/pages/WeekSetupPage';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), save: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../../src/web/components/common/TopBar', () => ({ TopBar: () => <h1>Week setup</h1> }));
vi.mock('../../src/web/stores/useWeekStore', () => ({
  useWeekStore: () => ({ setupDraft: {}, updateSetupDraft: mocks.save }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
function button(name: string) {
  const target = [...container.querySelectorAll('button')].find((element) =>
    (element.getAttribute('aria-label') ?? element.textContent?.trim()) === name,
  );
  expect(target, name).toBeDefined();
  expect(target!.tabIndex).toBe(0);
  expect(target!.querySelector('button, a, input')).toBeNull();
  return target!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}

it.each(['PLANNED', 'COOKED', 'EATING_OUT', 'FLEXIBLE'] as const)(
  'Week %s card exposes only actionable native controls',
  async (status) => {
    const primary = vi.fn();
    const swap = vi.fn();
    const slot: MealSlotItem = {
      id: 'slot', dayId: 'day', planId: 'plan', slotType: 'dinner', status,
      date: '2026-09-21', dayOfWeek: 1, recipe: ALL_RECIPES[0], servings: 2,
      source: 'AUTO', availabilityPercent: 100, incrementalCostVnd: 0,
      rescuedExpiringIngredients: [], badges: [], ingredients: [],
    };
    await render(<MealCard slot={slot} onClick={primary} onSwapClick={swap} />);
    const name = status === 'EATING_OUT' ? 'Bữa ăn ngoài'
      : status === 'FLEXIBLE' ? 'Tùy chọn lúc đó' : slot.recipe!.title;
    const hasDetail = status === 'PLANNED' || status === 'COOKED';
    if (hasDetail) {
      expect(button(name).closest('h4')).not.toBeNull();
      await click(name);
    } else {
      expect(container.querySelector('h4 button')).toBeNull();
    }
    expect(primary).toHaveBeenCalledTimes(hasDetail ? 1 : 0);
    expect(swap).not.toHaveBeenCalled();
    if (status !== 'COOKED') {
      await click(status === 'EATING_OUT' ? 'Đổi trạng thái bữa ăn'
        : status === 'FLEXIBLE' ? 'Chọn món' : `Đổi món ${slot.recipe!.title}`);
      expect(swap).toHaveBeenCalledTimes(1);
      expect(primary).toHaveBeenCalledTimes(hasDetail ? 1 : 0);
    }
  },
);

it('Week setup exposes selection state without changing the saved draft contract', async () => {
  await render(<WeekSetupPage />);
  await click('Chọn Toàn bộ các bữa');
  expect(button('Chọn Toàn bộ các bữa').getAttribute('aria-pressed')).toBe('true');
  await click('Tiếp tục');
  await click('Không giới hạn ngân sách');
  expect(button('Không giới hạn ngân sách').getAttribute('aria-checked')).toBe('true');
  await click('Tiếp tục');
  await click('Tiếp tục');
  await click('Ưu tiên: Tiết kiệm chi phí');
  expect(button('Ưu tiên: Tiết kiệm chi phí').getAttribute('aria-pressed')).toBe('true');
  await click('Tiếp tục');
  await click('Chọn 2 lần / tuần');
  expect(button('Chọn 2 lần / tuần').getAttribute('aria-pressed')).toBe('true');
  await click('Tạo thực đơn tuần ngay');
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
    mealSlotsPreset: 'all', budgetTargetVnd: null,
    priorities: ['use_fridge', 'budget'], shoppingFrequency: 'twice',
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/week/generating');
});
