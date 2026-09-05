'use client';

/**
 * PREFLIGHT — the one panel that answers "why isn't this agent working?"
 *
 * Everything needed to go live was spread across six tabs, three env vars, a
 * migration and a Zoho console. This is that list in one place, with the single
 * next action beside anything that fails.
 *
 * BLOCKING is drawn loudest, but ADVISORY is the more dangerous state and is
 * said so: a blocked agent visibly does nothing, whereas an advisory one runs,
 * looks healthy, and quietly does less than you think.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, HelpCircle, Loader2, RefreshCw, XCircle } from 'lucide-react';

type CheckState = 'ok' | 'blocking' | 'advisory' | 'unknown';
interface Row { key: string; label: string; state: CheckState; detail: string; fix?: string }
interface Payload { checks: Row[]; canRun: boolean; canSend: boolean; summary: string }

const TONE: Record<CheckState, { Icon: typeof Check; cls: string; ring: string }> = {
    ok:       { Icon: Check,         cls: 'text-emerald-600', ring: 'border-border' },
    blocking: { Icon: XCircle,       cls: 'text-rose-600',    ring: 'border-rose-200 bg-rose-50/40' },
    advisory: { Icon: AlertTriangle, cls: 'text-amber-600',   ring: 'border-amber-200 bg-amber-50/40' },
    unknown:  { Icon: HelpCircle,    cls: 'text-text-tertiary', ring: 'border-border' },
};

export default function AgentPreflight({ orgId, agentKey }: { orgId: string; agentKey: string }) {
    const [data, setData] = useState<Payload | null>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch(
                `/api/agents/preflight?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}`,
                { cache: 'no-store' },
            );
            setData((await res.json()) as Payload);
        } finally { setLoading(false); }
    };
    useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId, agentKey]);

    if (loading && !data) {
        return (
            <div className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3 text-[13px] text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what this agent needs…
            </div>
        );
    }
    if (!data) return null;

    const blocking = data.checks.filter((c) => c.state === 'blocking').length;

    return (
        <div className="rounded-[16px] border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h4 className="text-[13px] font-semibold text-foreground">
                        {blocking ? 'Not ready yet' : data.canSend ? 'Ready — it will run and send' : 'Ready to run'}
                    </h4>
                    <p className="mt-0.5 text-[12.5px] text-text-secondary">{data.summary}</p>
                </div>
                <button type="button" onClick={() => void load()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] text-text-secondary hover:text-foreground">
                    <RefreshCw className="h-3.5 w-3.5" /> Re-check
                </button>
            </div>

            <ul className="space-y-1.5">
                {data.checks.map((c) => {
                    const t = TONE[c.state];
                    const Icon = t.Icon;
                    return (
                        <li key={c.key} className={`flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${t.ring}`}>
                            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.cls}`} />
                            <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-foreground">{c.label}</p>
                                <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-secondary">{c.detail}</p>
                                {c.fix && (
                                    <p className="mt-1 text-[12.5px] font-medium text-primary">→ {c.fix}</p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>

            {!data.canSend && data.canRun && (
                <p className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800">
                    It will run, but it will not mail anyone. That is the state worth watching — a
                    silent agent looks identical to a healthy one.
                </p>
            )}
        </div>
    );
}
