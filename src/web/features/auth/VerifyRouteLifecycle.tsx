import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { clearVerifyContext, readVerifyContext } from './verify-context';

const VERIFY_PATH = '/auth/verify';

/** Reconciles tab-scoped verification state with route and identity changes. */
export const VerifyRouteLifecycle = () => {
  const { pathname } = useLocation();
  const identity = useAuthStore((state) => `${state.userId}:${state.householdId}`);

  useEffect(() => {
    if (pathname === VERIFY_PATH) readVerifyContext();
    else clearVerifyContext();
  }, [identity, pathname]);

  return null;
};
