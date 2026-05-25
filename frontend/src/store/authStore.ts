import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import api from '@/lib/api';

const safeStorage = {
  getItem: (_name: string) => null,
  setItem: (_name: string, _value: string) => {},
  removeItem: (_name: string) => {},
};

interface User {
  id: string;
  userId: string;
  role?: 'user' | 'admin' | 'superadmin' | 'ledger';
  userAccessType?: 'real' | 'test';
  firstName?: string;
  lastName?: string;
  name: string;
  email?: string;
  phone: string;
  country: string;
  referralCode: string;
  activationStatus: boolean;
  level: number;
  xpPoints: number;
  streak: number;
  badges: string[];
  balanceUSD: number;
  phoneVerified?: boolean;
  emailVerified?: boolean;
  identityVerificationStatus?: string;
  surveysCompleted?: number;
  tasksCompleted?: number;
  totalReferrals?: number;
  tokenBalance?: number;
  totalTokensPurchased?: number;
  totalTokensSpent?: number;
  paymentProvider?: string;
  userLanguage?: string;
  browserLanguage?: string;
  paymentRouting?: {
    deposits: string[];
    withdrawals: string[];
  };
  tokenPackages?: { tokens: number; amountKES: number }[];
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  hasHydrated: boolean;
  setUser: (user: User) => void;
  setToken: (token: string) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  login: (identifier: string, password: string, turnstileToken?: string, browserLanguage?: string, timezone?: string, portal?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      hasHydrated: false,

      setUser: (user) => set({ user }),
      setToken: (token) => {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        set({ token });
      },
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      login: async (identifier, password, turnstileToken, browserLanguage, timezone, portal) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/login', {
            identifier,
            password,
            turnstileToken,
            browser_language: browserLanguage,
            timezone,
            portal,
          });
          const { token, user } = res.data;
          set({ token, user, isLoading: false });
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: () => {
        set({ user: null, token: null });
        delete api.defaults.headers.common['Authorization'];
      },

      refreshUser: async () => {
        try {
          const res = await api.get('/auth/me');
          set({ user: { ...get().user, ...res.data.user, balanceUSD: res.data.wallet?.balanceUSD || 0 } });
        } catch {}
      },
    }),
    {
      name: 'earnhub-auth',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : safeStorage)),
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        const token = state?.token;
        if (token) {
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        }
        state?.setHasHydrated(true);
      },
    }
  )
);
