import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';
import type { Action, AuthUser, Module, OperationType } from '../api/types';

// Mirrors server/src/config/permissions.ts (the server stays the authority).
const ALL: Action[] = ['view', 'create', 'edit', 'delete', 'confirm', 'cancel', 'operate', 'adjust'];
const USER_DEFAULT: Action[] = ['view', 'create', 'edit', 'operate'];
const MATRIX: Record<Module, { ADMIN: Action[]; USER: Action[] }> = {
  SALES: { ADMIN: ALL.filter((a) => a !== 'adjust'), USER: USER_DEFAULT },
  PURCHASE: { ADMIN: ALL.filter((a) => a !== 'adjust'), USER: USER_DEFAULT },
  MANUFACTURING: { ADMIN: ALL.filter((a) => a !== 'adjust'), USER: USER_DEFAULT },
  BOM: { ADMIN: ['view', 'create', 'edit', 'delete'], USER: ['view'] },
  PRODUCTS: { ADMIN: ['view', 'create', 'edit', 'delete', 'adjust'], USER: ['view', 'create', 'edit'] },
};
const OP_MODULE: Record<OperationType, Module> = { DELIVERY: 'SALES', RECEIPT: 'PURCHASE', PRODUCTION: 'MANUFACTURING', ADJUSTMENT: 'PRODUCTS' };

export function canUser(user: AuthUser | null, module: Module, action: Action): boolean {
  if (!user) return false;
  if (user.readOnly) return action === 'view' && (user.isSystemAdmin || user.access[module] !== 'NONE');
  if (user.isSystemAdmin) return true;
  const level = user.access[module];
  if (level === 'NONE') return false;
  return MATRIX[module][level].includes(action);
}

export function canConfirmOp(user: AuthUser | null, type: OperationType): boolean {
  if (!user || user.readOnly) return false;
  if (user.isSystemAdmin || user.access.PRODUCTS === 'ADMIN') return true;
  if (type === 'ADJUSTMENT') return false;
  return user.access[OP_MODULE[type]] === 'ADMIN';
}

export function canPlaceOp(user: AuthUser | null, type: OperationType): boolean {
  return type === 'ADJUSTMENT' ? canUser(user, 'PRODUCTS', 'adjust') : canUser(user, OP_MODULE[type], 'operate');
}

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (loginId: string, password: string) => Promise<void>;
  demoLogin: (loginId: string) => Promise<void>;
  signup: (input: { loginId: string; email: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (module: Module, action: Action) => boolean;
  canConfirmOperation: (type: OperationType) => boolean;
  canPlaceOperation: (type: OperationType) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ user: AuthUser }>('/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      refresh,
      login: async (loginId, password) => setUser((await api.post<{ user: AuthUser }>('/auth/login', { loginId, password })).user),
      demoLogin: async (loginId) => setUser((await api.post<{ user: AuthUser }>('/auth/demo-login', { loginId })).user),
      signup: async (input) => setUser((await api.post<{ user: AuthUser }>('/auth/signup', input)).user),
      logout: async () => {
        await api.post('/auth/logout');
        setUser(null);
      },
      can: (module, action) => canUser(user, module, action),
      canConfirmOperation: (type) => canConfirmOp(user, type),
      canPlaceOperation: (type) => canPlaceOp(user, type),
    }),
    [user, loading, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
