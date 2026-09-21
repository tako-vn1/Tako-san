import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { api } from '../../services/api';
import { capturePrivateSession, onPrivateSessionReset } from '../../lib/private-session';
import type { CreatedPaymentIntent, PaymentIntent, PaymentStatus } from '../../../shared/payment';
import { Button } from '../common/Button';
import { useModalFocus } from '../../design-system/use-modal-focus';
import { X, Copy, Check, CheckCircle2, ShieldCheck, Clock, QrCode, Sparkles, AlertCircle } from 'lucide-react';

interface VietQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  intent: CreatedPaymentIntent;
  returnFocus?: React.RefObject<HTMLElement>;
}

function statusLabel(status: PaymentStatus): string {
  return {
    pending: 'Đang chờ thanh toán',
    paid: 'Đã xác nhận thanh toán',
    failed: 'Thanh toán thất bại',
    expired: 'Lệnh thanh toán đã hết hạn',
    refunded: 'Thanh toán đã hoàn tiền',
  }[status];
}

function formatTimeLeft(expiresAt: string, now: number): string {
  const remaining = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

type EntitlementState = 'idle' | 'checking' | 'confirmed' | 'unavailable';

function matchesIntent(payment: PaymentIntent, intent: CreatedPaymentIntent): boolean {
  return payment.id === intent.id &&
    payment.orderCode === intent.orderCode &&
    payment.plan === intent.plan &&
    payment.amountVnd === intent.amountVnd &&
    payment.currency === intent.currency;
}

export const VietQRModal: React.FC<VietQRModalProps> = ({ isOpen, onClose, onSuccess, intent, returnFocus }) => {
  const userId = useAuthStore((s) => s.userId);
  const householdId = useAuthStore((s) => s.householdId);
  const setPlusFromServer = useAuthStore((s) => s.setPlusFromServer);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(isOpen, dialogRef, onClose, closeRef, returnFocus);
  const checkRef = useRef<(() => Promise<void>) | null>(null);
  const checkingRef = useRef(false);
  const entitlementCheckedRef = useRef(false);
  const intentIdRef = useRef(intent.id);
  const intentOwnerKeyRef = useRef(`${userId}:${householdId}`);
  if (intentIdRef.current !== intent.id) {
    intentIdRef.current = intent.id;
    intentOwnerKeyRef.current = `${userId}:${householdId}`;
  }
  const [payment, setPayment] = useState<PaymentIntent>(intent);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [entitlementState, setEntitlementState] = useState<EntitlementState>(
    intent.status === 'paid' ? 'checking' : 'idle',
  );
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setPayment(intent);
    setNetworkError(null);
    setEntitlementState(intent.status === 'paid' ? 'checking' : 'idle');
    setSessionInvalid(false);
    entitlementCheckedRef.current = false;
    setNow(Date.now());
  }, [intent]);

  useEffect(() => {
    if (!copiedField) return;
    const timer = window.setTimeout(() => setCopiedField(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [copiedField]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !userId || !householdId || intent.id !== payment.id) return;
    const ownerUserId = userId;
    const ownerHouseholdId = householdId;
    const isCurrent = capturePrivateSession();
    let active = true;
    const valid = () => active && isCurrent() && useAuthStore.getState().userId === ownerUserId && useAuthStore.getState().householdId === ownerHouseholdId;
    const unsubscribe = onPrivateSessionReset(() => {
      active = false;
      setSessionInvalid(true);
      setIsChecking(false);
      checkRef.current = null;
    });

    const checkStatus = async () => {
      if (!valid() || checkRef.current !== checkStatus || checkingRef.current) return;
      checkingRef.current = true;
      setIsChecking(true);
      setNetworkError(null);
      try {
        const result = await api.getPaymentIntent(intent.id);
        if (!valid()) return;
        if (!matchesIntent(result.payment, intent)) {
          setNetworkError('Trạng thái thanh toán không khớp với lệnh này. Vui lòng thử lại.');
          return;
        }
        setPayment(result.payment);
        if (result.payment.status === 'paid' && !entitlementCheckedRef.current) {
          setEntitlementState('checking');
          try {
            const me = await api.getMe({ requireServer: true });
            if (!valid()) return;
            if (me?.user?.id !== ownerUserId) {
              setEntitlementState('unavailable');
              setNetworkError('Không thể xác minh quyền lợi cho phiên tài khoản hiện tại.');
              return;
            }
            const isPlus = me?.user?.isPlus === true;
            setPlusFromServer(isPlus);
            if (isPlus) {
              entitlementCheckedRef.current = true;
              setEntitlementState('confirmed');
              onSuccess();
            } else {
              setEntitlementState('unavailable');
            }
          } catch {
            if (valid()) {
              setEntitlementState('unavailable');
              setNetworkError('Đã nhận thanh toán; chưa thể tải lại quyền lợi Plus. Vui lòng thử lại sau.');
            }
          }
        }
      } catch {
        if (valid()) setNetworkError('Không thể kiểm tra trạng thái với máy chủ. Vui lòng thử lại.');
      } finally {
        if (valid()) setIsChecking(false);
        if (checkRef.current === checkStatus) checkingRef.current = false;
      }
    };

    checkRef.current = checkStatus;
    void checkStatus();
    const poll = window.setInterval(() => { void checkStatus(); }, 5_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(poll);
      window.clearInterval(clock);
      if (checkRef.current === checkStatus) checkingRef.current = false;
      if (checkRef.current === checkStatus) checkRef.current = null;
    };
  }, [householdId, intent.id, isOpen, payment.id, userId]);

  const copyToClipboard = (text: string, fieldKey: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedField(fieldKey);
  };

  if (!isOpen) return null;

  const locallyExpired = payment.status === 'pending' && Date.parse(payment.expiresAt) <= now;
  const visibleStatus: PaymentStatus = locallyExpired ? 'expired' : payment.status;
  const isTerminal = visibleStatus !== 'pending';
  const ownerMismatch = intentOwnerKeyRef.current !== `${userId}:${householdId}`;
  const renderSessionInvalid = sessionInvalid || ownerMismatch;
  const canCheckStatus = visibleStatus === 'pending' || (visibleStatus === 'paid' && entitlementState !== 'confirmed');
  const titleId = `payment-dialog-title-${payment.id}`;
  const instructions = intent.instructions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-slate-200/80 flex flex-col max-h-[92vh] animate-fade-in"
      >
        <div className="p-4 bg-semantic-action-primary-pressed text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-semantic-action-primary flex items-center justify-center text-white"><QrCode className="w-4 h-4" /></div>
            <div>
              <h2 id={titleId} className="font-heading font-bold text-sm leading-tight text-white">Thanh toán VietQR</h2>
              <p role="status" aria-live="polite" aria-atomic="true" className="text-[11px] text-slate-200">{statusLabel(visibleStatus)}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center tap-target transition-colors" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3.5 text-slate-900 bg-slate-50/50">
          {renderSessionInvalid ? (
            <div role="alert" className="py-8 text-center space-y-3"><AlertCircle className="w-10 h-10 mx-auto text-rose-600" /><p className="font-semibold">Phiên tài khoản đã thay đổi. Lệnh này đã được ẩn.</p></div>
          ) : visibleStatus === 'paid' && entitlementState === 'confirmed' ? (
            <div role="status" className="py-8 text-center space-y-3 animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-semantic-success-soft text-semantic-success border border-semantic-action-primary/30 flex items-center justify-center mx-auto shadow-xs"><CheckCircle2 className="w-10 h-10" /></div>
              <div><h3 className="font-heading font-bold text-lg text-slate-900">Thanh toán thành công</h3><p className="text-xs text-slate-600 mt-1">Máy chủ đã xác nhận khoản thanh toán và quyền lợi Plus của tài khoản này.</p></div>
            </div>
          ) : visibleStatus === 'paid' && entitlementState === 'checking' ? (
            <div role="status" className="py-8 text-center space-y-3"><Clock className="w-10 h-10 mx-auto text-amber-600" /><h3 className="font-heading font-bold text-lg">Đã nhận thanh toán; đang kiểm tra quyền lợi</h3><p className="text-xs text-slate-600">Chưa thể xác nhận kích hoạt Plus cho đến khi máy chủ tải lại quyền lợi tài khoản.</p></div>
          ) : visibleStatus === 'paid' ? (
            <div role="status" className="py-8 text-center space-y-3"><AlertCircle className="w-10 h-10 mx-auto text-amber-600" /><h3 className="font-heading font-bold text-lg">Đã nhận thanh toán</h3><p className="text-xs text-slate-600">Máy chủ chưa xác nhận quyền lợi Plus cho tài khoản này. Vui lòng kiểm tra lại sau.</p></div>
          ) : visibleStatus === 'pending' ? (
            <>
              <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs">
                <div className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-amber-500" /><span className="font-heading font-semibold text-xs text-slate-900">{payment.plan === 'annual' ? 'Gói 1 Năm Takosan Plus' : 'Gói 1 Tháng Takosan Plus'}</span></div>
                <div className="flex items-center gap-1 text-xs font-mono font-bold text-amber-700"><Clock className="w-3.5 h-3.5" /><span>{formatTimeLeft(payment.expiresAt, now)}</span></div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs flex flex-col items-center justify-center">
                <img src={instructions.qrImageUrl} alt="Mã VietQR" className="w-52 h-52 object-contain rounded-lg" />
                <p className="text-[11px] text-slate-500 mt-1 font-medium">Mở app ngân hàng để quét mã QR Napas 24/7</p>
              </div>
              <div className="space-y-2 bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs text-xs">
                <div className="flex items-center justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Ngân hàng:</span><span className="font-semibold text-slate-900">{instructions.bankBin}</span></div>
                <div className="flex items-center justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Số tài khoản:</span><button type="button" onClick={() => copyToClipboard(instructions.accountNumber, 'account')} className="font-mono font-bold text-slate-900">{instructions.accountNumber} {copiedField === 'account' ? <Check className="inline w-3.5 h-3.5" /> : <Copy className="inline w-3.5 h-3.5" />}</button></div>
                <div className="flex items-center justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Số tiền:</span><button type="button" onClick={() => copyToClipboard(String(payment.amountVnd), 'amount')} className="font-heading font-bold text-sm text-semantic-action-primary">{payment.amountVnd.toLocaleString('vi-VN')} {payment.currency} {copiedField === 'amount' ? <Check className="inline w-3.5 h-3.5" /> : <Copy className="inline w-3.5 h-3.5" />}</button></div>
                <div className="flex items-center justify-between py-1 border-b border-slate-100"><span className="text-slate-500">Nội dung CK:</span><button type="button" onClick={() => copyToClipboard(instructions.transferContent, 'content')} className="font-mono font-bold text-slate-900 truncate max-w-[190px]">{instructions.transferContent} {copiedField === 'content' ? <Check className="inline w-3.5 h-3.5" /> : <Copy className="inline w-3.5 h-3.5" />}</button></div>
                <div className="flex items-center justify-between py-1"><span className="text-slate-500">Mã đơn:</span><span className="font-mono font-bold text-slate-900">{payment.orderCode}</span></div>
              </div>
            </>
          ) : (
            <div className="py-8 text-center space-y-3"><AlertCircle className="w-10 h-10 mx-auto text-rose-600" /><h3 className="font-heading font-bold text-lg">{statusLabel(visibleStatus)}</h3><p className="text-xs text-slate-600">Không có khoản thanh toán mới nào được xác nhận trong trạng thái này.</p></div>
          )}
        </div>

        {networkError && <p role="alert" className="mx-4 mb-2 rounded-lg bg-rose-50 border border-rose-200/70 px-3 py-2 text-xs text-rose-700">{networkError}</p>}
        {!renderSessionInvalid && canCheckStatus && (
          <div className="p-4 bg-white border-t border-slate-100 space-y-2">
            <Button fullWidth size="lg" disabled={isChecking} onClick={() => void checkRef.current?.()} className="flex items-center justify-center gap-2">
              {isChecking ? 'Đang kiểm tra với máy chủ…' : 'Kiểm tra trạng thái thanh toán'}
            </Button>
          </div>
        )}
        {isTerminal && !renderSessionInvalid && <div className="px-4 pb-4 flex items-center justify-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="w-4 h-4 text-semantic-action-primary" /><span>Trạng thái do máy chủ xác nhận</span></div>}
      </div>
    </div>
  );
};
