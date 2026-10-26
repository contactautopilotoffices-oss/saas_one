"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- this admin-only panel renders versioned JSON DTOs returned by the guarded API */
import React, { useState } from 'react';
import { BrainCircuit, RefreshCw } from 'lucide-react';
import BotReviewSection from './BotReviewSection';
import PromptVersionsSection from './PromptVersionsSection';

/**
 * Bot learning — one collapsible section (same shape as "Reporting chain"): Bot health and Prompt versions side by side,
 * then the mistake review at full width. Loads only when opened. Nothing here changes the bot until an admin approves it.
 */
export default function BotLearningPanel({ orgId }: { orgId?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>({ reviews: [], prompts: [], health: null, alertAdmins: [], developerItems: [], reviewUpgrade: false });
  const [reviewsKey, setReviewsKey] = useState(0);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [alertAdminsText, setAlertAdminsText] = useState('');
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const url = `/api/task-manager/bot-learning?orgId=${encodeURIComponent(orgId || '')}`;

  /** Full load (also resets the review list). With keepReviews the review list on screen is left as it is. */
  const load = async (keepReviews = false) => {
    setLoading(true);
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Load failed');
      if (keepReviews) setData((d: any) => ({ ...j, reviews: d.reviews }));
      else { setData(j); setReviewsKey(k => k + 1); setHasMoreReviews((j.reviews || []).length === 30); }
      setAlertAdminsText((j.alertAdmins || []).map((a: any) => `${a.name}, ${a.phone}`).join('\n'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally { setLoading(false); }
  };
  const toggleOpen = () => { const next = !open; setOpen(next); if (next) void load(); };

  /** POST one action. Returns the JSON on success, null on failure (the error is shown). */
  /** quiet: no busy lock and no error banner (background work such as preparing the next card); errors are thrown. */
  const post = async (body: any, opts: { reload?: 'all' | 'side' | 'none'; quiet?: boolean } = {}): Promise<any | null> => {
    if (!opts.quiet) { setBusy(true); setError(''); }
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Action failed');
      if (opts.reload !== 'none') await load(opts.reload === 'side');
      return j;
    } catch (e) {
      if (opts.quiet) throw e;
      setError(e instanceof Error ? e.message : 'Action failed'); return null;
    } finally { if (!opts.quiet) setBusy(false); }
  };
  const loadOlder = async () => {
    const before = data.reviews?.[data.reviews.length - 1]?.created_at; if (!before) return;
    setBusy(true);
    try {
      const r = await fetch(`${url}&before=${encodeURIComponent(before)}`); const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Load failed');
      setData((d: any) => ({ ...d, reviews: [...(d.reviews || []), ...(j.reviews || [])] }));
      setHasMoreReviews((j.reviews || []).length === 30);
    } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); } finally { setBusy(false); }
  };

  const h = data.health;
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BrainCircuit className="w-5 h-5 text-indigo-500" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Bot learning</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-800 border border-indigo-200">Phase 5: Learning loop</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Bot health, new AI instructions waiting for approval, and mistakes to review. Nothing here changes the bot until you approve it.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {open && (
            <button type="button" disabled={loading} onClick={() => load()} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
          <button type="button" onClick={toggleOpen} className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs cursor-pointer">
            {open ? 'Hide' : 'Show bot learning'}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4">
          {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">⚠️ {error}</div>}
          {loading && !h && !data.prompts?.length && <p className="text-xs text-slate-500">Loading bot learning…</p>}

          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4 items-start">
            <section className="border border-slate-200 rounded-2xl p-5 space-y-3">
              <h3 className="font-black text-slate-900">Bot health</h3>
              {h ? <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {[['Replies', h.replies], ['Apologies', h.apologies], ['Fallbacks', h.fallbacks], ['AI failures', h.aiFailures], ['Median reply', h.medianReplyMs == null ? '—' : `${Math.round(h.medianReplyMs / 100) / 10}s`], ['Review waiting', h.reviewWaiting]].map(([k, v]) =>
                    <div key={String(k)} className="bg-slate-50 rounded-xl p-2"><div className="text-slate-500">{k}</div><b className="text-base">{v}</b></div>)}
                </div>
                <p className="text-xs text-slate-600"><b>Last 15 min:</b> {h.window15?.apologies || 0} apologies · {h.window15?.aiFailures || 0}/{h.window15?.brainMessages || 0} AI failures</p>
              </> : <p className="text-xs text-slate-500">Health data needs the Phase 5 migration.</p>}
              <h4 className="text-xs font-black pt-2">Alert recipients</h4>
              <p className="text-[11px] text-slate-500">Enter as &ldquo;Name, Phone&rdquo; (one per line)</p>
              <textarea className="w-full border rounded-xl p-2 text-xs" rows={3} placeholder="Name, Phone" value={alertAdminsText} onChange={e => setAlertAdminsText(e.target.value)} />
              <button
                disabled={busy}
                onClick={() => {
                  const parsed = alertAdminsText.split(/\n/).map(line => line.trim()).filter(Boolean).map(line => {
                    const [name, ...p] = line.split(',');
                    return { name: name.trim(), phone: p.join(',').trim() };
                  });
                  void post({ action: 'save_alert_admins', admins: parsed }, { reload: 'side' });
                }}
                className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                Save recipients
              </button>
            </section>

            <PromptVersionsSection prompts={data.prompts || []} busy={busy} post={post} />
          </div>

          <BotReviewSection
            key={reviewsKey}
            reviews={data.reviews || []}
            developerItems={data.developerItems || []}
            upgraded={!!data.reviewUpgrade}
            busy={busy}
            post={post}
            hasMore={hasMoreReviews}
            loadOlder={loadOlder}
          />
        </div>
      )}
    </div>
  );
}
