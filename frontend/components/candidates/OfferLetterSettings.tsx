'use client';

import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, qs } from './api';
import { Spinner, useUi } from './ui';
import { K_BTN, K_BTN_PRIMARY, K_AREA, K_CARD, Loading } from './page-kit';

/*
 * Recruitment -> Configurations: the offer letter template (owner 2026-11-21; spec: "templates are editable by HR";
 * "an unfilled placeholder blocks release"). Blanks: {{candidate_name}}, {{role}}, {{company}}, {{location}}, {{ctc}},
 * {{joining_date}}, {{recruiter_name}}. Empty: the built-in letter.
 */
export default function OfferLetterSettings({ orgId }: { orgId: string }) {
    const { notify } = useUi();
    const [saved, setSaved] = useState<string | null>(null);
    const [fallback, setFallback] = useState('');
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ letter: string; fallback: string }>(`/api/candidates/offer-letter${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted || !res.ok) return;
            setSaved(res.data.letter);
            setFallback(res.data.fallback);
            setText(res.data.letter || res.data.fallback);
        });
        return () => ctrl.abort();
    }, [orgId]);
    const current = saved || fallback;
    const dirty = saved !== null && text.trim() !== current.trim();
    const save = async () => {
        setBusy(true);
        const res = await api<{ letter: string }>('/api/candidates/offer-letter', { method: 'PUT', json: { orgId, letter: text.trim() === fallback.trim() ? '' : text } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        setSaved(res.data.letter);
        notify('Offer letter saved', 'success');
    };
    return (
        <section className={`${K_CARD} px-5 py-5`} aria-label="Offer letter">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-text-primary">Offer letter</h2>
                    <p className="mt-1 max-w-[75ch] text-sm text-text-tertiary">Filled in when an offer is approved; HR checks it before releasing. Blanks: <code className="rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{'{{candidate_name}}'}</code> <code className="rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{'{{role}}'}</code> <code className="rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{'{{company}}'}</code> <code className="rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{'{{location}}'}</code> <code className="rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{'{{ctc}}'}</code> <code className="rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{'{{joining_date}}'}</code> <code className="rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{'{{recruiter_name}}'}</code>. A blank the app cannot fill stays in the letter and blocks the release until HR fills it.</p>
                </div>
                <div className="flex items-center gap-x-2">
                    <button type="button" onClick={() => setText(current)} disabled={!dirty || busy} className={K_BTN}><RotateCcw className="h-4 w-4" />Discard</button>
                    <button type="button" onClick={() => void save()} disabled={!dirty || busy || !text.trim()} className={K_BTN_PRIMARY}>{busy && <Spinner />}Save letter</button>
                </div>
            </div>
            {saved === null ? <Loading />
                : <textarea aria-label="Offer letter template" rows={14} value={text} onChange={e => setText(e.target.value)} maxLength={20000} className={`${K_AREA} mt-4 font-mono text-[13px]`} />}
        </section>
    );
}
