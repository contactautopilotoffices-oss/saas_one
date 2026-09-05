'use client';

/**
 * FIRST-RUN PREVIEW — "here is the email it would have sent this morning."
 *
 * The trust step. Everything before this is a description of what an agent will
 * do; this is the artefact itself, produced by the real scan against real data,
 * with nothing sent.
 *
 * It matters because the failure mode of a scheduled agent is silent: it either
 * mails something wrong to your CEO, or mails nothing and looks healthy. Seeing
 * the actual output before promotion is the only cheap way to tell which.
 *
 * The recipient switcher is the point, not a convenience — the same run produces
 * a different email per person, and "did Saniel get a to-do list?" is exactly
 * the question this answers.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Mail, RefreshCw } from 'lucide-react';

type Recipient = 'ceo' | 'procurement' | 'technical';
type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly';

const RECIPIENTS: Array<{ key: Recipient; label: string }> = [
    { key: 'ceo', label: 'Decisions (CEO)' },
    { key: 'procurement', label: 'Actions (procurement)' },
    { key: 'technical', label: 'Technical' },
];

export default function AgentFirstRun({ orgId }: { orgId: string; agentKey?: string }) {
    const [recipient, setRecipient] = useState<Recipient>('procurement');
    const [cadence, setCadence] = useState<Cadence>('daily');
    const [html, setHtml] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await fetch(
                `/api/ira/procurement-digest?orgId=${encodeURIComponent(orgId)}&recipient=${recipient}&cadence=${cadence}`,
                { cache: 'no-store' },
            );
            const text = await res.text();
            if (!res.ok) { setError(text.slice(0, 300)); setHtml(null); return; }
            setHtml(text);
        } catch (e) {
            setError((e as Error).message);
        } finally { setLoading(false); }
    }, [orgId, recipient, cadence]);

    useEffect(() => { void load(); }, [load]);

    return (
        <div className="rounded-[16px] border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                        <Eye className="h-3.5 w-3.5" /> The first run, before it is one
                    </h4>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-secondary">
                        A real scan against real data. Nothing is sent, and the run is recorded as a
                        rehearsal so it never counts toward this agent&rsquo;s score.
                    </p>
                </div>
                <button type="button" onClick={() => void load()} disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] text-text-secondary hover:text-foreground disabled:opacity-40">
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Run again
                </button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-1.5">
                    {RECIPIENTS.map((r) => (
                        <button key={r.key} type="button" onClick={() => setRecipient(r.key)}
                            className={`rounded-md border px-2.5 py-1 text-[12.5px] font-medium ${
                                recipient === r.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-text-secondary hover:text-foreground'
                            }`}>
                            {r.label}
                        </button>
                    ))}
                </div>
                <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}
                    className="rounded-md border border-border bg-card px-2.5 py-1 text-[12.5px]">
                    {(['daily', 'weekly', 'monthly', 'quarterly'] as Cadence[]).map((c) => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
            </div>

            {error && (
                <p className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>
            )}

            {/* Sandboxed: this is agent-generated HTML and must not run script or
                navigate the console, however much we trust our own renderer. */}
            {html && (
                <div className="overflow-hidden rounded-[12px] border border-border">
                    <iframe
                        title="First run preview"
                        sandbox=""
                        srcDoc={html}
                        className="h-[520px] w-full bg-white"
                    />
                </div>
            )}

            {!loading && !error && html && html.includes('Nothing for') && (
                <p className="mt-3 rounded-[10px] border border-border bg-card-tint px-3 py-2 text-[12.5px] leading-relaxed text-text-secondary">
                    <Mail className="mr-1 inline h-3.5 w-3.5" />
                    No email for this person in this window. That is a real answer, not a failure —
                    someone with nothing to do gets nothing.
                </p>
            )}
        </div>
    );
}
