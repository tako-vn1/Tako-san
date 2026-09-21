import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { TopBar } from '../components/common/TopBar';
import { Button } from '../components/common/Button';
import { VietQRModal } from '../components/payment/VietQRModal';
import { TAKOSAN_BRAND } from '../lib/takosan-brand';
import { capturePrivateSession, onPrivateSessionReset } from '../lib/private-session';
import { billingApi } from '../services/billing';
import type { CreatedPaymentIntent, PlusPlan, PlusPrice } from '../../shared/payment';
import { Check, Sparkles, ArrowRight, LogIn, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';

function planName(plan: PlusPlan): string {
  return plan === 'annual' ? 'Gói 1 Năm' : 'Gói 1 Tháng';
}

function formatPrice(price: PlusPrice): string {
  return `${price.amountVnd.toLocaleString('vi-VN')} ${price.currency}`;
}

export const PlusPaywallPage: React.FC = () => {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);
  const householdId = useAuthStore((s) => s.householdId);
  const isGuest = useAuthStore((s) => s.isGuest);
  const isPlus = useAuthStore((s) => s.isPlus);

  const [plans, setPlans] = useState<PlusPrice[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlusPlan>('annual');
  const [paymentIntent, setPaymentIntent] = useState<CreatedPaymentIntent | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const paymentOwnerRef = useRef('');
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const selectedPlanRef = useRef(selectedPlan);
  selectedPlanRef.current = selectedPlan;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      creatingRef.current = false;
    };
  }, []);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setIsCreating(false);
    creatingRef.current = false;
    setPlans([]);
    setPaymentIntent(null);
    setIsQRModalOpen(false);
  }, [isGuest, userId, householdId]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setIsCreating(false);
    creatingRef.current = false;
    setPaymentIntent(null);
    setIsQRModalOpen(false);
  }, [selectedPlan]);

  useEffect(() => {
    if (isGuest || !userId) return;
    const isCurrent = capturePrivateSession();
    let active = true;
    const unsubscribe = onPrivateSessionReset(() => { active = false; });
    setErrorMsg(null);
    void billingApi.getPlans().then((result) => {
      if (!active || !isCurrent()) return;
      const nextPlans = result.plans.filter((price) => price.plan === 'monthly' || price.plan === 'annual');
      setPlans(nextPlans);
      if (!nextPlans.some((price) => price.plan === selectedPlanRef.current)) {
        setSelectedPlan(nextPlans[0]?.plan ?? 'annual');
      }
    }).catch(() => {
      if (active && isCurrent()) setErrorMsg('Không thể tải bảng giá từ máy chủ. Vui lòng thử lại.');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isGuest, userId, householdId]);

  const selectedPrice = useMemo(
    () => plans.find((price) => price.plan === selectedPlan) ?? null,
    [plans, selectedPlan],
  );

  const handleCreateIntent = async () => {
    if (!selectedPrice || isCreating || creatingRef.current || isGuest || !userId || !householdId) return;
    const requestedPlan = selectedPrice.plan;
    const requestedHouseholdId = householdId;
    const requestGeneration = requestGenerationRef.current;
    const isCurrent = capturePrivateSession();
    let active = true;
    const unsubscribe = onPrivateSessionReset(() => { active = false; });
    creatingRef.current = true;
    setIsCreating(true);
    setErrorMsg(null);
    try {
      const result = await billingApi.createPaymentIntent(selectedPrice.plan);
      if (requestGeneration !== requestGenerationRef.current || !active || !mountedRef.current || !isCurrent() || useAuthStore.getState().userId !== userId || useAuthStore.getState().householdId !== requestedHouseholdId || selectedPlanRef.current !== requestedPlan) return;
      if (result.payment.plan !== requestedPlan) throw new Error('PAYMENT_PLAN_MISMATCH');
      paymentOwnerRef.current = `${userId}:${requestedHouseholdId}`;
      setPaymentIntent(result.payment);
      setIsQRModalOpen(true);
    } catch {
      if (requestGeneration === requestGenerationRef.current && active && isCurrent()) setErrorMsg('Không thể tạo lệnh thanh toán. Vui lòng thử lại.');
    } finally {
      unsubscribe();
      if (requestGeneration === requestGenerationRef.current) {
        creatingRef.current = false;
        if (active && mountedRef.current && isCurrent() && useAuthStore.getState().householdId === requestedHouseholdId && selectedPlanRef.current === requestedPlan) setIsCreating(false);
      }
    }
  };

  const handlePaymentSuccess = () => {
    setIsQRModalOpen(false);
    setPaymentIntent(null);
    navigate('/me');
  };

  if (isGuest) {
    return (
      <div className="min-h-screen bg-semantic-background pb-12">
        <TopBar showBack title="Takosan Plus" />
        <main className="mx-auto w-full max-w-[var(--content-compact)] px-4 pt-8 md:px-6">
          <section className="overflow-hidden rounded-feature border border-semantic-border bg-semantic-surface shadow-card">
            <div className="bg-gradient-to-br from-semantic-action-primary-pressed to-semantic-action-primary-hover px-6 py-7 text-white">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
                <ShieldCheck aria-hidden="true" className="h-6 w-6 text-takosan-yellow" />
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-takosan-yellow">Tài khoản bắt buộc</p>
              <h1 className="mt-2 text-balance font-heading text-2xl font-bold leading-tight text-white">Đăng nhập trước khi chọn gói Plus</h1>
              <p className="mt-3 text-sm leading-relaxed text-white">
                Gói Plus được gắn với tài khoản để quyền lợi không mất khi bạn đổi thiết bị. Dữ liệu phiên khách vẫn được giữ riêng khi bạn đăng nhập.
              </p>
            </div>
            <div className="space-y-3 p-5">
              <Link
                to="/auth?mode=login&returnTo=%2Fplus"
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-takosan-green px-4 py-3 font-heading text-sm font-bold text-white shadow-xs transition hover:bg-takosan-green-deep active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-takosan-green focus-visible:ring-offset-2"
              >
                <LogIn aria-hidden="true" className="h-4 w-4" />
                Đăng nhập để tiếp tục
              </Link>
              <Link
                to="/"
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-semantic-border bg-white px-4 py-3 text-sm font-semibold text-semantic-text-secondary transition hover:bg-semantic-background-subtle active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-border-strong focus-visible:ring-offset-2"
              >
                Quay lại bảng điều khiển
              </Link>
              <p className="text-center text-xs leading-relaxed text-semantic-text-muted">
                Chưa có tài khoản? Bạn có thể đăng ký từ màn hình đăng nhập.
              </p>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-semantic-background pb-12">
      <TopBar showBack title="Nâng cấp Takosan Plus" />
      <div className="mx-auto w-full max-w-[var(--content-compact)] px-4 pt-3 space-y-5 md:px-6">
        <div className="bg-gradient-to-br from-semantic-action-primary-pressed to-semantic-action-primary-hover text-white rounded-card p-5 shadow-card flex items-center justify-between gap-3 overflow-hidden border border-semantic-action-primary/40">
          <div className="space-y-1 max-w-[200px]">
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles className="w-4 h-4 text-takosan-yellow" />
              <span className="text-[10px] font-semibold text-takosan-yellow uppercase tracking-wider">Takosan Plus</span>
            </div>
            <h2 className="font-heading font-bold text-xl leading-tight text-white">
              {isPlus ? 'Bạn là hội viên Plus' : 'Nấu ăn thông minh hơn'}
            </h2>
            <p className="text-xs text-white">
              {isPlus ? 'Gói hội viên đang hoạt động với đầy đủ đặc quyền' : 'Mở khóa toàn bộ tính năng cao cấp cùng AI Chef'}
            </p>
          </div>
          <div className="w-24 h-24 shrink-0 overflow-hidden flex items-center justify-center">
            <img src={TAKOSAN_BRAND.mascot.celebrate} alt="" aria-hidden="true" className="w-full h-full object-contain" />
          </div>
        </div>

        {errorMsg && <p role="alert" className="rounded-xl border border-semantic-danger/20 bg-semantic-danger-soft px-3 py-2 text-sm text-semantic-danger">{errorMsg}</p>}

        <div className="grid grid-cols-2 gap-3" aria-label="Gói Takosan Plus">
          {plans.map((price) => {
            const isSelected = selectedPlan === price.plan;
            return (
              <button
                key={price.plan}
                type="button"
                aria-pressed={isSelected}
                onClick={() => { setSelectedPlan(price.plan); setPaymentIntent(null); setIsQRModalOpen(false); }}
                className={clsx(
                  'text-left rounded-xl p-4 relative shadow-xs cursor-pointer transition-tap active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-t17-focus',
                  isSelected ? 'bg-semantic-surface border-semantic-action-primary ring-1 ring-semantic-action-primary' : 'bg-white border border-semantic-border hover:border-semantic-border-strong',
                )}
              >
                <p className="font-heading font-semibold text-xs text-semantic-text-secondary">{planName(price.plan)}</p>
                <p className="font-heading font-bold text-xl text-semantic-text-primary mt-1">{formatPrice(price)}</p>
              </button>
            );
          })}
        </div>

        <div className="space-y-2 bg-white rounded-xl p-4 border border-semantic-border shadow-xs">
          <h3 className="font-heading font-bold text-sm text-semantic-text-primary mb-2">Quyền lợi thành viên:</h3>
          {[
            'Không giới hạn số lượng nguyên liệu trong tủ lạnh',
            'Không giới hạn lượt quét AI tủ lạnh & hóa đơn siêu thị OCR',
            'Trọn bộ Takosan Planner lập thực đơn tuần tự động',
            'AI Voice Sous Chef trợ lý nấu ăn rảnh tay thông minh',
            'Đầy đủ 6 nền ẩm thực (Việt, Hàn, Nhật, Trung, Thái, Ý)',
            'Gợi ý công thức nâng cao bởi DeepSeek AI Chef',
            'Chia sẻ tủ lạnh gia đình không giới hạn thiết bị',
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-2.5 text-xs text-semantic-text-secondary font-medium py-1">
              <div className="w-5 h-5 rounded-full bg-semantic-success-soft border border-semantic-action-primary/30 flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5 text-semantic-action-primary stroke-[2.5]" /></div>
              <span>{feature}</span>
            </div>
          ))}
        </div>

        <div className="pt-2">
          <Button fullWidth size="lg" disabled={!selectedPrice || isCreating} onClick={() => void handleCreateIntent()} className="flex items-center justify-center gap-2">
            <span>{isCreating ? 'Đang tạo lệnh thanh toán…' : isPlus ? 'Gia hạn hội viên' : selectedPrice ? `Nâng cấp ngay với ${formatPrice(selectedPrice)}` : 'Đang tải bảng giá…'}</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      {paymentIntent && paymentOwnerRef.current === `${userId}:${householdId}` && (
        <VietQRModal
          isOpen={isQRModalOpen}
          onClose={() => { setIsQRModalOpen(false); setPaymentIntent(null); }}
          onSuccess={handlePaymentSuccess}
          intent={paymentIntent}
        />
      )}
    </div>
  );
};
