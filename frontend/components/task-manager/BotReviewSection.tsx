"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- admin-only review DTOs returned by the guarded bot-learning API */
import React, { useEffect, useRef, useState } from 'react';

/**
 * Bot review upgrade, Phase 3 — "Review mistakes": the conversation, the AI's plain-language guess, and ✅ Correct /
 * ✏️ Fix / Ignore; plus the "Needs a developer" list. Before migration 20261014000001 is applied it falls back to the
 * old labelling (the AI summary needs the new columns).
 */

type Post = (body: any, opts?: { reload?: 'all' | 'side' | 'none'; quiet?: boolean }) => Promise<any | null>;
type Owner = 'learn' | 'developer';
interface Local { summary?: any; done?: 'ok' | 'dev' | 'ignored'; owner?: Owner; loading?: boolean; error?: string; flash?: boolean; deleted?: boolean }

const TRIGGER: Record<string, string> = {
  unknown: 'Bot could not understand',
  repeated_clarify: 'Bot asked a question twice',
  apology: 'Bot had an error',
  correction: 'Said "no, I meant…"',
  undo: 'Used "undo"',
  rephrase: 'Asked again within 2 min',
};
const triggerText = (t: string[] | null | undefined) => (t || []).map(x => TRIGGER[x] || x).join(' · ') || 'Flagged';
const DEV_STATES: Array<[string, string]> = [['new', 'New'], ['in_progress', 'In progress'], ['fixed', 'Fixed']];
const fmt = (iso?: string | null, withDay = true) => {
  if (!iso) return '';
  const d = new Date(iso);
  return withDay ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};
const who = (x: any) => x?.context_snapshot?.sender?.name || 'Unknown person';
const role = (x: any) => [x?.context_snapshot?.sender?.department, x?.context_snapshot?.sender?.role].filter(Boolean).join(' · ');
const titleOf = (x: any) => { const w = String(x?.ai_summary?.wanted || x?.message_text || '').replace(/^To\s+/i, '').replace(/\.$/, ''); return w.charAt(0).toUpperCase() + w.slice(1); };

export default function BotReviewSection({ reviews: allReviews, developerItems, upgraded, busy, post, hasMore, loadOlder }: {
  reviews: any[]; developerItems: any[]; upgraded: boolean; busy: boolean; post: Post; hasMore: boolean; loadOlder: () => void;
}) {
  const [tab, setTab] = useState<'review' | 'dev'>('review');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const reviews = allReviews.filter(r => !deletedIds.has(r.id));
  const [currentId, setCurrentId] = useState<string | null>(reviews[0]?.id ?? null);
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [fixing, setFixing] = useState(false);
  const [fixText, setFixText] = useState('');
  const [devNote, setDevNote] = useState<Record<string, string>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const patch = (id: string, p: Partial<Local>) => setLocal(l => ({ ...l, [id]: { ...l[id], ...p } }));
  const summaryOf = (x: any) => local[x.id]?.summary ?? x.ai_summary ?? null;
  const current = reviews.find(r => r.id === currentId) || reviews[0] || null;
  const waitingCount = reviews.filter(r => !local[r.id]?.done).length;
  const openDev = developerItems.filter(d => d.dev_state !== 'fixed').length;

  /** Ask the AI for a summary (once per item). The next card is prepared in the background too. */
  const ensureSummary = async (x: any, background: boolean) => {
    if (!upgraded || !x || summaryOf(x) || local[x.id]?.done || inFlight.current.has(x.id)) return;
    inFlight.current.add(x.id);
    patch(x.id, { loading: true, error: undefined });
    try {
      const j = await post({ action: 'summarize', id: x.id }, { reload: 'none', quiet: true });
      patch(x.id, { summary: j?.summary, loading: false });
    } catch (e) {
      patch(x.id, { loading: false, error: background ? undefined : (e instanceof Error ? e.message : 'The AI could not write a summary.') });
    } finally { inFlight.current.delete(x.id); }
  };
  useEffect(() => {
    if (!current) return;
    void ensureSummary(current, false).then(() => {
      const next = reviews.find(r => r.id !== current.id && !local[r.id]?.done && !summaryOf(r));
      if (next) void ensureSummary(next, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the shown card changes, not on every local update
  }, [current?.id, upgraded]);

  const select = (id: string) => { setCurrentId(id); setFixing(false); setFixText(''); };
  const nextWaiting = () => reviews.find(r => r.id !== current?.id && !local[r.id]?.done);

  const approve = async () => {
    if (!current) return;
    const owner: Owner = local[current.id]?.owner ?? summaryOf(current)?.owner ?? 'learn';
    const j = await post({ action: 'approve', id: current.id, owner }, { reload: 'side' });
    if (j) patch(current.id, { done: owner === 'learn' ? 'ok' : 'dev' });
  };
  /** Owner 2026-10-15: delete a review item right away (not after 30 days). An approved one is a test and is not deletable. */
  const remove = async (id: string) => {
    const j = await post({ action: 'delete_review', id }, { reload: 'side' });
    setConfirmDelete(null);
    if (!j) return;
    setDeletedIds(s => new Set(s).add(id));
    if (current?.id === id) { const next = reviews.find(r => r.id !== id); setCurrentId(next?.id ?? null); setFixing(false); }
  };
  const ignore = async () => { if (!current) return; const j = await post({ action: 'ignore', id: current.id }, { reload: 'side' }); if (j) patch(current.id, { done: 'ignored' }); };
  const undo = async () => { if (!current) return; const j = await post({ action: 'undo', id: current.id }, { reload: 'side' }); if (j) patch(current.id, { done: undefined }); };
  const rewrite = async () => {
    if (!current || !fixText.trim()) return;
    const j = await post({ action: 'summarize', id: current.id, note: fixText.trim() }, { reload: 'none' });
    if (j?.summary) { patch(current.id, { summary: j.summary, owner: undefined, flash: true, error: undefined }); setFixing(false); setFixText(''); setTimeout(() => patch(current.id, { flash: false }), 900); }
  };
  /** The old five-question labelling, kept only until the review upgrade migration is applied. */
  const legacyLabel = (item: any) => {
    const intent = window.prompt('Correct intent', item.interpretation?.intent || 'unknown'); if (!intent) return;
    const outcome = window.prompt('Correct outcome: ACT, CONFIRM, CLARIFY, REFUSE or HANDOFF', item.interpretation?.outcome || 'CLARIFY'); if (!outcome) return;
    const raw = window.prompt('Expected person/task/date/state details as JSON', '{}'); if (raw === null) return;
    let expect: unknown; try { expect = JSON.parse(raw); } catch { window.alert('Expected details must be valid JSON.'); return; }
    void post({ action: 'label', id: item.id, label: { intent, outcome, expect, mustNotMutate: window.confirm('Safety flag: must this case never mutate data?'), mustClarify: window.confirm('Safety flag: must this case ask a clarifying question?') } });
  };
  const setDevState = async (d: any, state: string) => {
    const j = await post({ action: 'set_dev_state', id: d.id, state }, { reload: 'side' });
    if (j && state === 'fixed') setDevNote(n => ({ ...n, [d.id]: j.testSaved ? 'Now a test the bot must pass.' : "Marked fixed. The AI couldn't write an automatic test for this one." }));
  };

  const tabBtn = (key: 'review' | 'dev', label: string, n: number) => (
    <button type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
      className={`flex items-center gap-2 px-3 py-2.5 text-sm font-black border-b-[3px] whitespace-nowrap cursor-pointer ${tab === key ? (key === 'dev' ? 'border-teal-600 text-slate-900' : 'border-indigo-600 text-slate-900') : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {label}<span className={`px-1.5 rounded-full text-[11px] font-bold ${tab === key ? (key === 'dev' ? 'bg-teal-100 text-teal-800' : 'bg-indigo-100 text-indigo-700') : 'bg-slate-100 text-slate-500'}`}>{n}</span>
    </button>
  );

  return (
    <section className="border border-slate-200 rounded-2xl p-5 space-y-4">
      <h3 className="font-black text-slate-900">Review mistakes</h3>
      {!upgraded && (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">
          AI summaries, the bot&apos;s reply and the developer list need the database update <b>20261014000001_whatsapp_bot_review_upgrade.sql</b>. Until it is applied, the old labelling is used.
        </p>
      )}
      <div role="tablist" className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {tabBtn('review', 'To review', waitingCount)}
        {upgraded && tabBtn('dev', 'Needs a developer', openDev)}
      </div>

      {tab === 'review' && (!reviews.length ? <p className="text-sm text-slate-500 py-6 text-center">Nothing to review right now.</p> : (
        <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
          {/* Queue */}
          <nav aria-label="Messages to review" className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="max-h-[640px] overflow-auto">
              {reviews.map(x => {
                const l = local[x.id];
                const deletable = l?.done !== 'ok' && l?.done !== 'dev';
                return (
                  <div key={x.id} className={`relative border-b border-slate-100 last:border-b-0 border-l-[3px] ${x.id === current?.id ? 'bg-indigo-50 border-l-indigo-600' : 'border-l-transparent hover:bg-slate-50'}`}>
                  {deletable && (confirmDelete === x.id ? (
                    <span className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-white px-1.5 py-1 shadow ring-1 ring-rose-200">
                      <span className="text-[11px] font-bold text-rose-700">Delete?</span>
                      <button type="button" disabled={busy} onClick={() => void remove(x.id)} className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">Yes</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md px-2 py-0.5 text-[11px] font-bold text-slate-600">No</button>
                    </span>
                  ) : (
                    <button type="button" aria-label="Delete this message" title="Delete now" onClick={() => setConfirmDelete(x.id)}
                      className="absolute right-2 top-2 z-10 rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">🗑</button>
                  ))}
                  <button type="button" onClick={() => select(x.id)} aria-current={x.id === current?.id}
                    className="w-full text-left grid gap-1 px-3.5 py-3 pr-9 cursor-pointer">
                    <span className="text-sm font-semibold text-slate-900 truncate">{x.message_text}</span>
                    <span className="text-[11px] text-slate-500">{who(x)} · {fmt(x.created_at)}</span>
                    <span className="flex">
                      {l?.done === 'ok' ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 rounded bg-emerald-100 text-emerald-800">Saved as test</span>
                        : l?.done === 'dev' ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 rounded bg-teal-100 text-teal-800">Sent to developer</span>
                          : l?.done === 'ignored' ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 rounded bg-slate-100 text-slate-500">Ignored</span>
                            : <span className="text-[10px] font-semibold px-2 rounded-full bg-rose-50 text-rose-700 truncate">{triggerText(x.triggers)}</span>}
                    </span>
                  </button>
                  </div>
                );
              })}
            </div>
            {hasMore && <button type="button" disabled={busy} onClick={loadOlder} className="w-full px-3 py-2 bg-slate-50 text-xs font-bold text-slate-600 border-t border-slate-200 cursor-pointer">Load older</button>}
          </nav>

          {/* Card */}
          {current && (() => {
            const l = local[current.id] || {};
            const s = summaryOf(current);
            const owner: Owner = l.owner ?? s?.owner ?? 'learn';
            const isDev = owner === 'developer';
            const next = nextWaiting();
            return (
              <div className="border border-slate-200 rounded-xl min-w-0" aria-live="polite">
                <div className="flex flex-wrap gap-2 justify-between items-center px-4 py-3 border-b border-slate-200">
                  <div><div className="font-black text-slate-900">{who(current)}</div><div className="text-xs text-slate-500">{[role(current), fmt(current.created_at)].filter(Boolean).join(' · ')}</div></div>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700">Caught because: {triggerText(current.triggers)}</span>
                </div>

                <div className="p-4 space-y-2 border-b border-slate-200">
                  <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">Conversation</div>
                  <div className="rounded-xl p-3 space-y-2 bg-[#efeae2]">
                    <Bubble side="user" flag tag="Message reviewed" text={current.message_text} time={fmt(current.created_at, false)} />
                    {current.bot_reply
                      ? <Bubble side="bot" flag tag="Bot reply" text={current.bot_reply} time={fmt(current.created_at, false)} />
                      : <Bubble side="bot" tag="Bot reply" text={upgraded ? 'Reply not saved (older message).' : 'Reply not saved yet (needs the database update).'} muted />}
                    {current.follow_up?.text && <Bubble side="user" text={current.follow_up.text} time={fmt(current.follow_up.at, false)} />}
                  </div>
                  {current.interpretation?.summary && <p className="text-xs text-slate-500">Bot understood: <i>{current.interpretation.summary}</i>{current.interpretation.intent ? ` (${current.interpretation.intent}, ${current.interpretation.outcome})` : ''}</p>}
                </div>

                <div className="p-4 space-y-3">
                  {!upgraded ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => legacyLabel(current)} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">Label</button>
                      <button type="button" disabled={busy} onClick={() => void post({ action: 'ignore', id: current.id })} className="px-3 py-2 rounded-xl bg-slate-200 text-xs font-bold">Ignore</button>
                    </div>
                  ) : !s ? (
                    l.error
                      ? <div className="space-y-2"><p className="text-sm text-rose-700 bg-rose-50 rounded-xl p-3">{l.error}</p>
                        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { patch(current.id, { error: undefined }); void ensureSummary(current, false); }} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Try again</button>
                          <button type="button" disabled={busy} onClick={ignore} className="px-4 py-2 rounded-xl text-slate-500 text-sm font-bold">Ignore</button></div></div>
                      : <p className="text-sm text-slate-500 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />The AI is reading this conversation…</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-indigo-500" />{s.adminNote ? 'AI summary, rewritten from your fix' : "AI's guess of what went wrong"}</div>
                      <dl className={`border border-slate-200 rounded-xl overflow-hidden text-sm transition-colors ${l.flash ? 'bg-amber-50' : ''}`}>
                        <Row label="What the user wanted">{s.wanted}</Row>
                        <Row label="What the bot did">{s.did}</Row>
                        <Row label="The fix" accent>{s.fix}</Row>
                        <Row label="Who can fix it">
                          <div className="inline-flex flex-wrap border border-slate-300 rounded-lg overflow-hidden" role="group" aria-label="Who can fix it">
                            {(['learn', 'developer'] as Owner[]).map(o => (
                              <button key={o} type="button" disabled={!!l.done} aria-pressed={owner === o} onClick={() => patch(current.id, { owner: o })}
                                className={`px-3 py-1.5 text-xs font-bold cursor-pointer ${o === 'developer' ? 'border-l border-slate-300' : ''} ${owner === o ? (o === 'learn' ? 'bg-indigo-600 text-white' : 'bg-teal-600 text-white') : 'bg-white text-slate-500'}`}>
                                {o === 'learn' ? 'Bot can learn this' : 'Needs a developer'}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-slate-500 mt-1.5">{l.owner && l.owner !== s.owner ? (l.owner === 'developer' ? 'You marked this as needing a developer.' : 'You marked this as something the bot can learn.') : s.ownerReason}</p>
                          {owner === 'learn' && !s.test && <p className="text-xs text-amber-800 mt-1">There&apos;s no test for this yet. Use ✏️ Fix to describe the right answer, or send it to a developer.</p>}
                        </Row>
                      </dl>

                      {l.done ? (
                        <div className="space-y-2">
                          <p className={`text-sm rounded-xl p-3 ${l.done === 'ok' ? 'bg-emerald-50 text-emerald-800' : l.done === 'dev' ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>
                            {l.done === 'ok' ? 'Approved. This is now a permanent test the bot must pass.' : l.done === 'dev' ? 'Sent to the developer list. It becomes a test once someone marks it Fixed.' : 'Ignored. It will be deleted after 30 days.'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {l.done !== 'ok' && <button type="button" disabled={busy} onClick={undo} className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-bold">Undo</button>}
                            {l.done === 'ignored' && <button type="button" disabled={busy} onClick={() => void remove(current.id)} className="px-4 py-2 rounded-xl border border-rose-300 text-rose-700 text-sm font-bold">🗑 Delete now</button>}
                            {l.done === 'dev' && <button type="button" onClick={() => setTab('dev')} className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-bold">Open developer list</button>}
                            {next && <button type="button" onClick={() => select(next.id)} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Next message →</button>}
                          </div>
                        </div>
                      ) : fixing ? (
                        <div className="space-y-2">
                          <label htmlFor="bot-review-fix" className="text-[11px] font-black uppercase tracking-wider text-slate-500">What should the bot have done?</label>
                          <textarea id="bot-review-fix" rows={3} value={fixText} onChange={e => setFixText(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm"
                            placeholder="e.g. the user wanted his teammates' carry-forward tasks, the bot should have shown those instead of today's" />
                          <p className="text-xs text-slate-500">Write it the way you&apos;d say it. The AI will rewrite the summary above for you to check again.</p>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={busy || !fixText.trim()} onClick={rewrite} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">{busy ? 'Rewriting…' : 'Rewrite summary'}</button>
                            <button type="button" disabled={busy} onClick={() => setFixing(false)} className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-bold">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          <button type="button" disabled={busy || (owner === 'learn' && !s.test)} onClick={approve} className={`px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50 ${isDev ? 'bg-teal-600' : 'bg-indigo-600'}`}>✅ Correct{isDev ? ' – send to developer' : ''}</button>
                          <button type="button" disabled={busy} onClick={() => setFixing(true)} className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-bold">✏️ Fix</button>
                          <button type="button" disabled={busy} onClick={ignore} className="ml-auto px-4 py-2 rounded-xl text-slate-500 text-sm font-bold">Ignore</button>
                        </div>
                      )}

                      <details className="text-xs text-slate-500">
                        <summary className="cursor-pointer">Exact test the AI will save (for developers)</summary>
                        <pre className="mt-2 bg-slate-50 p-2.5 rounded-lg overflow-x-auto text-[11px]">{s.test ? JSON.stringify(s.test, null, 2) : 'No test: the right answer cannot be written with today\'s test fields.'}{`\n\nWritten by ${s.model}`}</pre>
                      </details>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ))}

      {tab === 'dev' && upgraded && (
        <div className="space-y-3">
          <p className="text-sm bg-teal-50 text-slate-800 rounded-xl p-3 max-w-3xl">Mistakes the bot <b className="text-teal-800">can&apos;t learn by itself</b>: it doesn&apos;t have the feature yet, or the code needs changing. Nightly tuning skips them. When a developer sets one to <b className="text-teal-800">Fixed</b>, it becomes a test the bot must pass from then on. Any Task Manager admin can change the status.</p>
          {!developerItems.length && <p className="text-sm text-slate-500 py-6 text-center">Nothing waiting for a developer.</p>}
          {developerItems.map(d => {
            const s = d.ai_summary || {};
            const state = d.dev_state || 'new';
            return (
              <article key={d.id} className="border border-slate-200 rounded-xl p-4 space-y-2.5 min-w-0">
                <div className="flex flex-wrap justify-between gap-2 items-center">
                  <h4 className="font-black text-slate-900">{titleOf(d)}</h4>
                  <span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full ${state === 'fixed' ? 'bg-emerald-100 text-emerald-800' : state === 'in_progress' ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-800'}`}>{DEV_STATES.find(x => x[0] === state)?.[1]}</span>
                </div>
                <p className="text-sm text-slate-500 border-l-[3px] border-slate-300 pl-2.5 break-words">“{d.message_text}”</p>
                <div className="grid md:grid-cols-3 gap-2 text-sm">
                  <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">User wanted</div>{s.wanted || '—'}</div>
                  <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Bot did</div>{s.did || '—'}</div>
                  <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">What to build or change</div>{s.fix || '—'}</div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 items-center text-xs text-slate-500">
                  <span>From {who(d)} · approved {fmt(d.reviewed_at || d.updated_at)}{d.reviewed_by ? ` by ${d.reviewed_by}` : ''}</span>
                  <label className="flex items-center gap-1.5">Status
                    <select value={state} disabled={busy} onChange={e => void setDevState(d, e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-800 bg-white">
                      {DEV_STATES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  {(devNote[d.id] || (state === 'fixed' && d.status === 'labelled')) && <span className="text-emerald-700">{devNote[d.id] || 'Now a test the bot must pass.'}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Bubble({ side, text, time, tag, flag, muted }: { side: 'user' | 'bot'; text: string; time?: string; tag?: string; flag?: boolean; muted?: boolean }) {
  return (
    <div className={`max-w-[85%] w-fit px-3 pt-2 pb-1.5 rounded-lg shadow-sm text-sm whitespace-pre-wrap break-words ${side === 'user' ? 'ml-auto bg-[#d9fdd3] rounded-tr-sm' : 'bg-white rounded-tl-sm'} ${flag ? 'ring-2 ring-rose-500 ring-offset-1' : ''} ${muted ? 'italic text-slate-500' : 'text-slate-900'}`}>
      {tag && <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-0.5">{tag}</span>}
      {text}
      {time && <span className="block text-right text-[10px] text-slate-500 mt-0.5">{time}</span>}
    </div>
  );
}

function Row({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid sm:grid-cols-[170px_minmax(0,1fr)] gap-1 sm:gap-3 px-3.5 py-3 border-b border-slate-200 last:border-b-0 ${accent ? 'bg-indigo-50' : ''}`}>
      <dt className={`text-xs font-black ${accent ? 'text-indigo-700' : 'text-slate-500'}`}>{label}</dt>
      <dd className="min-w-0 text-slate-900">{children}</dd>
    </div>
  );
}
