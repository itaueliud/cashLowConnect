'use client';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  ArrowRight,
  ClipboardList,
  Zap,
  Briefcase,
  Gift,
  Star,
  TrendingUp,
  Flame,
  Trophy,
  Radio,
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

const QUICK_ACTIONS = [
  { href: '/dashboard/jobs', icon: Briefcase, label: 'Remote Jobs', color: 'bg-purple-500/20 text-purple-400', desc: 'Full-time / part-time' },
  { href: '/dashboard/surveys', icon: ClipboardList, label: 'Paid Surveys', color: 'bg-blue-500/20 text-blue-400', desc: 'Up to $3 each' },
  { href: '/dashboard/tasks', icon: Zap, label: 'Microtasks', color: 'bg-yellow-500/20 text-yellow-400', desc: '$0.10-$1 each' },
  { href: '/dashboard/ads-network', icon: Radio, label: 'Ads / Ad Network', color: 'bg-cyan-500/20 text-cyan-400', desc: 'Ad-driven offers' },
  { href: '/dashboard/offerwalls', icon: Gift, label: 'Offerwalls', color: 'bg-pink-500/20 text-pink-400', desc: 'Install & earn' },
  { href: '/dashboard/cash-tasks', icon: TrendingUp, label: 'Cash Tasks', color: 'bg-orange-500/20 text-orange-400', desc: 'Higher-value tasks' },
  { href: '/dashboard/referrals', icon: Star, label: 'Referral Earnings', color: 'bg-green-500/20 text-green-400', desc: '200 KES per activated referral' },
  { href: '/dashboard#daily-challenges', icon: Trophy, label: 'Daily Challenges', color: 'bg-amber-500/20 text-amber-400', desc: 'Daily streak rewards' },
];

export default function DashboardPage() {
  const { user, refreshUser } = useAuthStore();
  const isRealUser = user?.role === 'user' && (user?.userAccessType || 'real') === 'real';
  const blockedForRealUser = new Set(['/dashboard/surveys', '/dashboard/tasks', '/dashboard/ads-network', '/dashboard/offerwalls']);

  const { data: walletData } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.get('/wallet').then((r) => r.data.wallet),
    refetchInterval: 30000,
  });

  const { data: challengesData } = useQuery({
    queryKey: ['challenges'],
    queryFn: () => api.get('/challenges/daily').then((r) => r.data.challenges),
  });

  const { data: txData } = useQuery({
    queryKey: ['recent-tx'],
    queryFn: () => api.get('/wallet/transactions?limit=5').then((r) => r.data.transactions),
  });

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const wallet = walletData || {};
  const challenges = challengesData || [];
  const transactions = txData || [];

  const chartData = [
    { day: 'Mon', earn: 0.4 },
    { day: 'Tue', earn: 1.2 },
    { day: 'Wed', earn: 0.8 },
    { day: 'Thu', earn: 2.1 },
    { day: 'Fri', earn: 1.5 },
    { day: 'Sat', earn: 3.2 },
    { day: 'Sun', earn: 1.8 },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {!user?.activationStatus && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-yellow-400">Account Not Activated</div>
            <div className="text-sm text-slate-400 mt-0.5">Pay 500 KES to unlock the full earning stack and referral earnings</div>
          </div>
          <Link href="/dashboard/activate" className="btn-primary text-sm py-2 px-4 whitespace-nowrap">
            Activate Now
          </Link>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card md:col-span-1">
          <div className="text-xs text-slate-400 mb-1">Total Balance</div>
          <div className="text-4xl font-black text-green-400">${(wallet.balanceUSD || 0).toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{wallet.symbol}{wallet.balanceLocal || 0} {wallet.currency}</div>
          <div className="mt-3 text-xs text-yellow-300">{user?.tokenBalance || 0} Tokens available</div>
          <div className="mt-3 flex gap-2">
            <Link href="/dashboard/wallet" className="btn-secondary text-xs py-1.5 px-3">View Wallet</Link>
            <Link href="/dashboard/wallet#withdraw" className="btn-primary text-xs py-1.5 px-3">Withdraw</Link>
          </div>
        </div>

        <div className="card md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">This Week&apos;s Earnings</div>
            <div className="text-xs text-green-400">+$9.00</div>
          </div>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="earn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="earn" stroke="#22c55e" fill="url(#earn)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Surveys Done', value: user?.surveysCompleted || 0, icon: ClipboardList, color: 'text-blue-400' },
          { label: 'Tasks Done', value: user?.tasksCompleted || 0, icon: Zap, color: 'text-yellow-400' },
          { label: 'Referrals', value: user?.totalReferrals || 0, icon: Star, color: 'text-green-400' },
          { label: 'Tokens', value: user?.tokenBalance || 0, icon: TrendingUp, color: 'text-cyan-400' },
          { label: 'Day Streak', value: `${user?.streak || 0}`, icon: Flame, color: 'text-orange-400' },
        ].map((stat) => (
          <div key={stat.label} className="card">
            <stat.icon size={18} className={`${stat.color} mb-2`} />
            <div className="text-2xl font-black">{stat.value}</div>
            <div className="text-xs text-slate-400">{stat.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="font-bold text-lg mb-3">Earning Modules</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {QUICK_ACTIONS.filter((action) => !(isRealUser && blockedForRealUser.has(action.href))).map((action, index) => (
            <Link key={action.href} href={action.href} className="card hover:border-slate-500 transition-all group flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${action.color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                <action.icon size={18} />
              </div>
              <div>
                <div className="font-medium text-sm">{index + 1}. {action.label}</div>
                <div className="text-xs text-slate-400">{action.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {challenges.length > 0 && (
        <div id="daily-challenges">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg flex items-center gap-2"><Trophy size={18} className="text-yellow-400" /> Daily Challenges</h2>
            <span className="text-xs text-slate-400">Resets at midnight</span>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {challenges.slice(0, 4).map((challenge: any) => (
              <div key={challenge._id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm">{challenge.title}</div>
                  <div className="badge-green">${challenge.rewardUSD}</div>
                </div>
                <p className="text-xs text-slate-400 mb-3">{challenge.description}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                    <div
                      className="bg-green-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min((challenge.progress / challenge.targetCount) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400">{challenge.progress}/{challenge.targetCount}</span>
                  {challenge.completed && !challenge.rewardClaimed && (
                    <button className="btn-primary text-xs py-1 px-2">Claim!</button>
                  )}
                  {challenge.rewardClaimed && <span className="text-xs text-green-400">Claimed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {transactions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">Recent Activity</h2>
            <Link href="/dashboard/wallet" className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          <div className="card space-y-3">
            {transactions.map((tx: any) => (
              <div key={tx._id} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`${tx.direction === 'credit' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'} w-8 h-8 rounded-full flex items-center justify-center text-sm`}>
                    {tx.direction === 'credit' ? 'â†“' : 'â†‘'}
                  </div>
                  <div>
                    <div className="text-sm font-medium capitalize">{tx.type.replace('_', ' ')}</div>
                    <div className="text-xs text-slate-400">{new Date(tx.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <div className={`font-semibold text-sm ${tx.direction === 'credit' ? 'text-green-400' : 'text-red-400'}`}>
                  {tx.direction === 'credit' ? '+' : '-'}${tx.amountUSD.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

