'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Shield, Ban, Unlock, KeyRound, Search, Eye, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

type UserItem = {
  _id: string;
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  role?: string;
  activationStatus?: boolean;
  isBanned?: boolean;
  userId?: string;
  createdAt?: string;
  userAccessType?: 'real' | 'test';
};

export default function AdminUsersPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [resetPasswordMap, setResetPasswordMap] = useState<Record<string, string>>({});
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [bannedFilter, setBannedFilter] = useState<'all' | 'true' | 'false'>('all');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', search, bannedFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (bannedFilter !== 'all') params.set('banned', bannedFilter);
      return api.get(`/admin/users?${params.toString()}`).then((response) => response.data);
    },
    enabled: user?.role === 'admin',
  });

  const users: UserItem[] = data?.users || [];

  const { data: userLedgerData, isLoading: isLedgerLoading } = useQuery({
    queryKey: ['admin-user-ledger', selectedUserId],
    queryFn: () => api.get(`/admin/users/${selectedUserId}/ledger`).then((response) => response.data),
    enabled: !!selectedUserId,
  });

  const selectedUser = userLedgerData?.user;
  const selectedWallet = userLedgerData?.wallet;
  const selectedTransactions = userLedgerData?.transactions || [];

  const riskFlags = useMemo(() => {
    if (!selectedUser) return [] as string[];
    const flags: string[] = [];
    if (selectedUser.isBanned) flags.push('Account is currently banned');
    if (!selectedUser.activationStatus) flags.push('Not activated');
    if (Number(selectedUser.failedLoginAttempts || 0) > 0) flags.push(`Failed logins: ${selectedUser.failedLoginAttempts}`);
    if (selectedTransactions.some((tx: any) => tx.status === 'failed')) flags.push('Has failed transactions');
    return flags;
  }, [selectedTransactions, selectedUser]);

  const banUser = async (userId: string) => {
    try {
      await api.put(`/admin/users/${userId}/ban`, { reason: 'Banned by admin panel' });
      toast.success('User banned');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to ban user');
    }
  };

  const unbanUser = async (userId: string) => {
    try {
      await api.put(`/admin/users/${userId}/unban`);
      toast.success('User unblocked');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to unblock user');
    }
  };

  const resetUserPassword = async (userId: string) => {
    const newPassword = resetPasswordMap[userId];
    if (!newPassword || newPassword.length < 8) {
      toast.error('Enter a temporary password (8+ chars)');
      return;
    }
    try {
      await api.put(`/admin/users/${userId}/reset-password`, { newPassword });
      toast.success('Password updated');
      setResetPasswordMap((current) => ({ ...current, [userId]: '' }));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update password');
    }
  };

  const setUserAccessType = async (userId: string, userAccessType: 'real' | 'test') => {
    try {
      await api.put(`/admin/users/${userId}/access-type`, { userAccessType });
      toast.success(`User marked as ${userAccessType}`);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      if (selectedUserId === userId) {
        queryClient.invalidateQueries({ queryKey: ['admin-user-ledger', selectedUserId] });
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update user access type');
    }
  };

  if (user?.role !== 'admin') {
    return <div className="card text-sm text-slate-400">Only admins can manage users.</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-[2rem] border border-blue-500/20 bg-gradient-to-br from-blue-950 via-slate-950 to-slate-900 p-6 shadow-2xl shadow-blue-950/20">
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
          <Shield size={12} /> User management
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">Manage users</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          Search accounts, inspect user ledger profile, and apply account controls.
        </p>
      </div>

      <div className="card">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(searchInput);
              }}
              placeholder="Search by name, phone, email, or userId"
              className="w-full bg-transparent text-sm text-white outline-none"
            />
          </div>
          <select
            className="input max-w-[180px]"
            value={bannedFilter}
            onChange={(e) => setBannedFilter(e.target.value as 'all' | 'true' | 'false')}
          >
            <option value="all">All statuses</option>
            <option value="false">Active only</option>
            <option value="true">Banned only</option>
          </select>
          <button className="btn-primary" onClick={() => setSearch(searchInput)}>Apply filters</button>
        </div>
      </div>

      {isLoading ? (
        <div className="card text-sm text-slate-400">Loading users...</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {users.map((item) => (
            <div key={item._id} className="rounded-[1.5rem] border border-blue-500/10 bg-slate-900/90 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-white">{item.name}</div>
                  <div className="text-xs text-slate-500">{item.email || '-'} | {item.phone || '-'}</div>
                  <div className="mt-2 text-xs text-slate-500">Country {item.country || '-'} | Role {item.role || '-'} | Activated {item.activationStatus ? 'yes' : 'no'}</div>
                  <div className="mt-1 text-xs text-slate-400">Access type: <span className="font-semibold text-slate-200">{item.userAccessType || 'real'}</span></div>
                </div>
                <span className={item.isBanned ? 'badge-red' : 'badge-blue'}>{item.isBanned ? 'banned' : 'active'}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedUserId(item._id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-200 transition hover:border-blue-300/50"
                >
                  <Eye size={14} /> Profile
                </button>
                <button
                  onClick={() => (item.isBanned ? unbanUser(item._id) : banUser(item._id))}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    item.isBanned
                      ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-300/50'
                      : 'border border-red-400/30 bg-red-500/10 text-red-200 hover:border-red-300/50'
                  }`}
                >
                  {item.isBanned ? <Unlock size={14} /> : <Ban size={14} />}
                  {item.isBanned ? 'Unblock user' : 'Block user'}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  className="input max-w-[260px]"
                  type="password"
                  placeholder="Temporary password"
                  value={resetPasswordMap[item._id] || ''}
                  onChange={(e) => setResetPasswordMap((current) => ({ ...current, [item._id]: e.target.value }))}
                />
                <button
                  onClick={() => resetUserPassword(item._id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-2.5 text-sm font-semibold text-yellow-200 transition hover:border-yellow-300/50"
                >
                  <KeyRound size={14} /> Set password
                </button>
                <button
                  onClick={() => setUserAccessType(item._id, 'real')}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-500/40 bg-slate-800/70 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-300/60"
                >
                  Mark Real
                </button>
                <button
                  onClick={() => setUserAccessType(item._id, 'test')}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2.5 text-sm font-semibold text-indigo-200 transition hover:border-indigo-300/50"
                >
                  Mark Test
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && <div className="card text-sm text-slate-400">No users found for current filters.</div>}
        </div>
      )}

      {selectedUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">User profile & ledger</h2>
              <button className="rounded-lg border border-slate-600 p-2 text-slate-300" onClick={() => setSelectedUserId(null)}>
                <X size={16} />
              </button>
            </div>

            {isLedgerLoading ? (
              <div className="card text-sm text-slate-400">Loading user profile...</div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="card"><div className="text-xs text-slate-400">Name</div><div className="mt-1 text-sm text-white">{selectedUser?.name || '-'}</div></div>
                  <div className="card"><div className="text-xs text-slate-400">Email</div><div className="mt-1 text-sm text-white">{selectedUser?.email || '-'}</div></div>
                  <div className="card"><div className="text-xs text-slate-400">Phone</div><div className="mt-1 text-sm text-white">{selectedUser?.phone || '-'}</div></div>
                </div>
                <div className="card"><div className="text-xs text-slate-400">Access type</div><div className="mt-1 text-sm text-white">{selectedUser?.userAccessType || 'real'}</div></div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="card"><div className="text-xs text-slate-400">Wallet USD</div><div className="mt-1 text-xl font-black text-blue-300">${Number(selectedWallet?.balanceUSD || 0).toFixed(2)}</div></div>
                  <div className="card"><div className="text-xs text-slate-400">Total earned</div><div className="mt-1 text-xl font-black text-white">${Number(selectedWallet?.totalEarned || 0).toFixed(2)}</div></div>
                  <div className="card"><div className="text-xs text-slate-400">Transactions</div><div className="mt-1 text-xl font-black text-white">{selectedTransactions.length}</div></div>
                  <div className="card"><div className="text-xs text-slate-400">Status</div><div className="mt-1 text-sm text-white">{selectedUser?.isBanned ? 'Banned' : 'Active'}</div></div>
                </div>

                <div className="card">
                  <div className="mb-2 text-sm font-semibold text-white">Risk flags</div>
                  {riskFlags.length === 0 ? (
                    <div className="text-sm text-emerald-300">No immediate risk flags.</div>
                  ) : (
                    <ul className="space-y-1 text-sm text-yellow-300">
                      {riskFlags.map((flag) => <li key={flag}>- {flag}</li>)}
                    </ul>
                  )}
                </div>

                <div className="card overflow-x-auto">
                  <div className="mb-2 text-sm font-semibold text-white">Recent transactions</div>
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 text-left text-slate-400">
                        <th className="px-2 py-2">Date</th>
                        <th className="px-2 py-2">Type</th>
                        <th className="px-2 py-2">Provider</th>
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTransactions.map((tx: any) => (
                        <tr key={tx._id} className="border-b border-slate-800">
                          <td className="px-2 py-2 text-slate-300">{new Date(tx.createdAt).toLocaleString()}</td>
                          <td className="px-2 py-2 text-slate-300">{tx.type}</td>
                          <td className="px-2 py-2 text-slate-300">{tx.provider || '-'}</td>
                          <td className="px-2 py-2 text-slate-300">{tx.status}</td>
                          <td className="px-2 py-2 font-semibold text-white">${Number(tx.amountUSD || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {selectedTransactions.length === 0 && (
                        <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-400">No transactions found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
