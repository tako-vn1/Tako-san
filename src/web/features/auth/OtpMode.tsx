import React, { useEffect, useId, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { TurnstileWidget } from '../../components/common/TurnstileWidget';

interface OtpModeProps {
  turnstileSiteKey: string | null;
  turnstileGeneration: number;
  onTurnstileToken: (token: string | null) => void;
  otpDigits: string[];
  otpInputsRef: React.MutableRefObject<(HTMLInputElement | null)[]>;
  onOtpChange: (index: number, value: string) => void;
  onOtpKeyDown: (index: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onOtpPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  transferDeferred: boolean;
  otpPurpose: 'register' | 'forgot_password';
  onContinueWithoutTransfer: () => void;
  onSubmitVerify: (e: React.FormEvent) => void;
  isLoading: boolean;
  isResending: boolean;
  resendCountdown: number;
  onResend: () => void;
  turnstileToken: string | null;
  delivered: boolean | null;
  expiresAt: number | null;
  errorMessage: string | null;
  successMessage: string | null;
}

/** Six-digit verification (screen 03): paste support, no disruptive shaking,
 *  honest transfer-deferred continuation (DEC-012). */
export const OtpMode: React.FC<OtpModeProps> = ({
  turnstileSiteKey,
  turnstileGeneration,
  onTurnstileToken,
  otpDigits,
  otpInputsRef,
  onOtpChange,
  onOtpKeyDown,
  onOtpPaste,
  transferDeferred,
  otpPurpose,
  onContinueWithoutTransfer,
  onSubmitVerify,
  isLoading,
  isResending,
  resendCountdown,
  onResend,
  turnstileToken,
  delivered,
  expiresAt,
  errorMessage,
  successMessage,
}) => {
  const otpGroupId = useId();
  const [expired, setExpired] = useState(() => expiresAt !== null && expiresAt <= Date.now());

  useEffect(() => {
    if (expiresAt === null) {
      setExpired(false);
      return;
    }
    const remaining = expiresAt - Date.now();
    setExpired(remaining <= 0);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const expiryTime =
    expiresAt === null
      ? null
      : new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(expiresAt);

  return (
    <div className="mt-6 space-y-5">
      {turnstileSiteKey && (
        <TurnstileWidget
          key={turnstileGeneration}
          siteKey={turnstileSiteKey}
          onToken={onTurnstileToken}
        />
      )}
      <form onSubmit={onSubmitVerify} className="space-y-4">
        <p id={otpGroupId} className="sr-only">
          Mã OTP 6 chữ số
        </p>
        <div
          className="flex justify-center gap-2"
          role="group"
          aria-labelledby={otpGroupId}
          onPaste={onOtpPaste}
        >
          {otpDigits.map((digit, idx) => (
            <input
              key={idx}
              ref={(el) => (otpInputsRef.current[idx] = el)}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={`Chữ số ${idx + 1} của 6`}
              maxLength={1}
              value={digit}
              onChange={(e) => onOtpChange(idx, e.target.value)}
              onKeyDown={(e) => onOtpKeyDown(idx, e)}
              className="w-11 h-13 text-center font-heading font-bold text-xl bg-white border border-semantic-border focus:border-takosan-green rounded-xl focus:outline-none focus:ring-2 focus:ring-takosan-green/20 transition-tap text-semantic-text-primary shadow-xs"
            />
          ))}
        </div>

        <p
          className="text-center text-xs text-semantic-text-muted"
          data-testid="otp-expiry"
          role="status"
        >
          {delivered === false ? (
            'Chưa có mã đang hoạt động vì email OTP chưa gửi được.'
          ) : (
            <>
              {delivered === null && 'Máy chủ chưa xác nhận trạng thái gửi email. '}
              {expiresAt === null ? (
                'Máy chủ chưa cung cấp thời hạn cho mã này.'
              ) : expired ? (
                'Mã đã hết hạn theo thời hạn máy chủ trả về. Máy chủ vẫn xác nhận kết quả cuối cùng.'
              ) : (
                <>
                  Mã hết hạn lúc{' '}
                  <time dateTime={new Date(expiresAt).toISOString()}>{expiryTime}</time>. Máy chủ xác
                  nhận hiệu lực cuối cùng.
                </>
              )}
            </>
          )}
        </p>

        {transferDeferred && otpPurpose === 'register' ? (
          <div
            role="status"
            data-testid="transfer-deferred"
            className="p-3 bg-semantic-warning-soft border border-semantic-warning/30 text-semantic-warning-strong rounded-xl text-xs space-y-3 animate-fade-in"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-semantic-warning mt-0.5" />
              <p className="leading-relaxed">
                Hiện Takosan chưa thể chuyển dữ liệu trong tủ khách sang tài khoản mới một cách an
                toàn. Bạn vẫn có thể tiếp tục tạo tài khoản: dữ liệu của phiên khách được giữ riêng
                trên hộ khách, không bị xóa và không được chuyển sang tài khoản mới.
              </p>
            </div>
            <Button
              fullWidth
              size="lg"
              type="button"
              isLoading={isLoading}
              onClick={onContinueWithoutTransfer}
            >
              Tiếp tục không chuyển dữ liệu khách
            </Button>
          </div>
        ) : (
          <Button fullWidth size="lg" type="submit" isLoading={isLoading} disabled={isResending}>
            Xác thực & Hoàn tất
          </Button>
        )}

        <div className="flex items-center justify-between text-xs pt-2">
          <span className="text-semantic-text-muted">Chưa nhận được mã?</span>
          <button
            type="button"
            disabled={
              resendCountdown > 0 ||
              isLoading ||
              isResending ||
              Boolean(turnstileSiteKey && !turnstileToken)
            }
            onClick={onResend}
            className="font-semibold text-takosan-green disabled:opacity-40 hover:underline flex items-center gap-1 tap-target cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
            <span>
              {isResending
                ? 'Đang gửi lại mã…'
                : resendCountdown > 0
                  ? `Gửi lại sau (${resendCountdown}s)`
                  : turnstileSiteKey && !turnstileToken
                    ? 'Đang xác minh…'
                    : 'Gửi lại mã OTP'}
            </span>
          </button>
        </div>
      </form>
      {errorMessage && (
        <div
          className="p-3 bg-semantic-danger-soft border border-semantic-danger/30 text-semantic-danger-strong rounded-xl text-xs flex items-center gap-2 animate-fade-in"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 shrink-0 text-semantic-danger" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div
          className="p-3 bg-takosan-mint border border-takosan-mint-deep text-takosan-green-deep rounded-xl text-xs flex items-center gap-2 animate-fade-in"
          role="status"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-takosan-green" />
          <span>{successMessage}</span>
        </div>
      )}
    </div>
  );
};
