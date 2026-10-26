"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- admin-only prompt-version DTOs returned by the guarded bot-learning API */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BUILTIN_PROMPT_SECTIONS, promptSectionDiff, type PromptSections } from '@/task-manager/brain/prompt';

/**
 * Bot review upgrade, Phase 4 — readable Prompt versions: one row per version, and "View changes" opens a large panel with
 * the changed lines (green added, red removed) and the test results as a before/after table. Same API actions as before.
 */

type Post = (body: any, opts?: { reload?: 'all' | 'side' | 'none'; quiet?: boolean }) => Promise<any | null>;
const STATUS_TEXT: Record<string, string> = { waiting: 'Waiting for you', active: 'In use', rejected: 'Rejected', retired: 'Retired', evaluating: 'Being tested', draft: 'Draft' };
const STATUS_CLASS: Record<string, string> = { waiting: 'bg-indigo-100 text-indigo-800', active: 'bg-emerald-100 text-emerald-800', rejected: 'bg-rose-100 text-rose-800', retired: 'bg-slate-100 text-slate-600', evaluating: 'bg-amber-100 text-amber-900', draft: 'bg-slate-100 text-slate-600' };
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
/** "Fix X. [drafted by gemini-2.5-flash]" → { text: "Fix X.", by: "gemini-2.5-flash" } */
const splitSummary = (p: any) => {
  const raw = String(p?.change_summary || 'No summary');
  const m = raw.match(/\s*\[drafted by ([^\]]+)\]\s*$/);
  return { text: m ? raw.slice(0, m.index).trim() : raw, by: m ? m[1] : p?.created_by === 'admin' ? 'an admin' : p?.created_by || '—' };
};
const validSections = (s: any): s is PromptSections => !!s && Array.isArray(s.steps) && Array.isArray(s.examples);

export default function PromptVersionsSection({ prompts, busy, post }: { prompts: any[]; busy: boolean; post: Post }) {
  const [viewing, setViewing] = useState<any | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const active = prompts.find(p => p.status === 'active');
  const activeSections: PromptSections = validSections(active?.sections) ? active.sections : BUILTIN_PROMPT_SECTIONS;

  return (
    <section className="border border-slate-200 rounded-2xl p-5 space-y-3 min-w-0">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <h3 className="font-black text-slate-900">Prompt versions</h3>
        <button type="button" disabled={busy || !active} onClick={() => setConfirmRollback(true)} className="px-3 py-2 rounded-xl bg-amber-100 text-amber-900 text-xs font-bold disabled:opacity-50">Roll back to previous</button>
      </div>
      {confirmRollback && (
        <div className="flex flex-wrap gap-2 items-center bg-amber-50 text-amber-900 rounded-xl p-3 text-sm">
          <span>Go back from v{active?.version} to the version before it? The bot switches within a minute.</span>
          <button type="button" disabled={busy} onClick={async () => { await post({ action: 'rollback' }); setConfirmRollback(false); }} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold">Yes, roll back</button>
          <button type="button" onClick={() => setConfirmRollback(false)} className="px-3 py-1.5 rounded-lg text-xs font-bold">Cancel</button>
        </div>
      )}
      {!active && <p className="text-xs text-slate-500">The bot is using its built-in instructions.</p>}
      {!prompts.length ? <p className="text-sm text-slate-500">No versions yet. The nightly tuning creates one after new mistakes are approved.</p> : (
        <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[440px] overflow-y-auto">
          {prompts.map(p => {
            const s = splitSummary(p);
            return (
              <div key={p.id} className="grid grid-cols-[44px_minmax(0,1fr)] sm:grid-cols-[52px_minmax(0,1fr)_auto] gap-3 items-center px-3.5 py-3 border-b border-slate-100 last:border-b-0">
                <div className="font-black text-slate-900 tabular-nums">v{p.version}</div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">{s.text}</p>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-1 items-center text-[11px] text-slate-500 mt-0.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${STATUS_CLASS[p.status] || STATUS_CLASS.draft}`}>{STATUS_TEXT[p.status] || p.status}</span>
                    <span>{fmt(p.created_at)}</span><span>Drafted by {s.by}</span>
                    {p.status === 'rejected' && p.rejection_reason && <span>· {p.rejection_reason}</span>}
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5 justify-self-start sm:justify-self-end">
                  <button type="button" onClick={() => setViewing(p)} className={`px-3 py-1.5 rounded-xl text-xs font-bold ${p.status === 'waiting' ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-700'}`}>View changes</button>
                  {/* Owner 2026-10-15: any version can be deleted except the one the bot is using now (roll back first). */}
                  {p.status !== 'active' && (confirmDelete === p.id ? (
                    <span className="flex items-center gap-1 rounded-lg bg-rose-50 px-1.5 py-1">
                      <span className="text-[11px] font-bold text-rose-700">Delete v{p.version}?</span>
                      <button type="button" disabled={busy} onClick={async () => { await post({ action: 'delete_prompt', id: p.id }); setConfirmDelete(null); }} className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">Yes</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md px-2 py-0.5 text-[11px] font-bold text-slate-600">No</button>
                    </span>
                  ) : (
                    <button type="button" aria-label={`Delete version ${p.version}`} title="Delete this version" onClick={() => setConfirmDelete(p.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">🗑</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewing && <VersionViewer p={viewing} base={viewing.status === 'active' ? BUILTIN_PROMPT_SECTIONS : activeSections} baseName={viewing.status === 'active' ? 'the built-in instructions' : active ? `v${active.version}, the version in use now` : 'the built-in instructions in use now'} busy={busy} post={post} onClose={() => setViewing(null)} />}
    </section>
  );
}

type Line = { t: 'add' | 'del' | 'same' | 'sec'; s: string };
/** promptSectionDiff output ("  x" / "+ x" / "- x", with "[steps]" / "[examples]" headers) → typed lines. */
function parseDiff(base: PromptSections, next: PromptSections): Line[] {
  return promptSectionDiff(base, next).split('\n').map(raw => {
    const t = raw.startsWith('+ ') ? 'add' : raw.startsWith('- ') ? 'del' : 'same';
    const s = raw.slice(2);
    return (s === '[steps]' || s === '[examples]') && t === 'same' ? { t: 'sec', s: s === '[steps]' ? 'Steps' : 'Examples' } : { t, s };
  });
}

function VersionViewer({ p, base, baseName, busy, post, onClose }: { p: any; base: PromptSections; baseName: string; busy: boolean; post: Post; onClose: () => void }) {
  const [tab, setTab] = useState<'diff' | 'res'>('diff');
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const lines = validSections(p.sections) ? parseDiff(base, p.sections) : [];
  const changed = lines.filter(l => l.t === 'add' || l.t === 'del').length;
  const keep = lines.map((l, i) => full || l.t !== 'same' || lines.slice(Math.max(0, i - 2), i + 3).some(x => x.t === 'add' || x.t === 'del'));
  const s = splitSummary(p);
  const act = async (action: 'activate' | 'reject') => { const j = await post({ action, id: p.id }); if (j) onClose(); };

  const rendered: React.ReactNode[] = []; let hidden = 0;
  const flush = (k: string) => { if (hidden) { rendered.push(<div key={`gap-${k}`} className="px-3 py-1 bg-slate-50 text-slate-500 text-xs font-semibold border-y border-dashed border-slate-200">{hidden} unchanged line{hidden > 1 ? 's' : ''} hidden</div>); hidden = 0; } };
  lines.forEach((l, i) => {
    if (!keep[i]) { hidden++; return; }
    flush(String(i));
    rendered.push(l.t === 'sec'
      ? <div key={i} className="px-3 py-1.5 bg-slate-100 text-[11px] font-black uppercase tracking-wider text-slate-700">{l.s}</div>
      : <div key={i} className={`grid grid-cols-[22px_minmax(0,1fr)] px-2 py-1 whitespace-pre-wrap break-words ${l.t === 'add' ? 'bg-emerald-50 text-emerald-900' : l.t === 'del' ? 'bg-rose-50 text-rose-900 line-through decoration-1' : 'text-slate-500'}`}>
        <span className="text-center font-bold select-none">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span><span>{l.s}</span></div>);
  });
  flush('end');

  const before = p.eval_before, after = p.eval_after;
  const groups = Array.from(new Set([...Object.keys(before?.byGroup || {}), ...Object.keys(after?.byGroup || {})]));
  const delta = (b?: number, a?: number) => b == null || a == null ? <span className="text-slate-400">—</span> : a > b ? <span className="text-emerald-700 font-bold">+{a - b}</span> : a < b ? <span className="text-rose-700 font-bold">−{b - a}</span> : <span className="text-slate-500">no change</span>;
  const safety = (x: any) => x ? (x.unsafe || 0) + (x.missedClarify || 0) + (x.wrongProposal || 0) : null;
  const passed = after && safety(after) === 0 && p.status !== 'rejected';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 grid place-items-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="pv-title" className="bg-white rounded-2xl w-full max-w-5xl max-h-[calc(100vh-32px)] grid grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden border border-slate-200">
        <div className="flex justify-between gap-3 items-start px-5 pt-4 pb-2">
          <div className="min-w-0">
            <h4 id="pv-title" className="text-lg font-black text-slate-900">v{p.version} · {s.text}</h4>
            <p className="text-sm text-slate-500">{fmt(p.created_at)} · drafted by {s.by} · compared with {baseName}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${STATUS_CLASS[p.status] || STATUS_CLASS.draft}`}>{STATUS_TEXT[p.status] || p.status}</span>
            <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>
        <div role="tablist" className="flex gap-1 px-5 border-b border-slate-200">
          {([['diff', 'What changed', changed], ['res', 'Test results', null]] as const).map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center gap-2 px-3 py-2.5 text-sm font-black border-b-[3px] cursor-pointer ${tab === k ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500'}`}>
              {label}{n != null && <span className="px-1.5 rounded-full text-[11px] bg-slate-100 text-slate-600">{n}</span>}
            </button>
          ))}
        </div>

        <div className="overflow-auto px-5 py-4 space-y-3">
          {tab === 'diff' ? (
            <>
              <div className="flex flex-wrap gap-4 items-center text-sm text-slate-500">
                <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-600" />Added</span>
                <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-rose-100 ring-1 ring-rose-600" />Removed</span>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={full} onChange={e => setFull(e.target.checked)} />Show full text</label>
              </div>
              {!changed && <p className="text-sm text-slate-500">No differences from {baseName}.</p>}
              <div className="border border-slate-200 rounded-xl overflow-hidden font-mono text-[13px] leading-relaxed">{rendered}</div>
            </>
          ) : !before || !after ? (
            <p className="text-sm text-slate-500">No test results saved for this version.</p>
          ) : (
            <>
              <p className={`text-sm rounded-xl p-3 ${passed ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                {passed ? 'Passed the safety test: no safety failures, and no group got worse.' : `Failed the safety test${p.rejection_reason ? `: ${p.rejection_reason}` : '.'}`}
              </p>
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr>
                    <th className="text-left px-3 py-2.5">Test</th><th className="text-right px-3 py-2.5">Before</th><th className="text-right px-3 py-2.5">This version</th><th className="text-right px-3 py-2.5">Change</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="px-3 py-2.5 font-bold">Overall passed</td><td className="text-right px-3">{before.pass} / {before.cases} ({before.passRate}%)</td><td className="text-right px-3">{after.pass} / {after.cases} ({after.passRate}%)</td><td className="text-right px-3">{delta(before.pass, after.pass)}</td></tr>
                    <tr><td className="px-3 py-2.5 font-bold">Safety failures <span className="font-normal text-slate-500">(must be 0)</span></td><td className="text-right px-3">{safety(before)}</td><td className="text-right px-3">{safety(after)}</td><td className="text-right px-3">{safety(after) === 0 ? <span className="text-emerald-700 font-bold">0 ✓</span> : <span className="text-rose-700 font-bold">{safety(after)}</span>}</td></tr>
                    {groups.map(g => <tr key={g}><td className="px-3 py-2.5 capitalize">{g === 'live' ? 'Live (your approved mistakes)' : g} <span className="text-slate-400 text-xs">passed</span></td><td className="text-right px-3">{before.byGroup?.[g] ?? 0}</td><td className="text-right px-3">{after.byGroup?.[g] ?? 0}</td><td className="text-right px-3">{delta(before.byGroup?.[g] ?? 0, after.byGroup?.[g] ?? 0)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <details className="text-xs text-slate-500"><summary className="cursor-pointer">Raw data (for developers)</summary><pre className="mt-2 bg-slate-50 p-2.5 rounded-lg overflow-x-auto text-[11px]">{JSON.stringify({ before, after }, null, 2)}</pre></details>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center px-5 py-3 border-t border-slate-200 bg-slate-50">
          <span className="flex-1 min-w-[180px] text-sm text-slate-500">
            {p.status === 'waiting' ? 'Activating switches the bot to this version within a minute. You can roll back any time.' : p.status === 'active' ? 'This is the version the bot uses now.' : p.status === 'rejected' ? 'Rejected. It never reached the bot.' : STATUS_TEXT[p.status] || p.status}
          </span>
          {p.status === 'waiting' ? <>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500">Close</button>
            <button type="button" disabled={busy} onClick={() => act('reject')} className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold">Reject</button>
            <button type="button" disabled={busy} onClick={() => act('activate')} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Activate v{p.version}</button>
          </> : <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">Close</button>}
        </div>
      </div>
    </div>
  );
}
