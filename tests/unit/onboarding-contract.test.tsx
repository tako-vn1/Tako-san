// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from '../../src/web/pages/OnboardingPage';
import { useAuthStore } from '../../src/web/stores/useAuthStore';

const mocks = vi.hoisted(() => ({ completeOnboarding: vi.fn() }));

vi.mock('../../src/web/services/api', () => ({
  api: { completeOnboarding: mocks.completeOnboarding },
}));

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

describe('screens 04-06 — onboarding contract', () => {
  let root: Root | undefined;
  let host: HTMLDivElement;

  const mount = async (path: string) => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/onboarding/*" element={<OnboardingPage />} />
            <Route path="*" element={<div data-testid="destination" />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  };

  const location = () => host.querySelector('[data-testid="location"]')?.textContent;
  const button = (name: string) =>
    Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes(name)) as
      HTMLButtonElement | undefined;
  const click = async (element: HTMLElement | undefined) => {
    expect(element).toBeDefined();
    await act(async () => element?.click());
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('frigo_user_id', 'user-onboarding');
    localStorage.setItem('frigo_household_id', 'household-onboarding');
    useAuthStore.setState({
      userId: 'user-onboarding',
      householdId: 'household-onboarding',
      isGuest: false,
      isOnboarded: false,
      householdSize: 2,
      spicyLevel: 'medium',
      favoriteCuisines: [],
      dietaryRestrictions: [],
    });
    mocks.completeOnboarding.mockReset();
    mocks.completeOnboarding.mockResolvedValue({ success: true, onboardingCompleted: true });
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host.remove();
    vi.restoreAllMocks();
  });

  it('screen 04 owns only household size and exposes native single-select state', async () => {
    await mount('/onboarding/household');

    expect(location()).toBe('/onboarding/household');
    expect(host.textContent).toContain('Nhà mình thường có bao nhiêu người ăn?');
    expect(host.textContent).not.toContain('Nền ẩm thực yêu thích');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');

    const radios = Array.from(
      host.querySelectorAll<HTMLInputElement>('input[type="radio"][name="household-size"]'),
    );
    expect(radios).toHaveLength(5);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['2']);
    await act(async () => radios[3].click());
    expect(radios[3].checked).toBe(true);
  });

  it('screen 05 owns cuisine and restriction multi-select groups with checked state', async () => {
    await mount('/onboarding/preferences');

    expect(location()).toBe('/onboarding/preferences');
    expect(host.textContent).toContain('Nền ẩm thực yêu thích');
    expect(host.textContent).toContain('Nguyên liệu hoặc món cần tránh');
    expect(host.textContent).not.toContain('Số người thường ăn');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');

    const cuisines = Array.from(
      host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="favorite-cuisines"]'),
    );
    const restrictions = Array.from(
      host.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][name="dietary-restrictions"]',
      ),
    );
    expect(cuisines.map((item) => item.value)).toEqual([
      'vietnamese',
      'korean',
      'japanese',
      'western',
      'chinese',
      'thai',
      'other',
    ]);
    expect(restrictions.map((item) => item.value)).toEqual([
      'beef',
      'seafood',
      'peanuts',
      'spicy',
      'mushroom',
      'onion_garlic',
      'milk',
      'gluten',
      'other',
    ]);
    expect(cuisines.every((item) => !item.checked)).toBe(true);
    await act(async () => cuisines[1].click());
    await act(async () => restrictions[0].click());
    expect(cuisines[1].checked).toBe(true);
    expect(restrictions[0].checked).toBe(true);
  });

  it('next and back change both content and URL while direct navigation selects the URL-owned step', async () => {
    await mount('/onboarding/household');

    await click(button('Tiếp tục'));
    expect(location()).toBe('/onboarding/preferences');
    expect(host.textContent).toContain('Nhà mình thích món gì và cần tránh gì?');

    await click(button('Tiếp tục'));
    expect(location()).toBe('/onboarding/goals');
    expect(host.textContent).toContain('Xem lại sở thích của nhà mình');

    await click(button('Quay lại'));
    expect(location()).toBe('/onboarding/preferences');
    expect(host.textContent).toContain('Nền ẩm thực yêu thích');
  });

  it('screen 06 reviews only persisted preference fields and keeps completion server-authoritative', async () => {
    useAuthStore.setState({ favoriteCuisines: ['vietnamese'] });
    await mount('/onboarding/goals');

    expect(host.querySelector('[data-testid="onboarding-preference-review"]')).toBeTruthy();
    expect(host.querySelector('[name="primary-goal"]')).toBeNull();
    expect(host.textContent).toContain('Quy mô bữa ăn');
    expect(host.textContent).toContain('2 người');
    expect(host.textContent).toContain('Việt Nam');
    expect(host.textContent).toContain('Mức độ cay');
    expect(host.textContent).toContain('Cay vừa');
    expect(host.textContent).toContain('Không có lựa chọn');

    await click(button('Bắt đầu với Takosan'));

    expect(mocks.completeOnboarding).toHaveBeenCalledWith({
      householdSize: 2,
      spicyLevel: 'medium',
      favoriteCuisines: ['vietnamese'],
      dietaryRestrictions: [],
    });
    expect(location()).toBe('/');
    expect(useAuthStore.getState()).toMatchObject({
      isOnboarded: true,
      householdSize: 2,
      favoriteCuisines: ['vietnamese'],
      dietaryRestrictions: [],
    });
  });

  it('does not complete locally when the server response does not confirm completion', async () => {
    mocks.completeOnboarding.mockResolvedValueOnce({
      success: false,
      onboardingCompleted: false,
    });
    await mount('/onboarding/goals');
    await click(button('Bắt đầu với Takosan'));

    expect(location()).toBe('/onboarding/goals');
    expect(useAuthStore.getState().isOnboarded).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Chưa thể lưu sở thích');
  });

  it('preserves western and other cuisine preferences in review and completion', async () => {
    useAuthStore.setState({ favoriteCuisines: ['western', 'other'] });
    await mount('/onboarding/goals');

    expect(host.textContent).toContain('Âu - Mỹ');
    expect(host.textContent).toContain('Khác');
    await click(button('Bắt đầu với Takosan'));
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ favoriteCuisines: ['western', 'other'] }),
    );
  });

  it('keeps an empty cuisine selection empty instead of inventing a default', async () => {
    await mount('/onboarding/goals');

    expect(host.querySelector('[data-testid="onboarding-preference-review"]')?.textContent).toContain(
      'Ẩm thực yêu thíchKhông có lựa chọn',
    );
    await click(button('Bắt đầu với Takosan'));
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ favoriteCuisines: [] }),
    );
  });

  it('preserves the canonical other dietary restriction in review and completion', async () => {
    useAuthStore.setState({ dietaryRestrictions: ['other'] });
    await mount('/onboarding/goals');

    expect(host.querySelector('[data-testid="onboarding-preference-review"]')?.textContent).toContain(
      'Món cần tránhKhác',
    );
    await click(button('Bắt đầu với Takosan'));
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ dietaryRestrictions: ['other'] }),
    );
  });

  it('round-trips persisted preferences outside the selectable chip vocabulary', async () => {
    useAuthStore.setState({
      favoriteCuisines: ['italian'],
      dietaryRestrictions: ['vegetarian'],
    });
    await mount('/onboarding/goals');

    const review = host.querySelector('[data-testid="onboarding-preference-review"]')?.textContent;
    expect(review).toContain('Ẩm thực yêu thíchitalian');
    expect(review).toContain('Món cần tránhvegetarian');
    await click(button('Bắt đầu với Takosan'));
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        favoriteCuisines: ['italian'],
        dietaryRestrictions: ['vegetarian'],
      }),
    );
  });

  it.each([
    ['mild', 'Ít cay'],
    ['medium', 'Cay vừa'],
    ['hot', 'Cay nhiều'],
  ] as const)(
    'preserves stored %s spicy preference independently of the spicy restriction',
    async (spicyLevel, label) => {
      useAuthStore.setState({ spicyLevel, dietaryRestrictions: ['spicy'] });
      await mount('/onboarding/goals');

      expect(host.textContent).toContain(label);
      expect(host.textContent).toContain('Đồ cay');
      await click(button('Bắt đầu với Takosan'));
      expect(mocks.completeOnboarding).toHaveBeenCalledWith(
        expect.objectContaining({ spicyLevel, dietaryRestrictions: ['spicy'] }),
      );
    },
  );

  it('canonicalizes the legacy onboarding entry to screen 04', async () => {
    await mount('/onboarding');
    expect(location()).toBe('/onboarding/household');
    expect(host.textContent).toContain('Nhà mình thường có bao nhiêu người ăn?');
  });
});
