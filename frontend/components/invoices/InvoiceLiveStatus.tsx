'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * A live, plain-English line for the invoice on a PO: "Reading the invoice…", then either "Matches
 * the PO" or what is wrong and what to do. Shown under the Tax invoice row on the PO's Documents
 * tab, so whoever just uploaded can watch it happen without opening anything.
 *
 * No technical detail on purpose: no rule names, no scores. The exact reasons come from the same
 * plain-language source the Align screen uses.
 */

interface Verdict { state: string; headline?: string; reasons?: string[]; next?: string | null; invoice_number?: string | null }

/** A document uploaded this recently is still on its way into Invoice Control, so "no invoice yet" means "starting". */
const STARTING_WINDOW_MS = 90_000;

export default function InvoiceLiveStatus({ orgId, poId, uploadedAt }: { orgId: string; poId: string; uploadedAt?: string | null }) {
    const [v, setV] = useState<Verdict | null>(null);
    const [tick, setTick] = useState(0);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        let alive = true;
        fetch(`/api/invoices/verdict?${new URLSearchParams({ po_id: poId, org_id: orgId })}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d: Verdict | null) => { if (alive && d) { setV(d); setNow(Date.now()); } })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [orgId, poId, tick]);

    const fresh = !!uploadedAt && now - new Date(uploadedAt).getTime() < STARTING_WINDOW_MS;
    const working = v?.state === 'reading' || (v?.state === 'none' && fresh);

    useEffect(() => {
        if (!working) return;
        const t = setTimeout(() => setTick((n) => n + 1), 2500);
        return () => clearTimeout(t);
    }, [working, tick]);

    if (!v || v.state === 'unavailable') return null;
    if (working) {
        return (
            <p className="flex items-center gap-1.5 text-xs text-text-secondary" role="status">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> {v.state === 'none' ? 'Starting the check…' : 'Reading the invoice and checking it against the PO…'}
            </p>
        );
    }
    if (v.state === 'matched') {
        return <p className="flex items-center gap-1.5 text-xs text-success font-bold" role="status"><CheckCircle2 className="w-3.5 h-3.5" /> Matches the PO{v.invoice_number ? ` · ${v.invoice_number}` : ''}</p>;
    }
    if (v.state === 'none') return null;
    return (
        <div className="text-xs rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2" role="status">
            <p className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {v.headline || 'This invoice needs attention'}{v.invoice_number ? ` · ${v.invoice_number}` : ''}</p>
            {(v.reasons ?? []).length > 0 && (
                <ul className="mt-1 space-y-1 text-amber-900 dark:text-amber-200">{v.reasons!.map((r) => <li key={r} className="leading-snug">· {r}</li>)}</ul>
            )}
            {v.next && <p className="mt-1 font-bold text-amber-900 dark:text-amber-200">{v.next}</p>}
        </div>
    );
}
