import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Flame, Sparkles, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../components/common/Button';
import { TAKOSAN_BRAND } from '../lib/takosan-brand';
import { isOfflineGuestSession } from '../lib/private-session';
import { api } from '../services/api';
import { useAuthStore } from '../stores/useAuthStore';

const ONBOARDING_PATHS = {
  1: '/onboarding/household',
  2: '/onboarding/preferences',
  3: '/onboarding/goals',
} as const;

const CUISINE_TAGS = [
  { id: 'vietnamese', label: 'Việt Nam' },
  { id: 'korean', label: 'Hàn Quốc' },
  { id: 'japanese', label: 'Nhật Bản' },
  { id: 'western', label: 'Âu - Mỹ' },
  { id: 'chinese', label: 'Trung Hoa' },
  { id: 'thai', label: 'Thái Lan' },
  { id: 'other', label: 'Khác' },
] as const;

const RESTRICTION_TAGS = [
  { id: 'beef', label: 'Thịt bò' },
  { id: 'seafood', label: 'Hải sản' },
  { id: 'peanuts', label: 'Đậu phộng' },
  { id: 'spicy', label: 'Đồ cay' },
  { id: 'mushroom', label: 'Nấm' },
  { id: 'onion_garlic', label: 'Hành tỏi' },
  { id: 'milk', label: 'Sữa' },
  { id: 'gluten', label: 'Gluten' },
  { id: 'other', label: 'Khác' },
] as const;

const SPICY_LABELS = {
  none: 'Không ăn cay',
  mild: 'Ít cay',
  medium: 'Cay vừa',
  hot: 'Cay nhiều',
} as const;

type OnboardingStep = keyof typeof ONBOARDING_PATHS;
type SpicyLevel = keyof typeof SPICY_LABELS;

function supportedSpicyLevel(value: string): SpicyLevel {
  return Object.prototype.hasOwnProperty.call(SPICY_LABELS, value)
    ? (value as SpicyLevel)
    : 'medium';
}

function stepFromPath(pathname: string): OnboardingStep | null {
  const match = (Object.entries(ONBOARDING_PATHS) as Array<[`${OnboardingStep}`, string]>).find(
    ([, path]) => path === pathname,
  );
  return match ? (Number(match[0]) as OnboardingStep) : null;
}

export const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const auth = useAuthStore();
  const step = stepFromPath(pathname);
  const supportedCuisines = new Set<string>(CUISINE_TAGS.map(({ id }) => id));
  const supportedRestrictions = new Set<string>(RESTRICTION_TAGS.map(({ id }) => id));
  const [householdSize, setHouseholdSize] = useState(() =>
    Math.min(5, Math.max(1, auth.householdSize || 2)),
  );
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(() => {
    return auth.favoriteCuisines.filter((value) => supportedCuisines.has(value));
  });
  const [restrictions, setRestrictions] = useState<string[]>(() =>
    auth.dietaryRestrictions.filter((value) => supportedRestrictions.has(value)),
  );
  const spicyLevel = supportedSpicyLevel(auth.spicyLevel);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!step) return <Navigate to={ONBOARDING_PATHS[1]} replace />;

  const toggle = (value: string, values: string[], update: (next: string[]) => void) => {
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const finish = async () => {
    setError(null);
    setIsSaving(true);
    const preferences = {
      householdSize,
      spicyLevel,
      favoriteCuisines: selectedCuisines,
      dietaryRestrictions: restrictions,
    };
    try {
      if (!isOfflineGuestSession()) {
        const result = await api.completeOnboarding(preferences);
        if (!result.success || result.onboardingCompleted !== true) {
          throw new Error('Onboarding completion was not confirmed');
        }
      }
      auth.setOnboardingData(preferences);
      navigate('/', { replace: true });
    } catch {
      setError('Chưa thể lưu sở thích. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-takosan-cream px-5 py-7 text-takosan-navy">
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col">
        <header className="mb-7 flex items-center justify-between">
          <img src={TAKOSAN_BRAND.logos.horizontal} alt="Takosan" className="h-10 w-auto" />
          <span className="rounded-full border border-takosan-mint-deep bg-white px-3 py-1 text-xs font-bold text-takosan-green">
            {step} / 3
          </span>
        </header>

        <div
          className="mb-7 grid grid-cols-3 gap-2"
          role="progressbar"
          aria-label={`Bước ${step} trên 3`}
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={step}
          aria-valuetext={`Bước ${step} trên 3`}
        >
          {[1, 2, 3].map((item) => (
            <span
              key={item}
              aria-hidden="true"
              className={clsx(
                'h-1.5 rounded-full',
                item <= step ? 'bg-takosan-green' : 'bg-semantic-border',
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <section
            className="flex flex-1 flex-col animate-fade-in"
            aria-labelledby="onboarding-household-title"
          >
            <div className="mb-7">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-takosan-green">
                Khẩu phần gia đình
              </p>
              <h1
                id="onboarding-household-title"
                className="font-heading text-3xl font-extrabold leading-tight"
              >
                Nhà mình thường có bao nhiêu người ăn?
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-semantic-text-secondary">
                Takosan dùng số người để tính khẩu phần phù hợp cho mỗi bữa.
              </p>
            </div>

            <fieldset className="mb-8 rounded-3xl border border-takosan-cream-line bg-white p-5 shadow-sm">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-semantic-text-secondary">
                Số người thường ăn
              </legend>
              <div className="mt-3 flex gap-2">
                {[1, 2, 3, 4, 5].map((number) => {
                  const selected = householdSize === number;
                  const label = number === 5 ? '5 người trở lên' : `${number} người`;
                  return (
                    <label key={number} className="min-w-0 flex-1 cursor-pointer">
                      <input
                        className="peer sr-only"
                        type="radio"
                        name="household-size"
                        value={number}
                        checked={selected}
                        onChange={() => setHouseholdSize(number)}
                      />
                      <span
                        className={clsx(
                          'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-3 text-center text-sm font-bold transition-tap peer-focus-visible:ring-2 peer-focus-visible:ring-takosan-green peer-focus-visible:ring-offset-2',
                          selected
                            ? 'border-takosan-green bg-takosan-green text-white shadow-sm'
                            : 'border-semantic-border bg-semantic-background-subtle text-semantic-text-secondary',
                        )}
                      >
                        {selected ? (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Users className="h-4 w-4" aria-hidden="true" />
                        )}
                        <span aria-label={label}>{number === 5 ? '5+' : number}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <Button
              fullWidth
              size="lg"
              type="button"
              onClick={() => navigate(ONBOARDING_PATHS[2])}
              className="mt-auto rounded-2xl"
            >
              Tiếp tục
            </Button>
          </section>
        )}

        {step === 2 && (
          <section
            className="flex flex-1 flex-col animate-fade-in"
            aria-labelledby="onboarding-preferences-title"
          >
            <div className="mb-7">
              <button
                type="button"
                onClick={() => navigate(ONBOARDING_PATHS[1])}
                className="mb-5 text-sm font-semibold text-takosan-green"
              >
                ← Quay lại
              </button>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-takosan-green">
                Gu món & hạn chế
              </p>
              <h1
                id="onboarding-preferences-title"
                className="font-heading text-3xl font-extrabold leading-tight"
              >
                Nhà mình thích món gì và cần tránh gì?
              </h1>
              <p className="mt-2 text-sm text-semantic-text-secondary">
                Chọn nhiều mục nếu phù hợp. Bạn có thể thay đổi trong hồ sơ sau này.
              </p>
            </div>

            <div className="mb-8 space-y-7">
              <fieldset>
                <legend className="mb-3 text-xs font-bold uppercase tracking-wider text-semantic-text-secondary">
                  Nền ẩm thực yêu thích
                </legend>
                <div className="flex flex-wrap gap-2">
                  {CUISINE_TAGS.map((tag) => {
                    const selected = selectedCuisines.includes(tag.id);
                    return (
                      <label key={tag.id} className="cursor-pointer">
                        <input
                          className="peer sr-only"
                          type="checkbox"
                          name="favorite-cuisines"
                          value={tag.id}
                          checked={selected}
                          onChange={() => toggle(tag.id, selectedCuisines, setSelectedCuisines)}
                        />
                        <span
                          className={clsx(
                            'flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2.5 text-xs font-semibold transition-tap peer-focus-visible:ring-2 peer-focus-visible:ring-takosan-green peer-focus-visible:ring-offset-2',
                            selected
                              ? 'border-takosan-green bg-takosan-mint text-takosan-green-deep'
                              : 'border-semantic-border bg-white text-semantic-text-secondary',
                          )}
                        >
                          {tag.label}
                          {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-3 text-xs font-bold uppercase tracking-wider text-semantic-text-secondary">
                  Nguyên liệu hoặc món cần tránh
                </legend>
                <div className="flex flex-wrap gap-2.5">
                  {RESTRICTION_TAGS.map((tag) => {
                    const selected = restrictions.includes(tag.id);
                    return (
                      <label key={tag.id} className="cursor-pointer">
                        <input
                          className="peer sr-only"
                          type="checkbox"
                          name="dietary-restrictions"
                          value={tag.id}
                          checked={selected}
                          onChange={() => toggle(tag.id, restrictions, setRestrictions)}
                        />
                        <span
                          className={clsx(
                            'flex min-h-11 items-center gap-1.5 rounded-2xl border px-4 py-3 text-sm font-semibold transition-tap peer-focus-visible:ring-2 peer-focus-visible:ring-takosan-green peer-focus-visible:ring-offset-2',
                            selected
                              ? 'border-semantic-danger bg-semantic-danger-soft text-semantic-danger-strong'
                              : 'border-semantic-border bg-white text-semantic-text-secondary',
                          )}
                        >
                          {selected && <span aria-hidden="true">×</span>}
                          {tag.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <Button
              fullWidth
              size="lg"
              type="button"
              onClick={() => navigate(ONBOARDING_PATHS[3])}
              className="mt-auto rounded-2xl"
            >
              Tiếp tục
            </Button>
          </section>
        )}

        {step === 3 && (
          <section
            className="flex flex-1 flex-col animate-fade-in"
            aria-labelledby="onboarding-goals-title"
          >
            <div className="mb-7">
              <button
                type="button"
                onClick={() => navigate(ONBOARDING_PATHS[2])}
                className="mb-5 text-sm font-semibold text-takosan-green"
              >
                ← Quay lại
              </button>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-takosan-green">
                Xem lại lựa chọn
              </p>
              <h1
                id="onboarding-goals-title"
                className="font-heading text-3xl font-extrabold leading-tight"
              >
                Xem lại sở thích của nhà mình
              </h1>
              <p className="mt-2 text-sm text-semantic-text-secondary">
                Takosan chỉ lưu các tùy chọn bên dưới sau khi máy chủ xác nhận hoàn tất.
              </p>
            </div>

            <div className="space-y-3" data-testid="onboarding-preference-review">
              <div className="flex items-center gap-4 rounded-3xl border border-semantic-border bg-white p-4 shadow-sm">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-takosan-mint text-takosan-green">
                  <Users className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <strong className="block font-heading text-base">Quy mô bữa ăn</strong>
                  <span className="mt-1 block text-xs text-semantic-text-muted">
                    {householdSize === 5 ? '5 người trở lên' : `${householdSize} người`}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-4 rounded-3xl border border-semantic-border bg-white p-4 shadow-sm">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-takosan-mint text-takosan-green">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <strong className="block font-heading text-base">Ẩm thực yêu thích</strong>
                  <span className="mt-1 block text-xs text-semantic-text-muted">
                    {selectedCuisines.length === 0
                      ? 'Không có lựa chọn'
                      : selectedCuisines
                          .map((value) => CUISINE_TAGS.find(({ id }) => id === value)?.label)
                          .filter(Boolean)
                          .join(', ')}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-4 rounded-3xl border border-semantic-border bg-white p-4 shadow-sm">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-takosan-mint text-takosan-green">
                  <Flame className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <strong className="block font-heading text-base">Mức độ cay</strong>
                  <span className="mt-1 block text-xs text-semantic-text-muted">
                    {SPICY_LABELS[spicyLevel]}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-4 rounded-3xl border border-semantic-border bg-white p-4 shadow-sm">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-takosan-mint text-takosan-green">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <strong className="block font-heading text-base">Món cần tránh</strong>
                  <span className="mt-1 block text-xs text-semantic-text-muted">
                    {restrictions.length === 0
                      ? 'Không có lựa chọn'
                      : restrictions
                          .map((value) => RESTRICTION_TAGS.find(({ id }) => id === value)?.label)
                          .filter(Boolean)
                          .join(', ')}
                  </span>
                </span>
              </div>
            </div>

            <div className="mt-auto pt-7">
              {error && (
                <p
                  role="alert"
                  className="mb-3 rounded-xl border border-semantic-danger/30 bg-semantic-danger-soft p-3 text-sm text-semantic-danger-strong"
                >
                  {error}
                </p>
              )}
              <Button
                fullWidth
                size="lg"
                type="button"
                onClick={() => void finish()}
                isLoading={isSaving}
                className="flex items-center justify-center gap-2 rounded-2xl"
              >
                Bắt đầu với Takosan <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Button>
              <p className="mt-3 text-center text-xs text-semantic-text-muted">
                Sở thích được lưu cho tài khoản này và có thể thay đổi sau.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
};
