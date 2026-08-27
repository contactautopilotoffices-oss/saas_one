'use client';

/**
 * CouncilBrief — the council's output as a briefing, not a data dump.
 *
 * The transcript and findings panes show what the council SAID. This shows what
 * the organisation must DO. Everything below is deliberately the same four
 * questions, in the same order, for every finding:
 *
 *     ALERTS            what is on fire right now, as counts
 *     KEY ISSUE         the finding, stated once, in plain language
 *     EVIDENCE          the numbers behind it, so it can be argued with
 *     MEASURE TO TAKE   the specific action, not "improve visibility"
 *     SPOC              the named person who owns it, and by when
 *
 * The SPOC comes from council_assignments (backend/lib/council/dispatch.ts),
 * which routes each finding through workflow_spoc_rules and falls back to role.
 * A finding with no owner is rendered as an explicit gap rather than left blank —
 * an unowned P0 is the single most important thing on this screen.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleAlert, Info, UserRound, CalendarClock, FileDown, ShieldQuestion } from 'lucide-react';
import type { CouncilAgent, CouncilAssignment, CouncilFinding, Severity } from './fixtures';

const SEV_ORDER: Severity[] = ['P0', 'P1', 'P2'];

const SEV_META: Record<Severity, { label: string; icon: typeof AlertTriangle; ink: string; tint: string }> = {
    P0: { label: 'Critical — act this week', icon: AlertTriangle, ink: 'var(--council-p0-fill)', tint: 'color-mix(in srgb, var(--error) 9%, #fff)' },
    P1: { label: 'Structural — will worsen',  icon: CircleAlert,   ink: 'var(--council-p1-ink)',  tint: 'color-mix(in srgb, var(--warning) 11%, #fff)' },
    P2: { label: 'Hygiene',                   icon: Info,          ink: 'var(--council-p2-ink)',  tint: 'color-mix(in srgb, var(--primary) 8%, #fff)' },
};

const fmtDue = (iso: string | null): { text: string; overdue: boolean } => {
    if (!iso) return { text: 'no due date', overdue: false };
    const due = new Date(iso).getTime();
    const overdue = due < Date.now();
    const text = new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    return { text: overdue ? `overdue — was due ${text}` : `due ${text}`, overdue };
};

/** One counter in the alert strip. Severity is encoded by shape AND colour. */
function AlertStat({ n, label, tone, icon: Icon }: {
    n: number; label: string; tone: string; icon: typeof AlertTriangle;
}) {
    const muted = n === 0;
    return (
        <div
            style={{
                flex: '1 1 140px', minWidth: 140, padding: '12px 14px',
                borderRadius: 12, background: 'var(--council-surface-1)',
                boxShadow: 'var(--council-elev-2)',
                opacity: muted ? 0.55 : 1,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon size={13} style={{ color: muted ? 'var(--council-ink-4)' : tone, flex: 'none' }} />
                <span style={{
                    fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--council-ink-3)',
                }}>{label}</span>
            </div>
            <div style={{
                marginTop: 4, fontSize: 26, fontWeight: 700, lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
                color: muted ? 'var(--council-ink-4)' : tone,
            }}>{n}</div>
        </div>
    );
}

/** Small uppercase section label used inside every issue card. */
function FieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
            color: 'var(--council-ink-3)', marginBottom: 3,
        }}>{children}</div>
    );
}

function IssueCard({ finding, agent, assignment }: {
    finding: CouncilFinding;
    agent: CouncilAgent | undefined;
    assignment: CouncilAssignment | undefined;
}) {
    const meta = SEV_META[finding.severity] ?? SEV_META.P2;
    const Icon = meta.icon;
    const due = fmtDue(assignment?.due_at ?? null);
    const owner = assignment?.assignee?.full_name || assignment?.assignee?.email || null;
    const unowned = !owner;

    return (
        <article
            style={{
                borderRadius: 14,
                background: 'var(--council-surface-2)',
                boxShadow: 'var(--council-elev-3)',
                padding: '14px 16px 15px',
                borderLeft: `3px solid ${meta.ink}`,
            }}
        >
            {/* Severity + which lens raised it */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 7px', borderRadius: 4, background: meta.tint,
                    color: meta.ink, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                }}>
                    <Icon size={10} />{finding.severity}
                </span>
                {agent && (
                    <span style={{ fontSize: 11, color: 'var(--council-ink-3)' }}>
                        <span style={{ color: agent.color, fontWeight: 700 }}>●</span>{' '}
                        {agent.name} · {agent.title}
                    </span>
                )}
            </div>

            {/* KEY ISSUE */}
            <h4 style={{
                margin: '9px 0 0', fontFamily: 'var(--font-display)',
                fontSize: 15, fontWeight: 700, lineHeight: 1.3,
                color: 'var(--council-ink-1)', textWrap: 'balance',
            }}>{finding.title}</h4>

            {finding.detail && (
                <p style={{
                    margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.55,
                    color: 'var(--council-ink-2)',
                }}>{finding.detail}</p>
            )}

            {/* MEASURE TO BE TAKEN */}
            {finding.recommendation && (
                <div style={{
                    marginTop: 11, padding: '9px 11px', borderRadius: 9,
                    background: 'color-mix(in srgb, var(--primary) 6%, #fff)',
                    borderLeft: '2px solid var(--primary)',
                }}>
                    <FieldLabel>Measure to be taken</FieldLabel>
                    <p style={{
                        margin: 0, fontSize: 12.5, lineHeight: 1.5,
                        color: 'var(--council-ink-1)', fontWeight: 500,
                    }}>{finding.recommendation}</p>
                </div>
            )}

            {/* SPOC — underlined, because this is the line that makes it somebody's job */}
            <div style={{
                marginTop: 11, paddingTop: 10, borderTop: '1px solid var(--council-hairline)',
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {unowned
                        ? <ShieldQuestion size={13} style={{ color: 'var(--council-p0-fill)', flex: 'none' }} />
                        : <UserRound size={13} style={{ color: 'var(--council-ink-3)', flex: 'none' }} />}
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--council-ink-3)' }}>
                        SPOC
                    </span>
                    {unowned ? (
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--council-p0-fill)' }}>
                            Unassigned — nobody owns this
                        </span>
                    ) : (
                        <span style={{
                            fontSize: 12.5, fontWeight: 700, color: 'var(--council-ink-1)',
                            textDecoration: 'underline', textUnderlineOffset: '3px',
                            textDecorationThickness: '1.5px',
                            textDecorationColor: 'color-mix(in srgb, var(--primary) 55%, transparent)',
                        }}>{owner}</span>
                    )}
                    {assignment?.assigned_role && (
                        <span style={{ fontSize: 11, color: 'var(--council-ink-3)' }}>
                            ({assignment.assigned_role.replace(/_/g, ' ')})
                        </span>
                    )}
                </div>

                {assignment && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarClock size={12} style={{
                            color: due.overdue ? 'var(--council-p0-fill)' : 'var(--council-ink-3)', flex: 'none',
                        }} />
                        <span style={{
                            fontSize: 11.5, fontVariantNumeric: 'tabular-nums',
                            color: due.overdue ? 'var(--council-p0-fill)' : 'var(--council-ink-3)',
                            fontWeight: due.overdue ? 700 : 500,
                        }}>{due.text}</span>
                    </div>
                )}
            </div>
        </article>
    );
}

export default function CouncilBrief({
    findings,
    agents,
    sessionId,
    previewAssignments,
}: {
    findings: CouncilFinding[];
    agents: CouncilAgent[];
    sessionId?: string | null;
    /** Injected by the /cc-preview harness so the brief renders without network. */
    previewAssignments?: CouncilAssignment[];
}) {
    const [assignments, setAssignments] = useState<CouncilAssignment[]>(previewAssignments ?? []);
    const [dispatchNote, setDispatchNote] = useState<string | null>(null);

    useEffect(() => {
        if (previewAssignments) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/council/assignments?status=all');
                if (!res.ok) {
                    // Most likely the dispatch migration has not been applied. Say so
                    // plainly rather than rendering every finding as ownerless.
                    const body = await res.json().catch(() => ({}));
                    if (!cancelled) setDispatchNote(body?.hint || body?.error || 'Assignments unavailable');
                    return;
                }
                const data = await res.json();
                if (!cancelled) setAssignments(data.assignments ?? []);
            } catch {
                if (!cancelled) setDispatchNote('Assignments unavailable — routing has not run yet.');
            }
        })();
        return () => { cancelled = true; };
    }, [previewAssignments]);

    const byFinding = useMemo(() => {
        const m = new Map<string, CouncilAssignment>();
        for (const a of assignments) m.set(a.finding_id, a);
        return m;
    }, [assignments]);

    const agentByKey = useMemo(() => {
        const m = new Map<string, CouncilAgent>();
        for (const a of agents) m.set(a.key, a);
        return m;
    }, [agents]);

    const open = useMemo(
        () => findings.filter(f => f.status === 'open' || f.status === 'acked'),
        [findings],
    );

    const grouped = useMemo(() => {
        const g: Record<Severity, CouncilFinding[]> = { P0: [], P1: [], P2: [] };
        for (const f of open) (g[f.severity] ?? g.P2).push(f);
        return g;
    }, [open]);

    const stats = useMemo(() => {
        let overdue = 0, unassigned = 0;
        const nowMs = Date.now();
        for (const f of open) {
            const a = byFinding.get(f.id);
            if (!a || !a.assignee_user_id) unassigned++;
            if (a?.due_at && new Date(a.due_at).getTime() < nowMs && (a.status === 'open' || a.status === 'acked')) overdue++;
        }
        return { critical: grouped.P0.length, overdue, unassigned, total: open.length };
    }, [open, byFinding, grouped]);

    if (!open.length) {
        return (
            <div style={{ padding: '40px 4px', textAlign: 'center', color: 'var(--council-ink-3)', fontSize: 13 }}>
                No open findings. Convene the council to produce a brief.
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* ---------------------------------------------------------- ALERTS */}
            <section>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 9 }}>
                    <h3 style={{
                        margin: 0, fontFamily: 'var(--font-display)', fontSize: 12,
                        fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                        color: 'var(--council-ink-3)',
                    }}>Alerts</h3>
                    {sessionId && (
                        <a
                            href={`/api/council/export?session=${sessionId}&format=pdf`}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                fontSize: 12, fontWeight: 600, color: 'var(--primary)',
                                textDecoration: 'none', padding: '6px 12px', borderRadius: 8,
                                background: 'var(--council-surface-1)', boxShadow: 'var(--council-elev-2)',
                            }}
                        >
                            <FileDown size={13} /> Export brief (PDF)
                        </a>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <AlertStat n={stats.critical}   label="Critical (P0)" tone="var(--council-p0-fill)" icon={AlertTriangle} />
                    <AlertStat n={stats.overdue}    label="Overdue"       tone="var(--council-p1-ink)"  icon={CalendarClock} />
                    <AlertStat n={stats.unassigned} label="Unowned"       tone="var(--council-p0-fill)" icon={ShieldQuestion} />
                    <AlertStat n={stats.total}      label="Open issues"   tone="var(--council-p2-ink)"  icon={Info} />
                </div>
                {dispatchNote && (
                    <p style={{
                        margin: '9px 0 0', fontSize: 11.5, lineHeight: 1.5,
                        color: 'var(--council-p1-ink)',
                    }}>
                        SPOC routing unavailable — {dispatchNote}
                    </p>
                )}
            </section>

            {/* ------------------------------------------- KEY ISSUES + MEASURES */}
            {SEV_ORDER.map(sev => {
                const list = grouped[sev];
                if (!list.length) return null;
                const meta = SEV_META[sev];
                return (
                    <section key={sev}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                            <h3 style={{
                                margin: 0, fontFamily: 'var(--font-display)', fontSize: 12,
                                fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                                color: 'var(--council-ink-3)',
                            }}>
                                Key issues identified
                            </h3>
                            <span style={{
                                fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                background: meta.tint, color: meta.ink, letterSpacing: '0.04em',
                            }}>{sev} · {meta.label} · {list.length}</span>
                            <div style={{ flex: '1 1 auto', height: 1, background: 'var(--council-hairline)' }} />
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                            {list.map(f => (
                                <IssueCard
                                    key={f.id}
                                    finding={f}
                                    agent={agentByKey.get(f.agent_key)}
                                    assignment={byFinding.get(f.id)}
                                />
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
