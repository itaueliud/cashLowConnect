'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { TurnstileWidget } from '@/components/security/TurnstileWidget';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [portal, setPortal] = useState('');
  const { register, handleSubmit } = useForm<{ identifier: string; password: string }>();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || '';
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryPortal = String(params.get('portal') || '').toLowerCase();
    if (queryPortal) {
      setPortal(queryPortal);
      return;
    }
    const host = String(window.location.host || '').toLowerCase();
    if (host.includes('ledger')) setPortal('ledger');
    else if (host.includes('superadmin')) setPortal('superadmin');
    else if (host.includes('admin')) setPortal('admin');
    else setPortal('');
  }, []);
  const portalLabel =
    portal === 'ledger'
      ? 'Ledger Dashboard'
      : portal === 'superadmin'
        ? 'Superadmin Dashboard'
        : portal === 'admin'
          ? 'Admin Dashboard'
          : '';
  const hideSignup = portal === 'admin' || portal === 'superadmin';

  const onSubmit = async (data: { identifier: string; password: string }) => {
    if (turnstileSiteKey && !turnstileToken) {
      toast.error('Please complete the security check');
      return;
    }

    setIsLoading(true);
    try {
      const browserLanguage = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0].toLowerCase();
      const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
      await login(data.identifier, data.password, turnstileToken || undefined, browserLanguage, timezone, portal || undefined);
      const language = useAuthStore.getState().user?.userLanguage || browserLanguage || 'en';
      localStorage.setItem('cfh-user-language', language);
      document.documentElement.lang = language;
      toast.success('Welcome back!');
      const targetByPortal: Record<string, string> = {
        ledger: '/dashboard/ledger',
        superadmin: '/dashboard/superadmin',
        admin: '/dashboard/admin-console',
      };
      router.push(targetByPortal[portal] || '/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center font-black text-xl mx-auto mb-4">C</div>
          <h1 className="text-2xl font-black">Welcome Back</h1>
          <p className="text-slate-400 text-sm mt-1">Login to your CashFlowHubs account</p>
          {portalLabel && (
            <div className="mt-3 inline-flex items-center rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-green-300">
              {portalLabel}
            </div>
          )}
        </div>
        <div className="card">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-300 mb-1.5 block">Email or Phone Number</label>
              <input {...register('identifier')} placeholder="name@example.com or +254712345678" className="input" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300 mb-1.5 block">Password</label>
              <div className="relative">
                <input {...register('password')} type={showPassword ? 'text' : 'password'}
                  placeholder="Your password" className="input pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              onExpire={() => setTurnstileToken('')}
              onError={() => setTurnstileToken('')}
              className="flex justify-center"
            />
            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : 'Login'}
            </button>
          </form>
          {!hideSignup && (
            <p className="text-center text-slate-400 text-sm mt-5">
              No account?{' '}
              <Link href="/register" className="text-green-400 hover:text-green-300 font-medium">Sign up free</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

