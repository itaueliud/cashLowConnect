'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Search, Building2, Clock, Plus, Loader2, ArrowRight, Briefcase, Filter, SearchCheck, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

const EMPTY_FORM = {
  title: '',
  company: '',
  category: 'Other',
  jobType: 'contract',
  location: 'Remote',
  salary: '',
  description: '',
  applicationUrl: '',
  budgetAmount: '',
  budgetCurrency: 'KES',
  categoryOther: '',
};
const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship'];
const JOB_LOCATIONS = ['Remote', 'Hybrid', 'On-site'];
const BUDGET_CURRENCIES = ['KES', 'USD', 'UGX', 'TZS', 'GHS', 'NGN', 'ETB'];

export default function JobsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'browse' | 'post'>('browse');
  const [posting, setPosting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const { user, setUser } = useAuthStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', search, category, page],
    queryFn: () => api.get(`/jobs?search=${search}&category=${category}&page=${page}&limit=20`).then((r) => r.data),
  });
  const { data: catData } = useQuery({
    queryKey: ['job-cats'],
    queryFn: async () => {
      try {
        const response = await api.get('/jobs/categories');
        return response.data.categories || [];
      } catch {
        return [];
      }
    },
  });

  const jobs = data?.jobs || [];
  const pagination = data?.pagination || {};
  const tokenPolicy = data?.tokenPolicy;
  const availableCategories: string[] = (catData && catData.length > 0) ? catData : ['Other'];

  const updateField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const onPostJob = async () => {
    if (form.category === 'Other') {
      const custom = String(form.categoryOther || '').trim();
      if (custom.length < 3 || custom.length > 60) {
        toast.error('Please specify Other category using 3 to 60 characters');
        return;
      }
    }

    setPosting(true);
    try {
      const payload = {
        ...form,
        budgetAmount: form.budgetAmount ? Number(form.budgetAmount) : undefined,
        tags: [],
      };
      const response = await api.post('/jobs', payload);
      if (user) {
        setUser({ ...user, tokenBalance: response.data.tokenBalance });
      }
      setForm(EMPTY_FORM);
      setTab('browse');
      toast.success(`Job posted. ${response.data.tokensSpent} tokens were used.`);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to post job');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[2rem] border border-emerald-500/20 bg-gradient-to-br from-emerald-950 via-slate-950 to-slate-900 shadow-2xl shadow-emerald-950/20">
        <div className="grid gap-8 p-6 lg:grid-cols-[1.4fr_0.8fr] lg:p-8">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">
              <Sparkles size={12} /> CashFlowHubs remote board
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Remote Jobs</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Discover remote roles in a clean, search-first board designed for the CashFlowHubs community.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs text-slate-400">Visible jobs</div>
                <div className="text-2xl font-black text-emerald-300">{jobs.length || '—'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs text-slate-400">Sources</div>
                <div className="text-2xl font-black text-white">2</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs text-slate-400">Token balance</div>
                <div className="text-2xl font-black text-white">{user?.tokenBalance || 0}T</div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {[
              { label: 'Fast apply', value: 'Internal application flow', icon: SearchCheck },
              { label: 'Remote-first', value: 'Location is always remote', icon: Briefcase },
              { label: 'Trusted flow', value: 'Apply inside the platform', icon: ShieldCheck },
              { label: 'Marketplace feel', value: 'Clean cards and focused CTAs', icon: TrendingUp },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                  <item.icon size={18} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{item.label}</div>
                  <div className="text-xs leading-5 text-slate-400">{item.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/10 bg-slate-900/90 p-4">
        <div className="flex items-center gap-2">
          {(['browse', 'post'] as const).map((tabName) => (
            <button
              key={tabName}
              onClick={() => setTab(tabName)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-all capitalize ${tab === tabName ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              {tabName}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-xs text-slate-400">
          <Filter size={12} /> Search-first job board
        </div>
      </div>

      {tab === 'post' ? (
        <div className="mx-auto max-w-4xl space-y-4 rounded-[1.5rem] border border-emerald-500/10 bg-slate-900/90 p-5 shadow-xl shadow-emerald-950/10 md:p-6">
          <div className="mb-2">
            <h2 className="text-2xl font-black text-white">Post a remote role</h2>
            <p className="mt-1 text-sm text-slate-400">Use a clean CashFlowHubs layout for internal job listings.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Job Title</label>
              <input className="input" value={form.title} onChange={(e) => updateField('title', e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Company</label>
              <input className="input" value={form.company} onChange={(e) => updateField('company', e.target.value)} />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Category</label>
              <select className="input" value={form.category} onChange={(e) => updateField('category', e.target.value)}>
                {availableCategories.map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Job Type</label>
              <select className="input" value={form.jobType} onChange={(e) => updateField('jobType', e.target.value)}>
                {JOB_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Location</label>
              <select className="input" value={form.location} onChange={(e) => updateField('location', e.target.value)}>
                {JOB_LOCATIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Salary</label>
              <input className="input" value={form.salary} onChange={(e) => updateField('salary', e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Budget Amount</label>
              <input className="input" type="number" value={form.budgetAmount} onChange={(e) => updateField('budgetAmount', e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Budget Currency</label>
              <select className="input" value={form.budgetCurrency} onChange={(e) => updateField('budgetCurrency', e.target.value)}>
                {BUDGET_CURRENCIES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>

          {form.category === 'Other' && (
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Specify Category (3-60 characters)</label>
              <input
                className="input"
                maxLength={60}
                value={form.categoryOther}
                onChange={(e) => updateField('categoryOther', e.target.value)}
                placeholder="Example: Healthcare Administration"
              />
              <div className="mt-1 text-xs text-slate-500">{form.categoryOther.length}/60</div>
            </div>
          )}

          <div>
            <label className="text-sm text-slate-300 mb-1 block">Application URL</label>
            <input className="input" value={form.applicationUrl} onChange={(e) => updateField('applicationUrl', e.target.value)} />
          </div>

          <div>
            <label className="text-sm text-slate-300 mb-1 block">Description</label>
            <textarea className="input min-h-32" value={form.description} onChange={(e) => updateField('description', e.target.value)} />
          </div>

          <button onClick={onPostJob} disabled={posting} className="btn-primary flex items-center gap-2">
            {posting && <Loader2 size={16} className="animate-spin" />}
            Post Job for {tokenPolicy?.postingCost || 10} Tokens
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-emerald-500/10 bg-slate-900/90 p-4">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search remote jobs..." className="input border-slate-700 bg-slate-950 pl-9" />
              </div>
              <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="input border-slate-700 bg-slate-950 lg:w-56">
                <option value="">All Categories</option>
                {availableCategories.map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => setTab('post')} className="btn-primary inline-flex items-center gap-2 lg:shrink-0">
                <Plus size={16} /> Post Job
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array(5).fill(0).map((_, i) => <div key={i} className="card h-20 animate-pulse" />)}</div>
          ) : jobs.length === 0 ? (
            <div className="card text-center py-12 text-slate-400">No jobs found. Try a different search.</div>
          ) : (
            <div className="grid gap-3">
              {jobs.map((job: any) => (
                <div key={job._id} className="rounded-[1.5rem] border border-emerald-500/10 bg-slate-900/90 p-5 transition-all hover:-translate-y-1 hover:border-emerald-400/30 hover:shadow-xl hover:shadow-emerald-950/15">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge-green">Remote</span>
                        <span className="badge-blue">{job.category === 'Other' && job.categoryOther ? `Other (${job.categoryOther})` : job.category}</span>
                        {job.source === 'internal' && <span className="badge-yellow">{job.applicationTokenCost}T apply</span>}
                        {job.salary && <span className="badge" style={{ background: 'rgba(16,185,129,0.14)', color: '#6ee7b7' }}>{job.salary}</span>}
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-bold text-white">{job.title}</h3>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
                          <span className="flex items-center gap-1"><Building2 size={12} />{job.company}</span>
                          <span className="flex items-center gap-1"><Clock size={12} />{new Date(job.publishedAt).toLocaleDateString()}</span>
                          <span className="capitalize">{job.jobType}</span>
                          <span className="capitalize text-slate-500">{job.source}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-3 lg:items-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (!job?._id) {
                            toast.error('This job cannot be opened right now');
                            return;
                          }
                          router.push(`/dashboard/jobs/${job._id}`);
                        }}
                        className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                      >
                        Apply on site <ArrowRight size={14} />
                      </button>
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">CashFlowHubs remote board</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {pagination.pages > 1 && (
            <div className="flex justify-center gap-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary text-sm py-1.5 px-4 disabled:opacity-40">Prev</button>
              <span className="text-slate-400 text-sm py-1.5 px-3">{page} / {pagination.pages}</span>
              <button disabled={page === pagination.pages} onClick={() => setPage((p) => p + 1)} className="btn-secondary text-sm py-1.5 px-4 disabled:opacity-40">Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
