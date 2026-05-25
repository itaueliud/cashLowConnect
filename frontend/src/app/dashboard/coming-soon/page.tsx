'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Clock3 } from 'lucide-react';

const MODULE_COPY: Record<string, { title: string; description: string }> = {
  surveys: {
    title: 'Paid Surveys Coming Soon',
    description: 'Survey partners are being activated in phases to protect quality and payout reliability.',
  },
  tasks: {
    title: 'Microtasks Coming Soon',
    description: 'Microtask feeds are being opened gradually while we tune fraud protection and task quality.',
  },
  'ads-network': {
    title: 'Ads Network Coming Soon',
    description: 'Ad inventory access is being rolled out in batches as provider approvals complete.',
  },
  offerwalls: {
    title: 'Offerwalls Coming Soon',
    description: 'Offerwall access will unlock soon after final partner checks for your user segment.',
  },
};

export default function ComingSoonPage() {
  const searchParams = useSearchParams();
  const key = String(searchParams.get('module') || '').toLowerCase();
  const copy = MODULE_COPY[key] || {
    title: 'Module Coming Soon',
    description: 'This earning module is in staged rollout and will be available soon.',
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div className="card border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-xl bg-amber-500/20 p-2 text-amber-300">
            <Clock3 size={18} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">{copy.title}</h1>
            <p className="mt-2 text-sm text-slate-300">{copy.description}</p>
            <p className="mt-2 text-xs text-slate-400">
              Your account currently has real-user access profile. Admin can enable test-user access for early modules.
            </p>
          </div>
        </div>
      </div>
      <Link href="/dashboard" className="btn-primary inline-flex">Back to Dashboard</Link>
    </div>
  );
}
