'use client';

import React, { useState } from 'react';
import { Sparkles, Loader2, X } from 'lucide-react';

/**
 * "What changed here?" — calls POST /api/electricity/tracker/explain for one bill or one
 * reconciliation month and shows the answer inline. Never calls on mount: the request only
 * fires on click, and the route itself caches per subject so a second click on an
 * unchanged figure costs nothing.
 *
 * Renders nothing extra when the AI assist is not provisioned (no OPENAI_API_KEY) beyond a
 * disabled affordance — this must never claim to explain something it cannot.
 */

interface Props {
    orgId: string;
    billId?: string;
    reconciliationMonth?: string; // 'YYYY-MM'
    label?: string;
}

export default function ElectricityExplainButton({ orgId, billId, reconciliationMonth, label = 'Explain' }: Props) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [text, setText] = useState<string | null>(null);
    const [notProvisioned, setNotProvisioned] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    async function run() {
        setOpen(true);
        if (text || notProvisioned) return; // already fetched (or cached failure) this mount
        setLoading(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/electricity/tracker/explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org_id: orgId, bill_id: billId, reconciliation_month: reconciliationMonth }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not fetch the explanation');
            if (payload.provisioned === false) { setNotProvisioned(true); return; }
            if (!payload.explanation) { setErrorMsg(payload.error || 'No explanation available'); return; }
            setText(payload.explanation as string);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Could not fetch the explanation');
        } finally {
            setLoading(false);
        }
    }

    return (
        <span className="relative inline-block">
            <button
                onClick={run}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border border-border text-text-secondary hover:text-primary hover:border-primary transition-colors"
                title="Explain with AI"
            >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {label}
            </button>

            {open && (loading || text || notProvisioned || errorMsg) && (
                <div
                    className="absolute z-20 right-0 mt-1.5 w-72 rounded-xl border border-border bg-surface shadow-xl p-3 text-left"
                >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.1em] text-primary flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> AI assist
                        </p>
                        <button onClick={() => setOpen(false)} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {loading && <p className="text-xs font-semibold text-text-tertiary">Thinking…</p>}
                    {!loading && notProvisioned && (
                        <p className="text-xs font-semibold text-text-tertiary">AI assist is not configured for this deployment.</p>
                    )}
                    {!loading && errorMsg && (
                        <p className="text-xs font-semibold" style={{ color: 'var(--error)' }}>{errorMsg}</p>
                    )}
                    {!loading && text && (
                        <p className="text-xs font-semibold text-text-secondary leading-relaxed">{text}</p>
                    )}
                </div>
            )}
        </span>
    );
}
