import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { api } from '../services/api';
import { isInventoryTransferDeferred } from '../services/auth';
import { isOffline } from '../services/http';
import { capturePrivateSession } from '../lib/private-session';
import { Slide } from '../design-system/motion';
import { apiErrorMessage, type AuthMode } from '../features/auth/auth-shared';
import { AuthShell } from '../features/auth/AuthShell';
import { LoginMode } from '../features/auth/LoginMode';
import { RegisterMode } from '../features/auth/RegisterMode';
import { OtpMode } from '../features/auth/OtpMode';
import { VerifyUnavailable } from '../features/auth/VerifyUnavailable';
import { ForgotPasswordMode } from '../features/auth/ForgotPasswordMode';
import {
  clearVerifyContext,
  readVerifyContext,
  resendSecondsRemaining,
  writeVerifyContext,
} from '../features/auth/verify-context';

export const AUTH_VERIFY_PATH = '/auth/verify';
const EMPTY_OTP = ['', '', '', '', '', ''];
const MAX_OTP_LIFETIME_MINUTES = 24 * 60;

/**
 * Auth state machine (screen 02). Presentation lives in `features/auth/*`;
 * security semantics (Turnstile, GSI, DEC-012 guest transfer, private-session
 * capture) stay here, byte-compatible with the previous monolith.
 *
 * Screen 03 lives at `/auth/verify`: the OTP state is the route, not a hidden
 * mode. A tab-scoped verification context (email, delivery, resend cooldown —
 * never the code) lets refresh/back recover; without it the route says so.
 */
export const AuthPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isVerifyRoute = pathname === AUTH_VERIFY_PATH;
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get('mode');
  const requestedProvider = searchParams.get('provider');
  const requestedReturnTo = searchParams.get('returnTo');
  const returnTo =
    requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
      ? requestedReturnTo
      : '/';
  const setAuthSession = useAuthStore((state) => state.setAuthSession);
  const identity = useAuthStore((state) => `${state.userId}:${state.householdId}`);

  // Non-route modes; `otp_verify` is derived from the route below.
  const [baseMode, setBaseMode] = useState<Exclude<AuthMode, 'otp_verify'>>(() =>
    requestedMode === 'register' ? 'register' : 'login',
  );
  const mode: AuthMode = isVerifyRoute ? 'otp_verify' : baseMode;
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  // Direct load / refresh of /auth/verify restores the address being verified.
  const [verifyContext, setVerifyContext] = useState(() =>
    isVerifyRoute ? readVerifyContext() : null,
  );
  const [email, setEmail] = useState(() => verifyContext?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password new password
  const [newPassword, setNewPassword] = useState('');

  // OTP State
  const [otpDigits, setOtpDigits] = useState(EMPTY_OTP);
  const [otpPurpose, setOtpPurpose] = useState<'register' | 'forgot_password'>('register');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  // Production responses intentionally omit devOtp; this flag tracks that a
  // reset code was requested so the user can still enter it and set a password.
  const [forgotOtpRequested, setForgotOtpRequested] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(() =>
    resendSecondsRemaining(verifyContext),
  );
  const [isResending, setIsResending] = useState(false);
  // DEC-012: guest data transfer was refused by the server; the guest session
  // stays intact until the user explicitly continues without a transfer.
  const [transferDeferred, setTransferDeferred] = useState(false);
  const verifyRouteActiveRef = useRef(isVerifyRoute);
  const verificationCompletedRef = useRef(false);
  const routeGenerationRef = useRef(0);
  const authPageActiveRef = useRef(true);
  const authRequestGenerationRef = useRef(0);
  const routeScopeRef = useRef(`${identity}:${pathname}`);
  if (routeScopeRef.current !== `${identity}:${pathname}`) {
    routeScopeRef.current = `${identity}:${pathname}`;
    routeGenerationRef.current += 1;
  }
  verifyRouteActiveRef.current = isVerifyRoute;

  useEffect(() => {
    verifyRouteActiveRef.current = isVerifyRoute;
    return () => {
      verifyRouteActiveRef.current = false;
    };
  }, [isVerifyRoute]);

  useEffect(() => {
    authPageActiveRef.current = true;
    return () => {
      authPageActiveRef.current = false;
      authRequestGenerationRef.current += 1;
    };
  }, []);

  // SEC-6: account creation is the single user-visible Turnstile boundary.
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null | undefined>(undefined);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileGeneration, setTurnstileGeneration] = useState(0);
  const handleTurnstileToken = useCallback((token: string | null) => setTurnstileToken(token), []);
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>(
    'idle',
  );
  const [googleRetry, setGoogleRetry] = useState(0);

  useEffect(() => {
    api
      .getPublicConfig()
      .then((cfg) => {
        setTurnstileSiteKey(cfg.turnstileSiteKey || null);
        setGoogleClientId(cfg.googleClientId || null);
      })
      .catch(() => {
        setTurnstileSiteKey(null);
        setGoogleClientId(null);
      });
  }, []);

  useEffect(() => {
    if (requestedMode === 'register') setBaseMode('register');
  }, [requestedMode]);

  // Arriving at /auth/verify (direct load, refresh, back/forward) restores the
  // tab-scoped context. A verification whose email was never delivered must
  // say so rather than claim a code is on its way.
  useEffect(() => {
    if (!isVerifyRoute) {
      verificationCompletedRef.current = false;
      setVerifyContext(null);
      setIsLoading(false);
      setIsResending(false);
      return;
    }
    if (verificationCompletedRef.current) return;
    const context = readVerifyContext();
    setVerifyContext(context);
    if (!context) {
      setEmail('');
      setResendCountdown(0);
      setOtpDigits(EMPTY_OTP);
      setDevOtp(null);
      setTransferDeferred(false);
      setErrorMessage(null);
      setSuccessMessage(null);
      return;
    }
    setEmail(context.email);
    setResendCountdown(resendSecondsRemaining(context));
    if (context.delivered === false && resendSecondsRemaining(context) === 0) {
      setErrorMessage((current) => current ?? 'Email OTP chưa gửi được. Hãy bấm gửi lại mã.');
    }
  }, [identity, isVerifyRoute]);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Initialize Google Identity Services after its async script is ready. The
  // browser button is the only production Google auth entry point: it always
  // supplies a signed credential to the server.
  useEffect(() => {
    if (mode !== 'login') {
      setGoogleStatus('idle');
      return;
    }
    if (googleClientId === undefined) {
      setGoogleStatus('loading');
      return;
    }
    if (!googleClientId) {
      setGoogleStatus('unavailable');
      return;
    }
    let active = true;
    let timer: number | undefined;
    let attempts = 0;
    const handleGoogleResponse = async (response: any) => {
      if (!active) return;
      if (typeof response?.credential !== 'string' || response.credential.length === 0) {
        setErrorMessage(
          'Google không trả về thông tin xác thực hợp lệ. Hãy thử lại hoặc dùng email.',
        );
        return;
      }
      const isCurrent = capturePrivateSession();
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await api.loginWithGoogle(response.credential);
        if (!active || !isCurrent()) return;
        if (res.success && res.user) {
          setAuthSession({
            id: res.user.id,
            email: res.user.email,
            displayName: res.user.displayName,
            avatarUrl: res.user.avatarUrl,
            householdId: res.user.householdId,
          });
          navigate(res.user.onboardingCompleted ? returnTo : '/onboarding', { replace: true });
        } else {
          setErrorMessage('Không thể xác thực tài khoản Google.');
        }
      } catch (err: any) {
        setErrorMessage(
          apiErrorMessage(err, 'Đăng nhập Google thất bại. Hãy thử lại hoặc dùng email.'),
        );
      } finally {
        setIsLoading(false);
      }
    };

    const initializeGoogle = () => {
      if (!active) return;
      const googleId = window.google?.accounts?.id;
      if (!googleId) {
        attempts += 1;
        if (attempts < 40) {
          timer = window.setTimeout(initializeGoogle, 250);
          return;
        }
        setGoogleStatus('unavailable');
        return;
      }
      try {
        setGoogleStatus('ready');
        googleId.initialize({
          client_id: googleClientId,
          callback: handleGoogleResponse,
          auto_select: false,
        });

        if (googleBtnRef.current && active) {
          googleBtnRef.current.replaceChildren();
          const measuredWidth = Math.floor(googleBtnRef.current.getBoundingClientRect().width);
          const buttonWidth = Math.min(400, Math.max(200, measuredWidth || 320));
          googleId.renderButton(googleBtnRef.current, {
            theme: 'outline',
            size: 'large',
            width: buttonWidth,
            text: 'continue_with',
            shape: 'pill',
            locale: 'vi',
          });
          if (requestedProvider === 'google') {
            googleBtnRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
      } catch (e) {
        console.warn('Google Sign-In init error:', e);
        setGoogleStatus('unavailable');
      }
    };

    setGoogleStatus('loading');
    initializeGoogle();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [mode, googleRetry, googleClientId, navigate, requestedProvider, setAuthSession]);

  // Resend OTP countdown timer
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  /** Enter screen 03 for `email` (registration purpose). Delivery stays
   *  unknown unless the response can prove whether email was sent. */
  const enterVerification = (
    verificationEmail: string,
    delivered: boolean | null,
    expiresInMinutes?: unknown,
  ) => {
    const now = Date.now();
    const codeAvailable = delivered !== false;
    const cooldown = codeAvailable ? 60 : 0;
    const duration =
      typeof expiresInMinutes === 'number' &&
      Number.isFinite(expiresInMinutes) &&
      expiresInMinutes > 0 &&
      expiresInMinutes <= MAX_OTP_LIFETIME_MINUTES
        ? expiresInMinutes * 60_000
        : null;
    const expiresAt =
      codeAvailable && duration !== null && Number.isFinite(now + duration)
        ? now + duration
        : null;
    const context = writeVerifyContext({
      email: verificationEmail,
      resendAvailableAt: cooldown ? now + cooldown * 1000 : 0,
      expiresAt,
      delivered,
    });
    setVerifyContext(context);
    setOtpPurpose('register');
    setTransferDeferred(false);
    setResendCountdown(cooldown);
    if (!isVerifyRoute) navigate(AUTH_VERIFY_PATH);
  };

  const beginAuthRequest = () => {
    const isCurrentSession = capturePrivateSession();
    const requestGeneration = ++authRequestGenerationRef.current;
    const routeGeneration = routeGenerationRef.current;
    const isLatest = () =>
      authPageActiveRef.current && authRequestGenerationRef.current === requestGeneration;
    return {
      isLatest,
      canApply: () =>
        isLatest() &&
        isCurrentSession() &&
        routeGenerationRef.current === routeGeneration,
    };
  };

  const invalidateAuthRequests = () => {
    authRequestGenerationRef.current += 1;
    setIsLoading(false);
    setTurnstileToken(null);
    setTurnstileGeneration((value) => value + 1);
  };

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Vui lòng nhập đầy đủ email và mật khẩu');
      return;
    }
    const submittedEmail = email;
    const submittedPassword = password;
    const request = beginAuthRequest();
    setIsLoading(true);
    setErrorMessage(null);
    setDevOtp(null);
    setOtpDigits(EMPTY_OTP);

    try {
      const res = await api.login(submittedEmail, submittedPassword);
      if (!request.canApply()) return;
      if (res.success && res.user) {
        setAuthSession({
          id: res.user.id,
          email: res.user.email,
          displayName: res.user.displayName,
          avatarUrl: res.user.avatarUrl,
          householdId: res.user.householdId,
        });
        navigate(res.user.onboardingCompleted ? returnTo : '/onboarding', { replace: true });
      }
    } catch (err: any) {
      if (!request.canApply()) return;
      if (err?.payload?.requireOtp === true) {
        if (typeof err.payload.devOtp === 'string') setDevOtp(err.payload.devOtp);
        const delivered = err.payload.otpDelivered === true;
        enterVerification(submittedEmail, delivered);
        if (delivered) {
          setSuccessMessage('Mã OTP mới đã được gửi đến email của bạn.');
        } else {
          setErrorMessage(
            'Tài khoản chưa xác thực và email OTP chưa gửi được. Hãy bấm gửi lại mã.',
          );
        }
      } else {
        setErrorMessage(apiErrorMessage(err, 'Email hoặc mật khẩu không chính xác'));
      }
    } finally {
      if (request.isLatest()) {
        setIsLoading(false);
      }
    }
  };

  // Handle Register
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setErrorMessage('Vui lòng điền đầy đủ họ tên, email và mật khẩu');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Mật khẩu phải có tối thiểu 6 ký tự');
      return;
    }
    const submittedName = name;
    const submittedEmail = email;
    const submittedPassword = password;
    const submittedTurnstileToken = turnstileToken;
    const request = beginAuthRequest();

    setIsLoading(true);
    setErrorMessage(null);
    setDevOtp(null);
    setOtpDigits(EMPTY_OTP);

    try {
      const res = await api.register(
        submittedName,
        submittedEmail,
        submittedPassword,
        submittedTurnstileToken,
      );
      if (!request.canApply()) return;
      if (res.success) {
        if (res.devOtp) setDevOtp(res.devOtp);
        enterVerification(submittedEmail, res.devOtp ? null : true, res.expiresInMinutes);
        setSuccessMessage(res.message);
      }
    } catch (err: any) {
      if (!request.canApply()) return;
      if (err?.code === 'OTP_DELIVERY_UNAVAILABLE') {
        enterVerification(submittedEmail, false, err?.payload?.expiresInMinutes);
        setSuccessMessage(null);
        setErrorMessage('Tài khoản đã được lưu nhưng email OTP chưa gửi được. Hãy bấm gửi lại mã.');
      } else {
        setErrorMessage(apiErrorMessage(err, 'Đăng ký thất bại. Email có thể đã tồn tại.'));
      }
    } finally {
      if (request.isLatest()) {
        setTurnstileToken(null);
        setTurnstileGeneration((value) => value + 1);
        setIsLoading(false);
      }
    }
  };

  // Handle OTP digit change
  const handleOtpChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean && val !== '') return;

    const newDigits = [...otpDigits];
    newDigits[index] = clean.slice(-1);
    setOtpDigits(newDigits);

    // Auto move focus to next input
    if (clean && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      const newDigits = [...otpDigits];
      for (let i = 0; i < 6; i++) {
        newDigits[i] = pasted[i] || '';
      }
      setOtpDigits(newDigits);
      const nextIndex = Math.min(pasted.length, 5);
      otpInputsRef.current[nextIndex]?.focus();
    }
  };

  // Verify the entered OTP. `transferGuestData` asks the server to move the
  // current guest household into the new account; the server may refuse that
  // (DEC-012) without consuming the OTP, in which case the guest session is left
  // untouched and the user decides whether to continue without a transfer.
  const submitOtpVerification = async (transferGuestData: boolean) => {
    const isCurrent = capturePrivateSession();
    const code = otpDigits.join('');
    if (code.length < 6) {
      setErrorMessage('Vui lòng nhập đủ 6 chữ số mã OTP');
      return;
    }
    const routeGeneration = routeGenerationRef.current;
    const canApply = () =>
      isCurrent() && verifyRouteActiveRef.current && routeGenerationRef.current === routeGeneration;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Guest data migration: only pass the current household when the visitor
      // is actually in a guest session (server validates the hh_guest_ prefix).
      const authState = useAuthStore.getState();
      const guestHouseholdId =
        transferGuestData &&
        otpPurpose === 'register' &&
        authState.isGuest &&
        authState.householdId.startsWith('hh_guest_')
          ? authState.householdId
          : null;
      const res = await api.verifyOtp(email, code, otpPurpose, guestHouseholdId);
      if (!canApply()) return;
      if (res.success) {
        setTransferDeferred(false);
        if (otpPurpose === 'register') {
          verificationCompletedRef.current = true;
          clearVerifyContext();
          setIsLoading(false);
          if (res.user) {
            setAuthSession({
              id: res.user.id,
              email: res.user.email,
              displayName: res.user.displayName,
              avatarUrl: res.user.avatarUrl,
              householdId: res.user.householdId,
            });
          }
          setSuccessMessage('Xác thực tài khoản thành công!');
          const isNewSession = capturePrivateSession();
          setTimeout(() => {
            if (isNewSession()) navigate('/onboarding', { replace: true });
          }, 500);
        } else if (otpPurpose === 'forgot_password') {
          setSuccessMessage('Mã OTP chính xác. Hãy nhập mật khẩu mới.');
          // proceed to new password form
        }
      }
    } catch (err: any) {
      if (transferGuestData && isInventoryTransferDeferred(err)) {
        // Not an OTP failure: the code is still valid and nothing was changed.
        if (canApply()) setTransferDeferred(true);
        return;
      }
      if (canApply()) {
        setErrorMessage(
          isOffline(err)
            ? 'Không thể kết nối máy chủ. Mã OTP chưa được xác nhận; hãy kiểm tra kết nối và thử lại.'
            : apiErrorMessage(err, 'Mã OTP không đúng hoặc đã hết hạn'),
        );
      }
    } finally {
      if (canApply()) setIsLoading(false);
    }
  };

  // Handle OTP Submit
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitOtpVerification(true);
  };

  // Explicit user choice after a deferred transfer: keep the guest data where it
  // is and finish creating the separate account with the same OTP.
  const handleContinueWithoutTransfer = async () => {
    await submitOtpVerification(false);
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (resendCountdown > 0 || isResending) return;
    const isCurrent = capturePrivateSession();
    const routeGeneration = routeGenerationRef.current;
    const canApply = () =>
      isCurrent() && verifyRouteActiveRef.current && routeGenerationRef.current === routeGeneration;
    setIsResending(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await api.resendOtp(email, otpPurpose);
      if (res.success && canApply()) {
        setDevOtp(res.devOtp || null);
        setResendCountdown(60);
        setTransferDeferred(false);
        if (otpPurpose === 'register') {
          enterVerification(email, res.devOtp ? null : true, res.expiresInMinutes);
        }
        setSuccessMessage(res.message);
      }
    } catch (err: any) {
      if (canApply()) {
        if (otpPurpose === 'register' && (isOffline(err) || err?.status >= 500)) {
          const context = writeVerifyContext({
            email,
            resendAvailableAt: 0,
            expiresAt: null,
            delivered: err?.code === 'OTP_DELIVERY_UNAVAILABLE' ? false : null,
          });
          setVerifyContext(context);
          setResendCountdown(0);
          setDevOtp(null);
          setOtpDigits(EMPTY_OTP);
        }
        setErrorMessage(
          isOffline(err)
            ? 'Không thể kết nối máy chủ. Chưa gửi lại mã OTP; hãy kiểm tra kết nối và thử lại.'
            : apiErrorMessage(err, 'Không thể gửi lại OTP'),
        );
      }
    } finally {
      if (canApply()) {
        setIsResending(false);
      }
    }
  };

  // Handle Request Forgot Password OTP
  const handleRequestForgotOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErrorMessage('Vui lòng nhập email của bạn');
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    setDevOtp(null);
    setForgotOtpRequested(false);
    setOtpDigits(['', '', '', '', '', '']);
    try {
      const res = await api.forgotPassword(email);
      if (res.success) {
        if (res.devOtp) setDevOtp(res.devOtp);
        setForgotOtpRequested(true);
        setOtpPurpose('forgot_password');
        setResendCountdown(60);
        setSuccessMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(apiErrorMessage(err, 'Không thể tạo yêu cầu đặt lại mật khẩu lúc này'));
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Reset Password with OTP + New Password
  const handleResetPassword = async (e: React.FormEvent) => {
    const isCurrent = capturePrivateSession();
    e.preventDefault();
    const code = otpDigits.join('');
    if (code.length < 6) {
      setErrorMessage('Vui lòng nhập đủ 6 chữ số mã OTP');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setErrorMessage('Mật khẩu mới phải có tối thiểu 6 ký tự');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.resetPassword(email, code, newPassword);
      if (!isCurrent()) return;
      if (res.success) {
        if (res.user) {
          setAuthSession(res.user);
          navigate(res.user.onboardingCompleted ? '/' : '/onboarding', { replace: true });
          return;
        }
        setSuccessMessage('Đặt lại mật khẩu thành công! Hãy đăng nhập với mật khẩu mới.');
        setPassword(newPassword);
        setDevOtp(null);
        setForgotOtpRequested(false);
        setOtpDigits(EMPTY_OTP);
        setTimeout(() => {
          setBaseMode('login');
          setSuccessMessage(null);
        }, 1500);
      }
    } catch (err: any) {
      setErrorMessage(apiErrorMessage(err, 'Lỗi đặt lại mật khẩu'));
    } finally {
      setIsLoading(false);
    }
  };

  const retryGoogle = () => {
    if (!googleClientId) return;
    document.getElementById('google-identity-services')?.remove();
    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = () => setGoogleStatus('unavailable');
    document.head.appendChild(script);
    setGoogleStatus('loading');
    setGoogleRetry((value) => value + 1);
  };

  const switchMode = (next: 'login' | 'register') => {
    invalidateAuthRequests();
    setBaseMode(next);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const backOutOfVerification = () => {
    if (mode === 'otp_verify') {
      // Abandoning verification: the tab-scoped context goes with it so the
      // route cannot later imply a code is pending.
      clearVerifyContext();
      verificationCompletedRef.current = false;
      setVerifyContext(null);
      routeGenerationRef.current += 1;
      setBaseMode('login');
      setErrorMessage(null);
      setSuccessMessage(null);
      setDevOtp(null);
      setTransferDeferred(false);
      setOtpDigits(EMPTY_OTP);
      navigate('/auth', { replace: true });
    } else if (mode === 'forgot_password') {
      setBaseMode('login');
      setErrorMessage(null);
      setSuccessMessage(null);
      setDevOtp(null);
      setForgotOtpRequested(false);
      setOtpDigits(EMPTY_OTP);
    } else {
      navigate('/landing');
    }
  };

  const startForgotPassword = () => {
    invalidateAuthRequests();
    setBaseMode('forgot_password');
    setErrorMessage(null);
    setSuccessMessage(null);
    setDevOtp(null);
    setForgotOtpRequested(false);
    setOtpDigits(EMPTY_OTP);
  };

  const backToLogin = () => {
    invalidateAuthRequests();
    setBaseMode('login');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // /auth/verify without any verification in progress on this device.
  const verifyContextMissing = isVerifyRoute && verifyContext === null;

  return (
    <AuthShell
      mode={mode}
      email={email}
      errorMessage={errorMessage}
      successMessage={successMessage}
      otpDelivered={verifyContext?.delivered}
      devOtp={devOtp}
      onFillDevOtp={() => setOtpDigits(devOtp ? devOtp.split('') : otpDigits)}
      onBack={backOutOfVerification}
      onModeChange={switchMode}
    >
      {/* Auth-state transition (screen 02): fade + horizontal slide on mode
          change; controlled values live above, so input is never cleared. */}
      <Slide key={mode} direction={mode === 'register' || mode === 'forgot_password' ? 1 : -1}>
        {mode === 'login' && (
          <LoginMode
            googleButtonRef={googleBtnRef}
            googleStatus={googleStatus}
            googleClientId={googleClientId ?? null}
            onRetryGoogle={retryGoogle}
            email={email}
            onEmailChange={setEmail}
            password={password}
            onPasswordChange={setPassword}
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword(!showPassword)}
            onSubmit={handleLogin}
            isLoading={isLoading}
            onForgotPassword={startForgotPassword}
          />
        )}
        {mode === 'register' && (
          <RegisterMode
            turnstileSiteKey={turnstileSiteKey}
            turnstileGeneration={turnstileGeneration}
            onTurnstileToken={handleTurnstileToken}
            name={name}
            onNameChange={setName}
            email={email}
            onEmailChange={setEmail}
            password={password}
            onPasswordChange={setPassword}
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword(!showPassword)}
            onSubmit={handleRegister}
            isLoading={isLoading}
          />
        )}
        {mode === 'otp_verify' && verifyContextMissing && (
          <VerifyUnavailable
            onRegister={() => navigate('/auth?mode=register', { replace: true })}
            onLogin={() => navigate('/auth', { replace: true })}
          />
        )}
        {mode === 'otp_verify' && verifyContext && (
          <OtpMode
            otpDigits={otpDigits}
            otpInputsRef={otpInputsRef}
            onOtpChange={handleOtpChange}
            onOtpKeyDown={handleOtpKeyDown}
            onOtpPaste={handleOtpPaste}
            transferDeferred={transferDeferred}
            otpPurpose={otpPurpose}
            onContinueWithoutTransfer={() => void handleContinueWithoutTransfer()}
            onSubmitVerify={handleVerifyOtp}
            isLoading={isLoading}
            isResending={isResending}
            resendCountdown={resendCountdown}
            onResend={() => void handleResendOtp()}
            delivered={verifyContext.delivered}
            expiresAt={verifyContext.expiresAt}
            errorMessage={errorMessage}
            successMessage={successMessage}
          />
        )}
        {mode === 'forgot_password' && (
          <ForgotPasswordMode
            forgotOtpRequested={forgotOtpRequested}
            email={email}
            onEmailChange={setEmail}
            onRequestOtp={handleRequestForgotOtp}
            otpDigits={otpDigits}
            otpInputsRef={otpInputsRef}
            onOtpChange={handleOtpChange}
            onOtpKeyDown={handleOtpKeyDown}
            onOtpPaste={handleOtpPaste}
            newPassword={newPassword}
            onNewPasswordChange={setNewPassword}
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword(!showPassword)}
            onResetPassword={handleResetPassword}
            isLoading={isLoading}
            onBackToLogin={backToLogin}
          />
        )}
      </Slide>
    </AuthShell>
  );
};
