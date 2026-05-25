'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { ArrowLeft, Building2, CalendarDays, ExternalLink, Globe2, Loader2, Send, Tag } from 'lucide-react';
import { MessageSquare } from 'lucide-react';

export default function JobDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const [coverLetter, setCoverLetter] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['job', jobId],
    enabled: Boolean(jobId),
    queryFn: async () => {
      const response = await api.get(`/jobs/${jobId}`);
      return response.data.job;
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/jobs/${jobId}/apply`, { coverLetter });
      return response.data;
    },
    onSuccess: async (response) => {
      toast.success(response.message || 'Application submitted');
      setCoverLetter('');
      await refetch();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to submit application');
    },
  });

  const publishedLabel = useMemo(() => {
    if (!data?.publishedAt) return '';
    return new Date(data.publishedAt).toLocaleString();
  }, [data?.publishedAt]);

  if (!jobId) {
    return <div className="card text-slate-400">Missing job id.</div>;
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-slate-400 hover:text-white flex items-center gap-2">
        <ArrowLeft size={16} /> Back to jobs
      </button>

      {isLoading ? (
        <div className="card h-80 animate-pulse" />
      ) : !data ? (
        <div className="card text-center py-16 text-slate-400">Job not found.</div>
      ) : (
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
          <div className="card space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="badge-blue">{data.category === 'Other' && data.categoryOther ? `Other (${data.categoryOther})` : data.category}</span>
                  <span className="badge-green capitalize">{data.source}</span>
                  {data.jobType && <span className="badge-yellow capitalize">{data.jobType}</span>}
                </div>
                <h1 className="text-3xl font-black leading-tight">{data.title}</h1>
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-400">
                  <span className="flex items-center gap-2"><Building2 size={15} /> {data.company}</span>
                  <span className="flex items-center gap-2"><CalendarDays size={15} /> {publishedLabel}</span>
                  <span className="flex items-center gap-2"><Globe2 size={15} /> {data.location || 'Remote'}</span>
                </div>
              </div>
              {data.salary && <div className="badge-green text-sm">{data.salary}</div>}
            </div>

            <div className="space-y-3">
              <h2 className="font-bold text-lg">Job Description</h2>
              <p className="text-sm leading-7 text-slate-300 whitespace-pre-line">{data.description}</p>
            </div>

            {data.tags?.length > 0 && (
              <div className="space-y-3">
                <h2 className="font-bold text-lg">Skills</h2>
                <div className="flex flex-wrap gap-2">
                  {data.tags.map((tag: string) => (
                    <span key={tag} className="badge-blue flex items-center gap-1"><Tag size={12} /> {tag}</span>
                  ))}
                </div>
              </div>
            )}

            {data.applicationUrl && (
              <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
                The original posting source is still available, but applying happens here in CashFlowConnect.
                <a href={data.applicationUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-green-400 hover:text-green-300">
                  View original source <ExternalLink size={14} />
                </a>
              </div>
            )}
          </div>

          <div className="card space-y-4 h-fit sticky top-24">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Apply in site</div>
              <h2 className="text-xl font-bold">Submit your application</h2>
              <p className="text-sm text-slate-400 mt-2">Your application is recorded inside the platform, so you stay here while applying.</p>
            </div>

            <div className="space-y-2 text-sm text-slate-300">
              <div className="rounded-xl bg-slate-900 px-4 py-3">
                <div className="text-slate-500 text-xs mb-1">Company</div>
                <div>{data.company}</div>
              </div>
              <div className="rounded-xl bg-slate-900 px-4 py-3">
                <div className="text-slate-500 text-xs mb-1">Location</div>
                <div>{data.location || 'Remote'}</div>
              </div>
              <div className="rounded-xl bg-slate-900 px-4 py-3">
                <div className="text-slate-500 text-xs mb-1">Apply method</div>
                <div>On-site application</div>
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 mb-1 block">Cover Letter</label>
              <textarea
                className="input min-h-40"
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
                placeholder="Tell the employer why you are a fit for this role..."
              />
            </div>

            <button
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {applyMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Apply on site
            </button>
            <Link href={`/dashboard/chat?jobId=${jobId}`} className="btn-secondary w-full flex items-center justify-center gap-2">
              <MessageSquare size={16} /> Open job chat
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
