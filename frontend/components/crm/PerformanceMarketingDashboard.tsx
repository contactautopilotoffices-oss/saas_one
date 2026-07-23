'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import ChannelSwitch from '@/frontend/components/crm/ChannelSwitch';
import {
    Loader2, AlertCircle, TrendingUp, TrendingDown, Target, DollarSign,
    Users, MousePointerClick, Eye, Award, AlertTriangle, Zap, ArrowRight,
    Calendar, Filter, ChevronRight, Lightbulb, Activity,
} from 'lucide-react';
import {
    campaignInsights, portfolioInsights, kpiMicroInsight,
    type PerformancePayload, type CampaignPerf, type PortfolioInsight,
} from '@/backend/services/campaignAiEngine';

// ── Inline style tokens (no global CSS) ─────────────────────────────────────
const C = {
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    textPrimary: '#0F172A',
    textSecondary: '#64748B',
    textTertiary: '#94A3B8',
    primary: '#4F46E5',
    primarySoft: '#EEF2FF',
    success: '#16A34A',
    successSoft: '#DCFCE7',
    warn: '#D97706',
    warnSoft: '#FEF3C7',
    danger: '#DC2626',
    dangerSoft: '#FEE2E2',
    info: '#0284C7',
    infoSoft: '#E0F2FE',
};

const SEVERITY_BG = ['#DCFCE7', '#E0F2FE', '#FEF3C7', '#FEE2E2', '#FEE2E2'];
const SEVERITY_FG = ['#166534', '#075985', '#92400E', '#991B1B', '#7F1D1D'];
const SEVERITY_LABEL = ['good', 'info', 'watch', 'warning', 'critical'];

function toDate(d: Date) { return d.toISOString().slice(0, 10); }

function fmtINR(n: number): string {
    if (!n) return '₹0';
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
    if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
function fmtNum(n: number): string { return (n || 0).toLocaleString('en-IN'); }
function fmtPct(n: number | null): string { return n == null ? '—' : `${n.toFixed(1)}%`; }

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PerformanceMarketingDashboard() {
    const params = useParams();
    const orgId = params?.orgId as string;

    const today = new Date();
    const defaultFrom = toDate(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const defaultTo = toDate(today);

    const [from, setFrom] = useState(defaultFrom);
    const [to, setTo] = useState(defaultTo);
    const [channelFilter, setChannelFilter] = useState<string>('');
    const [data, setData] = useState<PerformancePayload | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);

    const q = useCallback((p: string) =>
        `${p}${p.includes('?') ? '&' : '?'}org_id=${orgId}`, [orgId]);

    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;
        (async () => {
            setIsLoading(true); setError(null);
            try {
                const sp = new URLSearchParams({ from, to });
                if (channelFilter) sp.set('channel', channelFilter);
                const res = await fetch(q(`/api/crm/campaigns/performance?${sp}`), { cache: 'no-store' });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j.error || `HTTP ${res.status}`);
                }
                const json = await res.json();
                if (!cancelled) setData(json);
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Failed to load');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [orgId, from, to, channelFilter, q]);

    const insights = useMemo<PortfolioInsight[]>(() => {
        if (!data) return [];
        return portfolioInsights(data).sort((a, b) => b.severity - a.severity);
    }, [data]);

    const topInsight = insights[0];

    if (isLoading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <Loader2 style={{ width: 32, height: 32, color: C.primary, animation: 'spin 1s linear infinite' }} />
            </div>
        );
    }
    if (error) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 24 }}>
                <div style={{ textAlign: 'center', maxWidth: 420 }}>
                    <AlertCircle style={{ width: 40, height: 40, color: C.danger, margin: '0 auto 12px' }} />
                    <p style={{ color: C.danger, fontWeight: 600 }}>{error}</p>
                </div>
            </div>
        );
    }
    if (!data) return null;

    const { kpis, campaigns, daily_spend, source_breakdown, city_breakdown, by_channel } = data;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '0 0 60px' }}>
            {/* ── Header + AI banner ───────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 800, color: C.textPrimary, margin: 0 }}>
                        Performance Marketing
                    </h1>
                    <p style={{ fontSize: 13, color: C.textSecondary, margin: '4px 0 0' }}>
                        Campaign intelligence · {campaigns.length} active · AI-assisted
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                        style={inputStyle} />
                    <span style={{ color: C.textTertiary }}>→</span>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                        style={inputStyle} />
                    <ChannelSwitch
                        value={(channelFilter || 'all') as any}
                        onChange={(v) => setChannelFilter(v === 'all' ? '' : v)}
                    />
                </div>
            </div>

            {/* ── AI Top Banner ─────────────────────────────────────────────── */}
            {topInsight && (
                <AiBanner insight={topInsight} totalInsights={insights.length} />
            )}

            {/* ── KPI Strip with AI micro-insights ──────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <KpiTile
                    icon={<DollarSign style={iconSm} />}
                    label="Total Spend"
                    value={fmtINR(kpis.total_spend)}
                    micro={kpiMicroInsight('spend', data)}
                    tone="spend"
                    insights={insights.filter((i) => i.targetKpi === 'spend')}
                />
                <KpiTile
                    icon={<Users style={iconSm} />}
                    label="Leads"
                    value={fmtNum(kpis.total_leads)}
                    micro={kpiMicroInsight('leads', data)}
                    tone="leads"
                    insights={insights.filter((i) => i.targetKpi === 'leads')}
                />
                <KpiTile
                    icon={<Target style={iconSm} />}
                    label="CPL"
                    value={kpis.cpl > 0 ? fmtINR(Math.round(kpis.cpl)) : '—'}
                    micro={kpiMicroInsight('cpl', data)}
                    tone="cpl"
                    insights={insights.filter((i) => i.targetKpi === 'cpl')}
                />
                <KpiTile
                    icon={<Award style={iconSm} />}
                    label="CPA"
                    value={kpis.cpa > 0 ? fmtINR(Math.round(kpis.cpa)) : '—'}
                    micro={kpiMicroInsight('cpa', data)}
                    tone="cpa"
                    insights={insights.filter((i) => i.targetKpi === 'cpa')}
                />
                <KpiTile
                    icon={<TrendingUp style={iconSm} />}
                    label="ROI"
                    value={fmtPct(kpis.roi)}
                    micro={kpiMicroInsight('roi', data)}
                    tone="roi"
                    insights={insights.filter((i) => i.targetKpi === 'roi')}
                />
                <KpiTile
                    icon={<Zap style={iconSm} />}
                    label="Win Rate"
                    value={fmtPct(kpis.win_rate)}
                    micro={kpiMicroInsight('win_rate', data)}
                    tone="win"
                    insights={insights.filter((i) => i.targetKpi === 'win_rate')}
                />
                <KpiTile
                    icon={<Activity style={iconSm} />}
                    label="Pipeline"
                    value={fmtINR(kpis.total_pipeline)}
                    micro={kpiMicroInsight('pipeline', data)}
                    tone="pipeline"
                    insights={insights.filter((i) => i.targetKpi === 'pipeline')}
                />
                <KpiTile
                    icon={<MousePointerClick style={iconSm} />}
                    label="CTR"
                    value={fmtPct(kpis.ctr)}
                    sub={kpis.total_impressions > 0 ? `${fmtNum(kpis.total_impressions)} impr · ${fmtNum(kpis.total_clicks)} clicks` : 'awaiting Meta sync'}
                    micro={kpiMicroInsight('ctr', data)}
                    tone="ctr"
                    insights={insights.filter((i) => i.targetKpi === 'meta_sync')}
                />
            </div>

            {/* ── Daily spend trend ──────────────────────────────────────────── */}
            <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, margin: 0 }}>
                        Daily Spend Trend
                    </h3>
                    <span style={{ fontSize: 11, color: C.textTertiary }}>
                        {daily_spend.length} days · peak {daily_spend.length ? fmtINR(Math.max(...daily_spend.map((d) => d.amount))) : '—'}
                    </span>
                </div>
                <Sparkline data={daily_spend.map((d) => d.amount)} height={56} color={C.primary} />
            </div>

            {/* ── Main table + side panels ──────────────────────────────────── */}
            {/* ── Blended channel performance (cross-channel report) ─────────── */}
            {by_channel && by_channel.length > 0 && (
                <div style={cardStyle}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, margin: '0 0 4px' }}>
                        Channel Performance
                    </h3>
                    <p style={{ fontSize: 12, color: C.textTertiary, margin: '0 0 12px' }}>Blended across all ad channels</p>
                    <ChannelPerformanceTable rows={by_channel} />
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
                <div style={cardStyle}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, margin: '0 0 12px' }}>
                        Campaign Performance
                    </h3>
                    {campaigns.length === 0 ? (
                        <p style={{ color: C.textSecondary, fontSize: 13, padding: 24, textAlign: 'center' }}>
                            No campaigns in this window. Create one in <strong>Spend</strong> tab.
                        </p>
                    ) : (
                        <CampaignTable
                            campaigns={campaigns}
                            expanded={expanded}
                            onToggle={(id) => setExpanded(expanded === id ? null : id)}
                        />
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* AI insight list */}
                    <div style={cardStyle}>
                        <h3 style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Lightbulb style={{ width: 14, height: 14, color: C.warn }} />
                            AI Recommendations
                        </h3>
                        {insights.length === 0 ? (
                            <p style={{ fontSize: 12, color: C.textSecondary, margin: 0 }}>
                                Portfolio looks healthy.
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {insights.slice(0, 6).map((i, idx) => (
                                    <InsightRow key={idx} insight={i} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Source breakdown */}
                    <div style={cardStyle}>
                        <h3 style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, margin: '0 0 10px' }}>
                            Leads by Source
                        </h3>
                        {source_breakdown.length === 0 ? (
                            <p style={{ fontSize: 12, color: C.textSecondary, margin: 0 }}>No data</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {source_breakdown.slice(0, 6).map((s) => {
                                    const max = source_breakdown[0].leads || 1;
                                    const pct = (s.leads / max) * 100;
                                    return (
                                        <div key={s.name}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                                <span style={{ color: C.textPrimary, fontWeight: 500 }}>{s.name}</span>
                                                <span style={{ color: C.textSecondary }}>{s.leads}</span>
                                            </div>
                                            <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                                                <div style={{ width: `${pct}%`, height: '100%', background: C.primary, borderRadius: 3 }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* City breakdown */}
                    <div style={cardStyle}>
                        <h3 style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, margin: '0 0 10px' }}>
                            Leads by City
                        </h3>
                        {city_breakdown.length === 0 ? (
                            <p style={{ fontSize: 12, color: C.textSecondary, margin: 0 }}>No data</p>
                        ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {city_breakdown.slice(0, 8).map((c) => (
                                    <div key={c.name} style={{
                                        padding: '6px 10px', background: C.bg, border: `1px solid ${C.border}`,
                                        borderRadius: 6, fontSize: 11, color: C.textPrimary,
                                    }}>
                                        <span style={{ fontWeight: 700 }}>{c.leads}</span>
                                        <span style={{ color: C.textSecondary, marginLeft: 4 }}>{c.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components (all inline-styled)
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile({
    icon, label, value, sub, micro, tone, insights,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub?: string;
    micro: { tone: 'good' | 'warn' | 'bad' | 'info'; text: string };
    tone: 'spend' | 'leads' | 'cpl' | 'cpa' | 'roi' | 'win' | 'pipeline' | 'ctr';
    insights: PortfolioInsight[];
}) {
    const toneColor =
        micro.tone === 'good' ? C.success :
        micro.tone === 'warn' ? C.warn :
        micro.tone === 'bad' ? C.danger :
        C.textSecondary;
    const toneBg =
        micro.tone === 'good' ? C.successSoft :
        micro.tone === 'warn' ? C.warnSoft :
        micro.tone === 'bad' ? C.dangerSoft :
        C.bg;
    const accentColor =
        tone === 'spend' ? '#6366F1' :
        tone === 'leads' ? '#0EA5E9' :
        tone === 'cpl' ? '#F59E0B' :
        tone === 'cpa' ? '#EC4899' :
        tone === 'roi' ? '#10B981' :
        tone === 'win' ? '#8B5CF6' :
        tone === 'pipeline' ? '#14B8A6' :
        '#0284C7';

    return (
        <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: 14, position: 'relative', overflow: 'hidden',
        }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accentColor }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ color: accentColor }}>{icon}</div>
                <span style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {label}
                </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.textPrimary, lineHeight: 1.1 }}>
                {value}
            </div>
            {sub && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>{sub}</div>}
            <div style={{
                display: 'inline-block', marginTop: 8,
                padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                color: toneColor, background: toneBg,
            }}>
                {micro.text}
            </div>
            {insights.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 10, color: C.danger, fontWeight: 600 }}>
                    ⚠ {insights.length} insight{insights.length > 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}

function AiBanner({ insight, totalInsights }: { insight: PortfolioInsight; totalInsights: number }) {
    const bg = insight.severity >= 4 ? C.dangerSoft : insight.severity >= 3 ? C.warnSoft : C.infoSoft;
    const fg = insight.severity >= 4 ? C.danger : insight.severity >= 3 ? C.warn : C.info;
    return (
        <div style={{
            background: bg, border: `1px solid ${fg}30`, borderRadius: 14,
            padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
            <div style={{
                width: 36, height: 36, borderRadius: 10, background: fg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
                {insight.severity >= 4 ? <AlertTriangle style={{ width: 18, height: 18, color: 'white' }} /> :
                 insight.severity >= 3 ? <AlertCircle style={{ width: 18, height: 18, color: 'white' }} /> :
                 <Lightbulb style={{ width: 18, height: 18, color: 'white' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.textPrimary }}>{insight.title}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: fg, textTransform: 'uppercase' }}>
                        {SEVERITY_LABEL[insight.severity]}
                    </span>
                    {totalInsights > 1 && (
                        <span style={{ fontSize: 10, color: C.textSecondary }}>
                            +{totalInsights - 1} more
                        </span>
                    )}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: C.textSecondary }}>{insight.message}</p>
            </div>
            <div style={{
                padding: '8px 14px', background: 'white', borderRadius: 8,
                fontSize: 12, color: C.textPrimary, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
                border: `1px solid ${C.border}`,
            }}>
                {insight.action} <ArrowRight style={{ width: 12, height: 12 }} />
            </div>
        </div>
    );
}

function InsightRow({ insight }: { insight: PortfolioInsight }) {
    const bg = SEVERITY_BG[insight.severity];
    const fg = SEVERITY_FG[insight.severity];
    return (
        <div style={{
            padding: '8px 10px', borderRadius: 8,
            background: bg, borderLeft: `3px solid ${fg}`,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: fg }}>{insight.title}</span>
            </div>
            <p style={{ margin: '0 0 3px', fontSize: 11, color: C.textPrimary, lineHeight: 1.3 }}>
                {insight.message}
            </p>
            <p style={{ margin: 0, fontSize: 10, color: C.textSecondary, fontWeight: 600 }}>
                → {insight.action}
            </p>
        </div>
    );
}

const CHANNEL_META: Record<string, { label: string; color: string }> = {
    meta_ads: { label: 'Meta Ads', color: '#1877F2' },
    linkedin_ads: { label: 'LinkedIn Ads', color: '#0A66C2' },
    google_ads: { label: 'Google Ads', color: '#16A34A' },
    other: { label: 'Other', color: '#64748B' },
};

/** Blended channel rollup table with inline bars (cross-channel report). */
function ChannelPerformanceTable({ rows }: { rows: any[] }) {
    const maxSpend = Math.max(1, ...rows.map((r) => r.spend));
    const maxImpr = Math.max(1, ...rows.map((r) => r.impressions));
    const cell: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: C.textPrimary, whiteSpace: 'nowrap' };
    const head: React.CSSProperties = { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', textAlign: 'left' };
    const bar = (val: number, max: number, color: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ minWidth: 56, fontWeight: 700 }}>{fmtNum(Math.round(val))}</span>
            <div style={{ flex: 1, height: 6, background: C.bg, borderRadius: 4, overflow: 'hidden', minWidth: 40 }}>
                <div style={{ width: `${Math.max(2, (val / max) * 100)}%`, height: '100%', background: color, borderRadius: 4 }} />
            </div>
        </div>
    );
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={head}>Channel</th>
                        <th style={head}>Ad Spend</th>
                        <th style={head}>Leads</th>
                        <th style={head}>Won</th>
                        <th style={head}>CTR</th>
                        <th style={head}>CPL</th>
                        <th style={head}>Impressions</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const m = CHANNEL_META[r.channel] || CHANNEL_META.other;
                        return (
                            <tr key={r.channel} style={{ borderBottom: `1px solid ${C.border}` }}>
                                <td style={cell}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: 3, background: m.color }} />
                                        <strong>{m.label}</strong>
                                        <span style={{ fontSize: 11, color: C.textTertiary }}>· {r.campaigns}</span>
                                    </span>
                                </td>
                                <td style={cell}>{bar(r.spend, maxSpend, m.color)}</td>
                                <td style={{ ...cell, fontWeight: 700 }}>{fmtNum(r.leads)}</td>
                                <td style={{ ...cell, color: C.success, fontWeight: 700 }}>{fmtNum(r.won)}</td>
                                <td style={cell}>{r.ctr != null ? `${r.ctr.toFixed(2)}%` : '—'}</td>
                                <td style={cell}>{r.cpl != null ? fmtINR(Math.round(r.cpl)) : '—'}</td>
                                <td style={cell}>{bar(r.impressions, maxImpr, m.color)}</td>
                            </tr>
                        );
                    })}
                    {rows.length > 1 && (
                        <tr style={{ background: C.bg }}>
                            <td style={{ ...cell, fontWeight: 800 }}>Grand total</td>
                            <td style={{ ...cell, fontWeight: 800 }}>{fmtINR(Math.round(rows.reduce((s, r) => s + r.spend, 0)))}</td>
                            <td style={{ ...cell, fontWeight: 800 }}>{fmtNum(rows.reduce((s, r) => s + r.leads, 0))}</td>
                            <td style={{ ...cell, fontWeight: 800 }}>{fmtNum(rows.reduce((s, r) => s + r.won, 0))}</td>
                            <td style={cell}>—</td>
                            <td style={cell}>—</td>
                            <td style={{ ...cell, fontWeight: 800 }}>{fmtNum(rows.reduce((s, r) => s + r.impressions, 0))}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function CampaignTable({
    campaigns, expanded, onToggle,
}: {
    campaigns: CampaignPerf[];
    expanded: string | null;
    onToggle: (id: string) => void;
}) {
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={thStyle()}>Campaign</th>
                        <th style={thStyle()}>Channel</th>
                        <th style={thStyle('right')}>Spend</th>
                        <th style={thStyle('right')}>Leads</th>
                        <th style={thStyle('right')}>CPL</th>
                        <th style={thStyle('right')}>CTR</th>
                        <th style={thStyle('right')}>Won</th>
                        <th style={thStyle('right')}>ROI</th>
                        <th style={thStyle()}>AI Signal</th>
                    </tr>
                </thead>
                <tbody>
                    {campaigns.map((c) => {
                        const insights = campaignInsights(c);
                        const top = insights[0];
                        const isExp = expanded === c.id;
                        return (
                            <React.Fragment key={c.id}>
                                <tr
                                    onClick={() => onToggle(c.id)}
                                    style={{
                                        borderBottom: `1px solid ${C.border}`,
                                        cursor: 'pointer',
                                        background: isExp ? C.bg : 'transparent',
                                    }}
                                >
                                    <td style={tdStyle()}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <ChevronRight style={{
                                                width: 12, height: 12, color: C.textTertiary,
                                                transform: isExp ? 'rotate(90deg)' : 'none',
                                                transition: 'transform 120ms',
                                            }} />
                                            <div>
                                                <div style={{ fontWeight: 600, color: C.textPrimary }}>{c.name}</div>
                                                {c.end_date && (
                                                    <div style={{ fontSize: 10, color: C.textTertiary }}>
                                                        → {c.end_date}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={tdStyle()}>
                                        <ChannelBadge channel={c.channel} />
                                    </td>
                                    <td style={tdStyle('right')}>{fmtINR(c.spend)}</td>
                                    <td style={tdStyle('right')}>{c.leads}</td>
                                    <td style={tdStyle('right')}>
                                        {c.cpl != null ? fmtINR(Math.round(c.cpl)) : <span style={{ color: C.textTertiary }}>—</span>}
                                    </td>
                                    <td style={tdStyle('right')}>
                                        {c.ctr != null ? `${c.ctr.toFixed(2)}%` : <span style={{ color: C.textTertiary }}>—</span>}
                                    </td>
                                    <td style={tdStyle('right')}>{c.won}</td>
                                    <td style={tdStyle('right')}>
                                        {c.roi != null ? (
                                            <span style={{ color: c.roi > 0 ? C.success : C.danger, fontWeight: 600 }}>
                                                {c.roi > 0 ? '+' : ''}{Math.round(c.roi)}%
                                            </span>
                                        ) : <span style={{ color: C.textTertiary }}>—</span>}
                                    </td>
                                    <td style={tdStyle()}>
                                        {top ? (
                                            <span style={{
                                                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                                                color: SEVERITY_FG[top.severity], background: SEVERITY_BG[top.severity],
                                            }}>
                                                {SEVERITY_LABEL[top.severity]}
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: 10, color: C.textTertiary }}>—</span>
                                        )}
                                    </td>
                                </tr>
                                {isExp && (
                                    <tr style={{ background: C.bg }}>
                                        <td colSpan={9} style={{ padding: '12px 20px' }}>
                                            <ExpandedCampaignRow campaign={c} />
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function ExpandedCampaignRow({ campaign }: { campaign: CampaignPerf }) {
    const insights = campaignInsights(campaign);
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', marginBottom: 6 }}>
                    Daily Spend
                </div>
                <Sparkline
                    data={Object.entries(campaign.daily).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)}
                    height={36} color={C.primary}
                />
            </div>
            <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', marginBottom: 6 }}>
                    Funnel
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                    <Row k="Impressions" v={fmtNum(campaign.impressions)} />
                    <Row k="Clicks" v={fmtNum(campaign.clicks)} />
                    <Row k="Leads" v={String(campaign.leads)} />
                    <Row k="Won" v={String(campaign.won)} />
                    <Row k="Won value" v={fmtINR(campaign.won_value)} />
                </div>
            </div>
            <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', marginBottom: 6 }}>
                    AI Signals ({insights.length})
                </div>
                {insights.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 11, color: C.textTertiary }}>No actionable signals.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {insights.map((i, idx) => (
                            <div key={idx} style={{
                                padding: '4px 8px', fontSize: 10, color: C.textPrimary,
                                background: SEVERITY_BG[i.severity], borderLeft: `2px solid ${SEVERITY_FG[i.severity]}`,
                                borderRadius: 4,
                            }}>
                                <strong>{i.title}</strong>: {i.message} <em style={{ color: C.textSecondary }}>→ {i.action}</em>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.textSecondary }}>{k}</span>
            <span style={{ color: C.textPrimary, fontWeight: 600 }}>{v}</span>
        </div>
    );
}

function ChannelBadge({ channel }: { channel: string | null }) {
    const map: Record<string, { bg: string; fg: string; label: string }> = {
        meta_ads:   { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Meta' },
        google_ads: { bg: '#FEF3C7', fg: '#92400E', label: 'Google' },
        whatsapp:   { bg: '#DCFCE7', fg: '#166534', label: 'WhatsApp' },
        email:      { bg: '#E0E7FF', fg: '#3730A3', label: 'Email' },
        referral:   { bg: '#FCE7F3', fg: '#9D174D', label: 'Referral' },
        organic:    { bg: '#F1F5F9', fg: '#475569', label: 'Organic' },
        manual:     { bg: '#F1F5F9', fg: '#475569', label: 'Manual' },
    };
    const m = map[channel || ''] || { bg: C.bg, fg: C.textSecondary, label: channel || '—' };
    return (
        <span style={{
            display: 'inline-block', padding: '2px 7px', fontSize: 10, fontWeight: 700,
            color: m.fg, background: m.bg, borderRadius: 6,
        }}>
            {m.label}
        </span>
    );
}

function Sparkline({ data, height = 40, color = C.primary }: { data: number[]; height?: number; color?: string }) {
    if (!data || data.length === 0) {
        return <div style={{ height, color: C.textTertiary, fontSize: 11, display: 'flex', alignItems: 'center' }}>No data</div>;
    }
    const max = Math.max(...data, 1);
    const width = 100; // viewBox units
    const step = data.length > 1 ? width / (data.length - 1) : 0;
    const points = data.map((v, i) => {
        const x = i * step;
        const y = height - (v / max) * (height - 4) - 2;
        return `${x},${y}`;
    }).join(' ');
    const fillPoints = `0,${height} ${points} ${width},${height}`;
    return (
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
            style={{ width: '100%', height, display: 'block' }}>
            <polygon points={fillPoints} fill={color} opacity={0.12} />
            <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ── shared inline styles ────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 12,
    color: C.textPrimary,
    background: C.surface,
    outline: 'none',
};
const cardStyle: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 14, padding: 16,
};
const thStyle = (align: 'left' | 'right' = 'left'): React.CSSProperties => ({
    textAlign: align, fontSize: 10, fontWeight: 700, color: C.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 10px',
});
const tdStyle = (align: 'left' | 'right' = 'left'): React.CSSProperties => ({
    textAlign: align, padding: '10px', color: C.textPrimary, verticalAlign: 'middle',
});
const iconSm: React.CSSProperties = { width: 14, height: 14 };