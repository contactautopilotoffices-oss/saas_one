"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- this admin-only panel renders versioned JSON DTOs returned by the guarded API */
import React, { useEffect, useState } from 'react';
import { BUILTIN_PROMPT_SECTIONS, promptSectionDiff } from '@/task-manager/brain/prompt';

export default function BotLearningPanel({ orgId }: { orgId?: string }) {
  const [data, setData] = useState<any>({ reviews: [], prompts: [], health: null, alertAdmins: [] });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [alertAdminsText, setAlertAdminsText] = useState('');
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const url = `/api/task-manager/bot-learning?orgId=${encodeURIComponent(orgId || '')}`;
  const load = async () => {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Load failed');
      setData(j);
      setAlertAdminsText((j.alertAdmins || []).map((a: any) => `${a.name}, ${a.phone}`).join('\n'));
      setHasMoreReviews((j.reviews || []).length === 30);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  };
  // Reload only when the selected organisation changes; `load` is intentionally local to this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [orgId]);
  const act = async (body: any) => { setBusy(true); setError(''); try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok || !j.success) throw new Error(j.error || 'Action failed'); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); } };
  const loadOlder = async () => { const before=data.reviews?.[data.reviews.length-1]?.created_at; if(!before)return; setBusy(true); try{const r=await fetch(`${url}&before=${encodeURIComponent(before)}`);const j=await r.json();if(!r.ok||!j.success)throw new Error(j.error||'Load failed');setData((d:any)=>({...d,reviews:[...(d.reviews||[]),...(j.reviews||[])]}));setHasMoreReviews((j.reviews||[]).length===30);}catch(e){setError(e instanceof Error?e.message:'Load failed');}finally{setBusy(false);} };
  const label = (item: any) => { const intent = window.prompt('Correct intent', item.interpretation?.intent || 'unknown'); if (!intent) return; const outcome = window.prompt('Correct outcome: ACT, CONFIRM, CLARIFY, REFUSE or HANDOFF', item.interpretation?.outcome || 'CLARIFY'); if (!outcome) return; const raw = window.prompt('Expected person/task/date/state details as JSON', '{}'); if (raw === null) return; try { act({ action: 'label', id: item.id, label: { intent, outcome, expect: JSON.parse(raw), mustNotMutate: window.confirm('Safety flag: must this case never mutate data?'), mustClarify: window.confirm('Safety flag: must this case ask a clarifying question?') } }); } catch { setError('Expected details must be valid JSON.'); } };
  const h = data.health;
  const activeSections = data.prompts?.find((p:any)=>p.status==='active')?.sections || BUILTIN_PROMPT_SECTIONS;
  return <div className="grid lg:grid-cols-3 gap-4">
    <section className="bg-white border border-slate-200 rounded-3xl p-5 space-y-3"><h3 className="font-black text-slate-900">Bot health</h3>{h ? <><div className="grid grid-cols-2 gap-2 text-xs">{[['Replies',h.replies],['Apologies',h.apologies],['Fallbacks',h.fallbacks],['AI failures',h.aiFailures],['Median reply',h.medianReplyMs == null ? '—' : `${Math.round(h.medianReplyMs/100)/10}s`],['Review waiting',h.reviewWaiting]].map(([k,v])=><div key={String(k)} className="bg-slate-50 rounded-xl p-2"><div className="text-slate-500">{k}</div><b>{v}</b></div>)}</div><p className="text-xs text-slate-600"><b>Last 15 min:</b> {h.window15?.apologies||0} apologies · {h.window15?.aiFailures||0}/{h.window15?.brainMessages||0} AI failures</p></>:<p className="text-xs text-slate-500">Health data needs the Phase 5 migration.</p>}
      <h4 className="text-xs font-black pt-2">Alert recipients</h4>
      <p className="text-[11px] text-slate-500">Enter as &ldquo;Name, Phone&rdquo; (one per line)</p>
      <textarea
        className="w-full border rounded-xl p-2 text-xs"
        rows={3}
        placeholder="Name, Phone"
        value={alertAdminsText}
        onChange={e => setAlertAdminsText(e.target.value)}
      />
      <button
        disabled={busy}
        onClick={() => {
          const parsed = alertAdminsText
            .split(/\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
              const [name, ...p] = line.split(',');
              return { name: name.trim(), phone: p.join(',').trim() };
            });
          act({ action: 'save_alert_admins', admins: parsed });
        }}
        className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
      >
        Save recipients
      </button>
    </section>
    <section className="bg-white border border-slate-200 rounded-3xl p-5 space-y-3"><h3 className="font-black text-slate-900">Learning review <span className="text-xs text-slate-500">({data.reviews?.length||0})</span></h3><div className="space-y-2 max-h-96 overflow-auto">{(data.reviews||[]).map((x:any)=><div key={x.id} className="border rounded-xl p-3 text-xs"><p className="font-semibold">{x.message_text}</p><p className="text-slate-500">{(x.triggers||[]).join(', ')}</p><div className="flex gap-2 mt-2"><button disabled={busy} onClick={()=>label(x)} className="px-2 py-1 bg-emerald-600 text-white rounded-lg">Label</button><button disabled={busy} onClick={()=>act({action:'ignore',id:x.id})} className="px-2 py-1 bg-slate-200 rounded-lg">Ignore</button></div></div>)}</div>{hasMoreReviews&&<button disabled={busy} onClick={loadOlder} className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-bold">Load older</button>}</section>
    <section className="bg-white border border-slate-200 rounded-3xl p-5 space-y-3"><h3 className="font-black text-slate-900">Prompt versions</h3><button disabled={busy} onClick={()=>act({action:'rollback'})} className="px-3 py-2 rounded-xl bg-amber-100 text-amber-900 text-xs font-bold">Roll back previous</button><div className="space-y-2 max-h-96 overflow-auto">{(data.prompts||[]).map((p:any)=><div key={p.id} className="border rounded-xl p-3 text-xs"><div className="font-bold">v{p.version} · {p.status}</div><p>{p.change_summary||'No summary'}</p><details><summary className="cursor-pointer font-semibold">Text diff and scores</summary><pre className="text-[10px] whitespace-pre-wrap bg-slate-50 p-2 rounded-lg max-h-40 overflow-auto">{promptSectionDiff(activeSections,p.sections)}{`\n\nScores\n${JSON.stringify({before:p.eval_before,after:p.eval_after},null,2)}`}</pre></details>{p.status==='waiting'&&<div className="flex gap-2"><button disabled={busy} onClick={()=>act({action:'activate',id:p.id})} className="px-2 py-1 bg-indigo-600 text-white rounded-lg">Activate</button><button disabled={busy} onClick={()=>act({action:'reject',id:p.id})} className="px-2 py-1 bg-slate-200 rounded-lg">Reject</button></div>}</div>)}</div></section>
    {error&&<div className="lg:col-span-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">{error}</div>}
  </div>;
}
