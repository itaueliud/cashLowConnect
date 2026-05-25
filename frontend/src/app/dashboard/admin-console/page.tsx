'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Activity, ArrowRight, Loader2, Shield, UsersRound } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

export default function AdminConsoleStandalonePage() {
  const { user } = useAuthStore();
  const [syncingJobs, setSyncingJobs] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-console-stats'],
    queryFn: () => api.get('/admin/stats').then((response) => response.data),
    enabled: user?.role === 'admin',
  });

  if (user?.role !== 'admin') {
    return <div className="card text-sm text-slate-400">Admin access required.</div>;
  }

  const syncJobsNow = async () => {
    setSyncingJobs(true);
    try {
      const response = await api.post('/jobs/sync-now');
      toast.success(response.data?.message || 'Job sync completed');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to sync jobs');
    } finally {
      setSyncingJobs(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-[2rem] border border-blue-500/20 bg-gradient-to-br from-blue-950 via-slate-950 to-slate-900 p-6 shadow-2xl shadow-blue-950/20">
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Admin Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          Manage user accounts in your scope and monitor provider readiness.
        </p>
        <div className="mt-4">
          <button
            onClick={syncJobsNow}
            disabled={syncingJobs}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
          >
            {syncingJobs ? <Loader2 size={14} className="animate-spin" /> : null}
            Sync Jobs Now
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm md:max-w-lg">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-xs text-slate-400">Total users</div>
            <div className="text-2xl font-black text-blue-300">{isLoading ? '...' : data?.stats?.totalUsers ?? 0}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-xs text-slate-400">Active users</div>
            <div className="text-2xl font-black text-white">{isLoading ? '...' : data?.stats?.activeUsers ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/dashboard/admin/users" className="rounded-[1.5rem] border border-blue-500/10 bg-slate-900/90 p-5 transition hover:-translate-y-1 hover:border-blue-400/30">
          <UsersRound className="text-blue-300" />
          <div className="mt-4 text-xl font-bold text-white">Users</div>
          <p className="mt-2 text-sm text-slate-400">Ban/unban users and set temporary passwords.</p>
          <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-300">Open <ArrowRight size={14} /></div>
        </Link>
        <Link href="/dashboard/admin/provider-health" className="rounded-[1.5rem] border border-blue-500/10 bg-slate-900/90 p-5 transition hover:-translate-y-1 hover:border-blue-400/30">
          <Activity className="text-blue-300" />
          <div className="mt-4 text-xl font-bold text-white">Provider Health</div>
          <p className="mt-2 text-sm text-slate-400">Validate payment provider configuration.</p>
          <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-300">Open <ArrowRight size={14} /></div>
        </Link>
        <div className="rounded-[1.5rem] border border-blue-500/10 bg-slate-900/90 p-5">
          <Shield className="text-blue-300" />
          <div className="mt-4 text-xl font-bold text-white">Role Guardrails</div>
          <p className="mt-2 text-sm text-slate-400">Admins cannot access ledger payout execution or superadmin management.</p>
        </div>
      </div>
    </div>
  );
}
