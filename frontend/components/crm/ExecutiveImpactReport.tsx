'use client';

import { useState, useEffect, useRef } from 'react';
import {
    Loader2, Download, ExternalLink, ChevronLeft, ChevronRight, Calendar, X,
    TrendingUp, TrendingDown, AlertTriangle, Award, DollarSign, Users,
    Target, Filter, Briefcase, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ImpactReportPayload } from '@/frontend/types/crm';

// ── helpers ──────────────────────────────────────────────────────────────────
function toDateInput(d: Date) {
    return d.toISOString().slice(0, 10);
}
function fromDateInput(s: string): Date {
    return new Date(s + 'T00:00:00Z');
}
function daysBetween(start: string, end: string): number {
    return Math.max(
        1,
        Math.round(
            (fromDateInput(end).getTime() - fromDateInput(start).getTime()) / 86400_000
        ) + 1
    );
}
function shortDate(s: string) {
    return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
    });
}
function inr(n: number) {
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
    if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${Math.round(n)}`;
}
function inrFull(n: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface ExecutiveImpactReportProps {
    orgId: string;
    orgName: string;
    /** Optional initial date range. Defaults to "last 2 months". */
    initialFrom?: string;
    initialTo?: string;
    /** When true (e.g. embedded in a rep dashboard), hides filters/insights. */
    readOnly?: boolean;
    /** Compact mode for smaller embeds. */
    compact?: boolean;
}

// ── main component ──────────────────────────────────────────────────────────
export default function ExecutiveImpactReport({
    orgId,
    orgName,
    initialFrom,
    initialTo,
    readOnly = false,
    compact = false,
}: ExecutiveImpactReportProps) {
    const router = useRouter();
    const reportRef = useRef<HTMLDivElement>(null);
    const pickerRef = useRef<HTMLDivElement>(null);

    const today = new Date();
    const defaultFrom = toDateInput(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const defaultTo = toDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 0));

    const [from, setFrom] = useState(initialFrom || defaultFrom);
    const [to, setTo] = useState(initialTo || defaultTo);
    const [pendingFrom, setPendingFrom] = useState(from);
    const [pendingTo, setPendingTo] = useState(to);
    const [groupBy, setGroupBy] = useState<'month' | 'week'>('month');
    const [campaignFilter, setCampaignFilter] = useState<string[]>([]);
    const [propertyFilter, setPropertyFilter] = useState<string[]>([]);

    const [data, setData] = useState<ImpactReportPayload | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [showPicker, setShowPicker] = useState(false);
    const [showCampaignPicker, setShowCampaignPicker] = useState(false);
    const [showPropertyPicker, setShowPropertyPicker] = useState(false);

    // Close popovers on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
                setShowPicker(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Fetch
    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;
        (async () => {
            setIsLoading(true);
            setError(null);
            try {
                const params = new URLSearchParams();
                params.set('from', from);
                params.set('to', to);
                params.set('group_by', groupBy);
                campaignFilter.forEach((c) => params.append('campaign_id', c));
                propertyFilter.forEach((p) => params.append('property_id', p));
                const res = await fetch(`/api/crm/reports/impact?${params.toString()}`, { cache: 'no-store' });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j.error || `HTTP ${res.status}`);
                }
                const json: ImpactReportPayload = await res.json();
                if (!cancelled) setData(json);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [orgId, from, to, groupBy, campaignFilter, propertyFilter]);

    // ── period helpers
    const shiftRange = (deltaDays: number) => {
        const f = fromDateInput(from);
        const t = fromDateInput(to);
        f.setUTCDate(f.getUTCDate() + deltaDays);
        t.setUTCDate(t.getUTCDate() + deltaDays);
        const nf = toDateInput(f);
        const nt = toDateInput(t);
        setFrom(nf);
        setTo(nt);
        setPendingFrom(nf);
        setPendingTo(nt);
    };
    const applyCustom = () => {
        if (pendingFrom > pendingTo) return;
        setFrom(pendingFrom);
        setTo(pendingTo);
        setShowPicker(false);
    };
    const applyPreset = (days: number) => {
        const t = new Date();
        const f = new Date();
        f.setUTCDate(t.getUTCDate() - days);
        setFrom(toDateInput(f));
        setTo(toDateInput(t));
        setPendingFrom(toDateInput(f));
        setPendingTo(toDateInput(t));
        setShowPicker(false);
    };
    const applyMonthPreset = (yearOffset: number) => {
        const t = new Date();
        const targetYear = t.getUTCFullYear() + yearOffset;
        const f = new Date(Date.UTC(targetYear, 0, 1));
        const e = new Date(Date.UTC(targetYear, 11, 31));
        setFrom(toDateInput(f));
        setTo(toDateInput(e));
        setPendingFrom(toDateInput(f));
        setPendingTo(toDateInput(e));
        setShowPicker(false);
    };

    const presets = [
        { label: 'Last 30 days', days: 30 },
        { label: 'Last 90 days', days: 90 },
        { label: 'Last 6 months', days: 180 },
        { label: 'Last 12 months', days: 365 },
        { label: 'Month-to-date', monthToDate: true },
        { label: 'This year', thisYear: true },
    ];

    // ── PDF export
    const handleDownloadPDF = async () => {
        if (!reportRef.current || !data) return;
        setIsExporting(true);
        const originalScrollY = window.scrollY;
        try {
            await new Promise((r) => setTimeout(r, 50));
            window.scrollTo(0, 0);
            const element = reportRef.current;
            const originalBorder = element.style.border;
            const originalShadow = element.style.boxShadow;
            const originalWidth = element.style.width;
            element.style.border = 'none';
            element.style.boxShadow = 'none';
            element.style.width = '1200px';
            const canvas = await html2canvas(element, {
                scale: 1.5,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                windowWidth: 1280,
            });
            element.style.border = originalBorder;
            element.style.boxShadow = originalShadow;
            element.style.width = originalWidth;
            const imgData = canvas.toDataURL('image/png', 0.8);
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: 'a4' });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 5;
            const maxW = pageWidth - margin * 2;
            const maxH = pageHeight - margin * 2;
            let imgWidth = maxW;
            let imgHeight = (canvas.height * imgWidth) / canvas.width;
            if (imgHeight > maxH) {
                imgHeight = maxH;
                imgWidth = (canvas.width * imgHeight) / canvas.height;
            }
            const x = (pageWidth - imgWidth) / 2;
            const y = (pageHeight - imgHeight) / 2;
            pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight, undefined, 'FAST');
            pdf.save(`CRM_Impact_${orgName.replace(/\s+/g, '_')}_${from}_${to}.pdf`);
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            window.scrollTo(0, originalScrollY);
            setIsExporting(false);
        }
    };

    // ── loading / error states
    if (isLoading && !data) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-border">
                <Loader2 className="w-10 h-10 text-[#4f46e5] animate-spin mb-4" />
                <p className="text-slate-500 font-medium">Aggregating CRM data…</p>
                <p className="text-xs text-slate-400 mt-1">Leads, calls, status, spend — pulling it all together</p>
            </div>
        );
    }
    if (error || !data) {
        return (
            <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-border">
                <div className="bg-red-50 text-red-600 p-6 rounded-2xl border border-red-200 max-w-md text-center">
                    <h2 className="text-lg font-bold mb-2">Could not load report</h2>
                    <p className="text-sm">{error || 'No data available'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Action bar */}
            {!readOnly && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Period picker */}
                        <div className="relative" ref={pickerRef}>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => shiftRange(-daysBetween(from, to))}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                                    title="Previous period"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setShowPicker((v) => !v)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
                                >
                                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                    {shortDate(from)} – {shortDate(to)}
                                    <span className="ml-1 bg-slate-300 text-slate-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                                        {daysBetween(from, to)}d
                                    </span>
                                </button>
                                <button
                                    onClick={() => shiftRange(daysBetween(from, to))}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                                    title="Next period"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                            {showPicker && (
                                <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-4 w-80">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Period</span>
                                        <button onClick={() => setShowPicker(false)} className="text-slate-400 hover:text-slate-600">
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 mb-3">
                                        {presets.map((p) => (
                                            <button
                                                key={p.label}
                                                onClick={() => {
                                                    if (p.monthToDate) {
                                                        const t = new Date();
                                                        const f = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
                                                        setFrom(toDateInput(f));
                                                        setTo(toDateInput(t));
                                                        setPendingFrom(toDateInput(f));
                                                        setPendingTo(toDateInput(t));
                                                        setShowPicker(false);
                                                    } else if (p.thisYear) {
                                                        applyMonthPreset(0);
                                                    } else if (p.days) {
                                                        applyPreset(p.days);
                                                    }
                                                }}
                                                className="text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium hover:bg-slate-100 text-slate-600 transition-colors"
                                            >
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="border-t border-slate-100 pt-3">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Custom Range</p>
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            <div>
                                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">From</label>
                                                <input
                                                    type="date"
                                                    value={pendingFrom}
                                                    max={pendingTo}
                                                    onChange={(e) => setPendingFrom(e.target.value)}
                                                    className="w-full px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg focus:border-[#1e3a8a] focus:outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">To</label>
                                                <input
                                                    type="date"
                                                    value={pendingTo}
                                                    min={pendingFrom}
                                                    onChange={(e) => setPendingTo(e.target.value)}
                                                    className="w-full px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg focus:border-[#1e3a8a] focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={applyCustom}
                                            className="w-full py-2 bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white text-[11px] font-bold rounded-lg transition-colors"
                                        >
                                            Apply
                                        </button>
                                    </div>
                                    <div className="border-t border-slate-100 pt-3 mt-3">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Group by</p>
                                        <div className="flex gap-1">
                                            {(['month', 'week'] as const).map((g) => (
                                                <button
                                                    key={g}
                                                    onClick={() => setGroupBy(g)}
                                                    className={`flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                                        groupBy === g
                                                            ? 'bg-[#1e3a8a] text-white'
                                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                    }`}
                                                >
                                                    {g.charAt(0).toUpperCase() + g.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Campaign filter */}
                        <CampaignFilter
                            campaigns={data.filters.campaigns}
                            selected={campaignFilter}
                            onChange={setCampaignFilter}
                            isOpen={showCampaignPicker}
                            onToggle={() => setShowCampaignPicker((v) => !v)}
                        />

                        {/* Property filter */}
                        <PropertyFilter
                            properties={data.filters.properties}
                            selected={propertyFilter}
                            onChange={setPropertyFilter}
                            isOpen={showPropertyPicker}
                            onToggle={() => setShowPropertyPicker((v) => !v)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleDownloadPDF}
                            disabled={isExporting}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4f46e5] text-white text-xs font-bold rounded-lg hover:bg-[#4338ca] disabled:opacity-50 transition-colors"
                        >
                            {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                            Download PDF
                        </button>
                        {!compact && (
                            <button
                                onClick={() => router.push(`/${orgId}/crm/reports?embed=1`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200 transition-colors"
                            >
                                <ExternalLink className="w-3 h-3" />
                                Full View
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Report card */}
            <div
                ref={reportRef}
                className="w-full bg-white border border-[#e2e8f0] shadow-sm p-6 overflow-hidden rounded-xl"
            >
                <Header orgName={orgName} from={from} to={to} />

                <KpiRow kpis={data.kpis} sparklines={data.sparklines} />

                <ChartRow1 data={data} />

                <ChartRow2 data={data} />

                <ChartRow3 data={data} />

                <InsightsRow data={data} router={router} orgId={orgId} />

                <MonthlyTable data={data} />

                {data.rep_performance.length > 0 && <RepLeaderboard data={data} />}

                <Footer orgName={orgName} />
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components — mirrors FMS ExecutiveSummaryPanel section-by-section
// ─────────────────────────────────────────────────────────────────────────────

function Header({ orgName, from, to }: { orgName: string; from: string; to: string }) {
    return (
        <div className="flex items-center justify-between pb-6 mb-6 border-b border-[#e2e8f0]">
            <img src="/autopilot-logo-new.png" className="h-[45px] object-contain" alt="Logo" />
            <div className="text-center flex-1">
                <h1 className="text-[20px] font-black text-[#1e3a8a] tracking-tight leading-tight">
                    CRM Performance Impact Report
                </h1>
                <p className="text-[12px] font-bold text-[#64748b] mt-0.5 tracking-wide uppercase">
                    {orgName} · Sales Performance
                </p>
            </div>
            <div className="bg-[#1e3a8a] text-white px-4 py-1.5 rounded-lg text-[11px] font-black shadow-md whitespace-nowrap tracking-wider">
                {shortDate(from)} – {shortDate(to)}
            </div>
        </div>
    );
}

function KpiRow({
    kpis, sparklines,
}: {
    kpis: ImpactReportPayload['kpis'];
    sparklines: ImpactReportPayload['sparklines'];
}) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <KpiCard
                label="LEADS RECEIVED"
                value={kpis.leads_received.toString()}
                accent="#1e3a8a"
                hint={`${kpis.leads_connected} contacted (${kpis.leads_received ? Math.round((kpis.leads_connected / kpis.leads_received) * 100) : 0}%)`}
                sparkline={sparklines.leads}
                sparkColor="#1e3a8a"
            />
            <KpiCard
                label="ACTIVE PIPELINE"
                value={inr(kpis.active_pipeline_value)}
                accent="#f97316"
                hint={`${kpis.stale_pipeline.count} stale (>${kpis.stale_pipeline.days}d) · ${inr(kpis.stale_pipeline.value)} at risk`}
                sparkline={sparklines.connected}
                sparkColor="#f97316"
            />
            <KpiCard
                label="WON REVENUE"
                value={inr(kpis.won_revenue)}
                accent="#22c55e"
                hint={`${kpis.cpa > 0 ? `CPA ${inr(kpis.cpa)}` : `Avg deal ${inr(kpis.avg_deal_size)}`}`}
                sparkline={sparklines.revenue}
                sparkColor="#22c55e"
            />
            <KpiCard
                label="WIN RATE"
                value={`${kpis.win_rate.toFixed(1)}%`}
                accent={kpis.win_rate >= 25 ? '#22c55e' : kpis.win_rate >= 12 ? '#eab308' : '#ef4444'}
                hint={kpis.avg_time_to_close_days != null ? `Avg close: ${kpis.avg_time_to_close_days.toFixed(0)}d` : 'No closures yet'}
                sparkline={sparklines.won}
                sparkColor="#0f172a"
            />
        </div>
    );
}

function KpiCard({
    label, value, hint, accent, sparkline, sparkColor,
}: {
    label: string;
    value: string;
    hint: string;
    accent: string;
    sparkline: number[];
    sparkColor: string;
}) {
    return (
        <div
            className="relative bg-[#F8FAFC] border-t-[3px] py-3 px-4 shadow-sm border-x border-b border-[#e2e8f0] overflow-hidden flex justify-between"
            style={{ borderTopColor: accent }}
        >
            <div className="relative z-10">
                <p className="text-[10px] uppercase tracking-wider text-[#64748b] font-bold mb-1">{label}</p>
                <h2 className="text-[28px] leading-none font-bold mb-1" style={{ color: accent }}>{value}</h2>
                <p className="text-[9px] text-[#94a3b8] font-medium">{hint}</p>
            </div>
            <div className="absolute right-0 bottom-0 w-[55%] h-[55%] opacity-50 pointer-events-none">
                <Sparkline data={sparkline} color={sparkColor} />
            </div>
        </div>
    );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
    if (!data || data.length === 0) return null;
    const max = Math.max(...data, 1);
    const points = data.map((v, i) => {
        const x = (i / Math.max(1, data.length - 1)) * 100;
        const y = 100 - (v / max) * 100;
        return `${x},${y}`;
    }).join(' ');
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
    );
}

function ChartRow1({ data }: { data: ImpactReportPayload }) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            <ChartCard title="Leads vs Won · Monthly">
                <LeadsVsWonChart data={data.monthly_trend} />
            </ChartCard>
            <ChartCard title={`Win Rate Performance (target ${data.target_win_rate}%)`}>
                <WinRateChart data={data.monthly_trend} target={data.target_win_rate} />
            </ChartCard>
        </div>
    );
}

function ChartRow2({ data }: { data: ImpactReportPayload }) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            <ChartCard title="Top Sources · Period">
                <HorizontalBarChart
                    items={data.source_breakdown.slice(0, 7).map((s) => ({
                        label: s.name,
                        value: s.count,
                        sub: s.won > 0 ? `${s.won} won · ${((s.won / s.count) * 100).toFixed(0)}% conv` : '—',
                    }))}
                />
            </ChartCard>
            <ChartCard title="Top Campaigns · Period">
                <HorizontalBarChart
                    items={data.campaign_breakdown.slice(0, 7).map((c) => ({
                        label: c.name,
                        value: c.leads,
                        sub: c.roi != null
                            ? `${c.won} won · ROI ${c.roi >= 0 ? '+' : ''}${c.roi.toFixed(0)}%`
                            : `${c.won} won`,
                    }))}
                />
            </ChartCard>
            <ChartCard title="Spend vs Won Revenue · Monthly">
                <SpendVsRevenueChart data={data.monthly_trend} />
            </ChartCard>
        </div>
    );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-white border border-[#e2e8f0] rounded-sm shadow-sm overflow-hidden flex flex-col" style={{ height: '240px' }}>
            <div className="bg-[#f8fafc] border-b border-[#e2e8f0] px-3 py-2 text-[#1e3a8a] text-[12px] font-bold">{title}</div>
            <div className="p-3 flex-1 relative">{children}</div>
        </div>
    );
}

function ChartRow3({ data }: { data: ImpactReportPayload }) {
    // 2-up: status donut + rep performance
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            <ChartCard title="Status Distribution">
                <StatusDonut data={data.status_distribution} />
            </ChartCard>
            <ChartCard title="Top Reps · Leads vs Won">
                <RepBarChart data={data.rep_performance.slice(0, 8)} />
            </ChartCard>
        </div>
    );
}

// Note: ChartRow3 is rendered inline in the main component below.

// ─────────────────────────────────────────────────────────────────────────────
// Charts (lightweight inline SVG/div — no chart.js dependency for the report)
// ─────────────────────────────────────────────────────────────────────────────

function LeadsVsWonChart({ data }: { data: ImpactReportPayload['monthly_trend'] }) {
    if (!data.length) return <EmptyChart />;
    const max = Math.max(...data.map((d) => Math.max(d.leads, d.won)), 1);
    const w = 100, h = 100;
    const barW = w / data.length * 0.6;
    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 relative">
                <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
                    {data.map((d, i) => {
                        const x = (i + 0.5) * (w / data.length) - barW / 2;
                        const leadsH = (d.leads / max) * h;
                        const wonH = (d.won / max) * h;
                        return (
                            <g key={d.key}>
                                <rect x={x} y={h - leadsH} width={barW / 2} height={leadsH} fill="#475569" rx="0.5" />
                                <rect x={x + barW / 2} y={h - wonH} width={barW / 2} height={wonH} fill="#22c55e" rx="0.5" />
                            </g>
                        );
                    })}
                </svg>
            </div>
            <div className="flex justify-between text-[9px] text-[#64748b] font-semibold mt-1 px-0.5">
                {data.map((d) => <span key={d.key} className="flex-1 text-center">{d.label}</span>)}
            </div>
            <div className="flex items-center gap-3 text-[10px] font-semibold mt-1">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#475569] rounded-sm" /> Leads</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#22c55e] rounded-sm" /> Won</span>
            </div>
        </div>
    );
}

function WinRateChart({ data, target }: { data: ImpactReportPayload['monthly_trend']; target: number }) {
    if (!data.length) return <EmptyChart />;
    const w = 100, h = 100;
    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 relative">
                <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
                    {/* target line */}
                    <line
                        x1="0" y1={h - target} x2={w} y2={h - target}
                        stroke="#ef4444" strokeDasharray="2,2" strokeWidth="0.4"
                    />
                    {data.map((d, i) => {
                        const leadsInRange = d.leads || 1;
                        const rate = (d.won / leadsInRange) * 100;
                        const x = (i + 0.5) * (w / data.length);
                        const y = h - Math.min(rate, 100);
                        const color = rate >= target * 1.2 ? '#22c55e' : rate >= target * 0.7 ? '#eab308' : '#ef4444';
                        return (
                            <g key={d.key}>
                                <rect
                                    x={x - (w / data.length) * 0.3}
                                    y={y}
                                    width={(w / data.length) * 0.6}
                                    height={h - y}
                                    fill={color}
                                    rx="0.3"
                                />
                                <text
                                    x={x} y={y - 2}
                                    textAnchor="middle"
                                    fontSize="3.5"
                                    fontWeight="bold"
                                    fill="#0f172a"
                                >
                                    {rate.toFixed(0)}%
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>
            <div className="flex justify-between text-[9px] text-[#64748b] font-semibold mt-1 px-0.5">
                {data.map((d) => <span key={d.key} className="flex-1 text-center">{d.label}</span>)}
            </div>
        </div>
    );
}

function SpendVsRevenueChart({ data }: { data: ImpactReportPayload['monthly_trend'] }) {
    if (!data.length) return <EmptyChart />;
    const max = Math.max(...data.flatMap((d) => [d.spend, d.revenue]), 1);
    const w = 100, h = 100;
    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 relative">
                <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
                    {data.map((d, i) => {
                        const x = (i + 0.5) * (w / data.length);
                        const spendH = (d.spend / max) * h;
                        const revH = (d.revenue / max) * h;
                        return (
                            <g key={d.key}>
                                <rect
                                    x={x - (w / data.length) * 0.35}
                                    y={h - spendH}
                                    width={(w / data.length) * 0.3}
                                    height={spendH}
                                    fill="#f97316"
                                    rx="0.3"
                                />
                                <polyline
                                    points={
                                        data.map((dd, j) => {
                                            const xx = (j + 0.5) * (w / data.length);
                                            const yy = h - (dd.revenue / max) * h;
                                            return `${xx},${yy}`;
                                        }).join(' ')
                                    }
                                    fill="none"
                                    stroke="#22c55e"
                                    strokeWidth="0.6"
                                />
                            </g>
                        );
                    })}
                </svg>
            </div>
            <div className="flex justify-between text-[9px] text-[#64748b] font-semibold mt-1 px-0.5">
                {data.map((d) => <span key={d.key} className="flex-1 text-center">{d.label}</span>)}
            </div>
            <div className="flex items-center gap-3 text-[10px] font-semibold mt-1">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#f97316] rounded-sm" /> Spend</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#22c55e] rounded-sm" /> Won Revenue</span>
            </div>
        </div>
    );
}

function HorizontalBarChart({ items }: { items: Array<{ label: string; value: number; sub?: string }> }) {
    if (!items.length) return <EmptyChart />;
    const max = Math.max(...items.map((i) => i.value), 1);
    return (
        <div className="w-full h-full overflow-y-auto space-y-1.5 pr-1">
            {items.map((it) => (
                <div key={it.label} className="text-[10px]">
                    <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-[#334155] truncate pr-2">{it.label}</span>
                        <span className="text-[#0f172a] font-bold whitespace-nowrap">{it.value}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-sm overflow-hidden">
                        <div
                            className="h-full bg-[#1e3a8a]"
                            style={{ width: `${(it.value / max) * 100}%` }}
                        />
                    </div>
                    {it.sub && <div className="text-[8px] text-[#94a3b8] mt-0.5">{it.sub}</div>}
                </div>
            ))}
        </div>
    );
}

function StatusDonut({ data }: { data: ImpactReportPayload['status_distribution'] }) {
    if (!data.length) return <EmptyChart />;
    const total = data.reduce((s, d) => s + d.count, 0) || 1;
    const cx = 50, cy = 50, rOuter = 40, rInner = 26;
    let acc = 0;
    const slices = data.slice(0, 8).map((d) => {
        const startAngle = (acc / total) * Math.PI * 2;
        acc += d.count;
        const endAngle = (acc / total) * Math.PI * 2;
        const x1 = cx + rOuter * Math.cos(startAngle);
        const y1 = cy + rOuter * Math.sin(startAngle);
        const x2 = cx + rOuter * Math.cos(endAngle);
        const y2 = cy + rOuter * Math.sin(endAngle);
        const x3 = cx + rInner * Math.cos(endAngle);
        const y3 = cy + rInner * Math.sin(endAngle);
        const x4 = cx + rInner * Math.cos(startAngle);
        const y4 = cy + rInner * Math.sin(startAngle);
        const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
        const path = `M${x1},${y1} A${rOuter},${rOuter} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${largeArc} 0 ${x4},${y4} Z`;
        return { path, color: d.color, name: d.name, count: d.count, pct: (d.count / total) * 100 };
    });
    return (
        <div className="w-full h-full flex gap-2">
            <div className="flex-1 flex items-center justify-center">
                <svg viewBox="0 0 100 100" className="w-full h-full max-w-[140px]">
                    {slices.map((s, i) => (
                        <path key={i} d={s.path} fill={s.color} />
                    ))}
                    <text x="50" y="48" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#0f172a">{total}</text>
                    <text x="50" y="58" textAnchor="middle" fontSize="5" fill="#64748b">leads</text>
                </svg>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto text-[10px]">
                {slices.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="truncate flex-1 text-[#334155] font-medium">{s.name}</span>
                        <span className="font-bold text-[#0f172a]">{s.count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function RepBarChart({ data }: { data: ImpactReportPayload['rep_performance'] }) {
    if (!data.length) return <EmptyChart />;
    const max = Math.max(...data.flatMap((r) => [r.leads, r.won]), 1);
    return (
        <div className="w-full h-full overflow-y-auto space-y-1.5 pr-1">
            {data.map((r) => (
                <div key={r.id} className="text-[10px]">
                    <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-[#334155] truncate pr-2">{r.name}</span>
                        <span className="text-[#0f172a] font-bold whitespace-nowrap">
                            {r.won}/{r.leads} · {r.win_rate.toFixed(0)}%
                        </span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-sm overflow-hidden flex">
                        <div
                            className="h-full bg-[#475569]"
                            style={{ width: `${(r.leads / max) * 100}%` }}
                        />
                        <div
                            className="h-full bg-[#22c55e]"
                            style={{ width: `${(r.won / max) * 100}%`, opacity: 0.85 }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyChart() {
    return (
        <div className="w-full h-full flex items-center justify-center text-[11px] text-[#94a3b8]">
            No data in this period
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision-maker insight tiles
// ─────────────────────────────────────────────────────────────────────────────

function InsightsRow({
    data, router, orgId,
}: {
    data: ImpactReportPayload;
    router: ReturnType<typeof useRouter>;
    orgId: string;
}) {
    const topCampaign = data.insights.top_campaign;
    const underperformer = data.insights.underperformer;
    const stale = data.kpis.stale_pipeline;

    const tiles: Array<{
        key: string;
        accent: string;
        icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
        title: string;
        body: React.ReactNode;
        cta?: { label: string; onClick: () => void };
    }> = [];

    if (topCampaign) {
        tiles.push({
            key: 'top-campaign',
            accent: '#22c55e',
            icon: Award,
            title: 'Top performing campaign',
            body: (
                <div>
                    <div className="text-[14px] font-bold text-[#1e3a8a]">{topCampaign.name}</div>
                    <div className="text-[11px] text-[#64748b] mt-0.5">
                        {topCampaign.leads} leads · {topCampaign.won} won · {inr(topCampaign.revenue)} revenue
                    </div>
                    <div className="text-[11px] font-bold text-[#16a34a] mt-1">
                        ROI {topCampaign.roi != null ? `${topCampaign.roi >= 0 ? '+' : ''}${topCampaign.roi.toFixed(0)}%` : '—'}
                    </div>
                </div>
            ),
            cta: {
                label: 'View leads',
                // crm_leads.campaign is a TEXT label (campaign name), not a UUID —
                // match the leads-table filter convention.
                onClick: () => router.push(`/${orgId}/crm/leads?campaign=${encodeURIComponent(topCampaign.name)}`),
            },
        });
    } else {
        tiles.push({
            key: 'top-campaign-empty',
            accent: '#94a3b8',
            icon: Award,
            title: 'No campaign performance yet',
            body: <div className="text-[11px] text-[#64748b]">Log ad spend against your campaigns to see ROI here.</div>,
        });
    }

    if (underperformer) {
        tiles.push({
            key: 'underperformer',
            accent: '#f97316',
            icon: TrendingDown,
            title: 'Underperforming rep',
            body: (
                <div>
                    <div className="text-[14px] font-bold text-[#1e3a8a]">{underperformer.name}</div>
                    <div className="text-[11px] text-[#64748b] mt-0.5">
                        {underperformer.leads} leads · only {underperformer.won} won · {underperformer.win_rate.toFixed(0)}% win rate
                    </div>
                    <div className="text-[11px] font-bold text-[#d97706] mt-1">
                        Coaching opportunity
                    </div>
                </div>
            ),
            cta: {
                label: 'View pipeline',
                onClick: () => router.push(`/${orgId}/crm/leads?assigned_to=${underperformer.id}`),
            },
        });
    } else {
        tiles.push({
            key: 'underperformer-empty',
            accent: '#22c55e',
            icon: Award,
            title: 'All reps on track',
            body: <div className="text-[11px] text-[#64748b]">No rep is significantly below average. Nice work.</div>,
        });
    }

    tiles.push({
        key: 'stale',
        accent: stale.count > 0 ? '#ef4444' : '#22c55e',
        icon: AlertTriangle,
        title: 'Stale pipeline',
        body: (
            <div>
                <div className="text-[14px] font-bold text-[#1e3a8a]">
                    {stale.count} leads
                </div>
                <div className="text-[11px] text-[#64748b] mt-0.5">
                    Open leads untouched for &gt;{stale.days} days
                </div>
                <div className={`text-[11px] font-bold mt-1 ${stale.count > 0 ? 'text-[#dc2626]' : 'text-[#16a34a]'}`}>
                    {inr(stale.value)} at risk
                </div>
            </div>
        ),
        cta: stale.count > 0 ? {
            label: 'Review leads',
            onClick: () => router.push(`/${orgId}/crm/leads?stale=1`),
        } : undefined,
    });

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {tiles.map((t) => {
                const Icon = t.icon;
                return (
                    <div
                        key={t.key}
                        className="bg-white border border-[#e2e8f0] rounded-sm shadow-sm overflow-hidden flex flex-col"
                    >
                        <div
                            className="border-t-[3px] px-4 py-2.5"
                            style={{ borderTopColor: t.accent }}
                        >
                            <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
                                <Icon className="w-3.5 h-3.5" style={{ color: t.accent }} />
                                {t.title}
                            </div>
                            <div className="mt-2">{t.body}</div>
                        </div>
                        {t.cta && (
                            <button
                                onClick={t.cta.onClick}
                                className="text-[10px] font-bold text-[#1e3a8a] py-2 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1 border-t border-[#e2e8f0]"
                            >
                                {t.cta.label}
                                <ArrowUpRight className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly summary table (FMS-style)
// ─────────────────────────────────────────────────────────────────────────────

function MonthlyTable({ data }: { data: ImpactReportPayload }) {
    if (!data.monthly_trend.length) return null;
    const overallWinRate = data.kpis.leads_received
        ? (data.kpis.won_revenue > 0 ? (data.monthly_trend.reduce((s, m) => s + m.won, 0) / data.kpis.leads_received) * 100 : 0)
        : 0;
    return (
        <div className="mb-4">
            <h3 className="text-[12px] font-bold text-[#1e3a8a] mb-2 px-1">
                Monthly Performance Summary · {data.period.label}
            </h3>
            <div className="border border-[#1e3a8a] overflow-hidden rounded-sm overflow-x-auto">
                <table className="w-full text-[11px] text-left">
                    <thead className="bg-[#1e3a8a] text-white">
                        <tr>
                            {['Period', 'Leads', 'Connected', 'Won', 'Lost', 'Win Rate', 'Revenue', 'Spend', 'Top Source', 'Status'].map((h) => (
                                <th key={h} className="py-2 px-3 font-bold border-r border-[#2C4A9E] last:border-r-0 whitespace-nowrap">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white">
                        {data.monthly_trend.map((row, idx) => {
                            const leadsInRange = row.leads || 1;
                            const winRate = (row.won / leadsInRange) * 100;
                            const status = winRate >= overallWinRate * 1.3 ? 'excellent'
                                : winRate >= overallWinRate * 0.7 ? 'ontrack'
                                : winRate >= overallWinRate * 0.5 ? 'attention'
                                : 'critical';
                            return (
                                <tr key={row.key} className={idx < data.monthly_trend.length - 1 ? 'border-b border-[#e2e8f0]' : ''}>
                                    <td className="py-2.5 px-3 font-bold text-[#334155] whitespace-nowrap">{row.label}</td>
                                    <td className="py-2.5 px-3 text-[#64748b]">{row.leads}</td>
                                    <td className="py-2.5 px-3 text-[#64748b]">{row.connected}</td>
                                    <td className="py-2.5 px-3 text-[#22c55e] font-bold">{row.won}</td>
                                    <td className="py-2.5 px-3 text-[#ef4444]">{row.lost}</td>
                                    <td className="py-2.5 px-3 font-bold text-[#334155]">{winRate.toFixed(1)}%</td>
                                    <td className="py-2.5 px-3 text-[#64748b] font-semibold">{inr(row.revenue)}</td>
                                    <td className="py-2.5 px-3 text-[#64748b]">{row.spend > 0 ? inr(row.spend) : '—'}</td>
                                    <td className="py-2.5 px-3 text-[#64748b] max-w-[140px] truncate">{row.topSource || '—'}</td>
                                    <td className="py-2.5 px-3">
                                        <StatusPill status={status} />
                                    </td>
                                </tr>
                            );
                        })}
                        <tr className="bg-[#f8fafc] border-t-2 border-[#1e3a8a]">
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">TOTAL</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">{data.kpis.leads_received}</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">{data.kpis.leads_connected}</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">{data.monthly_trend.reduce((s, m) => s + m.won, 0)}</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">{data.monthly_trend.reduce((s, m) => s + m.lost, 0)}</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">{data.kpis.win_rate.toFixed(1)}%</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">{inr(data.kpis.won_revenue)}</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">{data.kpis.total_spend > 0 ? inr(data.kpis.total_spend) : '—'}</td>
                            <td className="py-2.5 px-3 font-bold text-[#1e3a8a]">—</td>
                            <td className="py-2.5 px-3">
                                {overallWinRate >= 20 ? (
                                    <span className="text-[#16a34a] font-bold">Excellent</span>
                                ) : (
                                    <span className="text-[#d97706] font-bold bg-[#fef3c7] px-1.5 py-0.5 rounded">Needs Attention</span>
                                )}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StatusPill({ status }: { status: 'excellent' | 'ontrack' | 'attention' | 'critical' }) {
    switch (status) {
        case 'excellent':
            return <span className="text-[#16a34a] font-bold">Excellent</span>;
        case 'ontrack':
            return <span className="text-[#64748b] font-bold">On Track</span>;
        case 'attention':
            return <span className="text-[#d97706] font-bold bg-[#fef3c7] px-1.5 py-0.5 rounded">Needs Attention</span>;
        case 'critical':
            return <span className="text-[#dc2626] font-bold bg-[#fee2e2] px-1.5 py-0.5 rounded">Critical</span>;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rep leaderboard
// ─────────────────────────────────────────────────────────────────────────────

function RepLeaderboard({ data }: { data: ImpactReportPayload }) {
    if (!data.rep_performance.length) return null;
    return (
        <div className="mb-4">
            <h3 className="text-[12px] font-bold text-[#1e3a8a] mb-2 px-1">
                Rep Leaderboard · {data.period.label}
            </h3>
            <div className="border border-[#1e3a8a] overflow-hidden rounded-sm overflow-x-auto">
                <table className="w-full text-[11px] text-left">
                    <thead className="bg-[#1e3a8a] text-white">
                        <tr>
                            {['Rep', 'Leads', 'Connected', 'Win Rate', 'Pipeline', 'Won', 'Avg Close', 'Status'].map((h) => (
                                <th key={h} className="py-2 px-3 font-bold border-r border-[#2C4A9E] last:border-r-0 whitespace-nowrap">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white">
                        {data.rep_performance.map((r, idx) => {
                            const status = r.win_rate >= 30 ? 'excellent'
                                : r.win_rate >= 15 ? 'ontrack'
                                : r.win_rate >= 8 ? 'attention'
                                : 'critical';
                            return (
                                <tr
                                    key={r.id}
                                    className={`border-b border-[#e2e8f0] ${idx === 0 ? 'bg-[#fefce8]' : ''}`}
                                >
                                    <td className="py-2.5 px-3 font-bold text-[#334155] whitespace-nowrap">
                                        {idx === 0 && <span className="text-[#ca8a04] mr-1">★</span>}
                                        {r.name}
                                    </td>
                                    <td className="py-2.5 px-3 text-[#64748b]">{r.leads}</td>
                                    <td className="py-2.5 px-3 text-[#64748b]">{r.connected}</td>
                                    <td className="py-2.5 px-3 font-bold text-[#334155]">{r.win_rate.toFixed(1)}%</td>
                                    <td className="py-2.5 px-3 text-[#64748b] font-semibold">{inr(r.pipeline)}</td>
                                    <td className="py-2.5 px-3 text-[#22c55e] font-bold">{inr(r.revenue)}</td>
                                    <td className="py-2.5 px-3 text-[#64748b]">
                                        {r.avg_days_to_close != null ? `${r.avg_days_to_close.toFixed(0)}d` : '—'}
                                    </td>
                                    <td className="py-2.5 px-3">
                                        <StatusPill status={status} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

function Footer({ orgName }: { orgName: string }) {
    return (
        <div className="flex justify-between items-center text-[9px] text-[#94a3b8] mt-4 px-1">
            <div className="font-bold text-[#1e3a8a]">CRM Impact Report · {orgName}</div>
            <div>Generated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · Sales Management System</div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter chips (campaigns + properties)
// ─────────────────────────────────────────────────────────────────────────────

function CampaignFilter({
    campaigns, selected, onChange, isOpen, onToggle,
}: {
    campaigns: ImpactReportPayload['filters']['campaigns'];
    selected: string[];
    onChange: (v: string[]) => void;
    isOpen: boolean;
    onToggle: () => void;
}) {
    return (
        <FilterDropdown
            isOpen={isOpen}
            onToggle={onToggle}
            onClose={() => onToggle()}
            label={selected.length === 0 ? 'All campaigns' : `${selected.length} campaign${selected.length === 1 ? '' : 's'}`}
            active={selected.length > 0}
        >
            <div className="space-y-1 max-h-64 overflow-y-auto">
                {campaigns.length === 0 && (
                    <div className="text-[11px] text-slate-500 px-2 py-2">No campaigns yet</div>
                )}
                {campaigns.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded text-[11px] cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selected.includes(c.id)}
                            onChange={(e) => {
                                onChange(
                                    e.target.checked
                                        ? [...selected, c.id]
                                        : selected.filter((x) => x !== c.id)
                                );
                            }}
                            className="rounded border-slate-300"
                        />
                        <span className="flex-1 truncate">{c.name}</span>
                        {c.channel && (
                            <span className="text-[9px] text-slate-500 uppercase">{c.channel}</span>
                        )}
                    </label>
                ))}
            </div>
        </FilterDropdown>
    );
}

function PropertyFilter({
    properties, selected, onChange, isOpen, onToggle,
}: {
    properties: ImpactReportPayload['filters']['properties'];
    selected: string[];
    onChange: (v: string[]) => void;
    isOpen: boolean;
    onToggle: () => void;
}) {
    return (
        <FilterDropdown
            isOpen={isOpen}
            onToggle={onToggle}
            onClose={() => onToggle()}
            label={selected.length === 0 ? 'All properties' : `${selected.length} propert${selected.length === 1 ? 'y' : 'ies'}`}
            active={selected.length > 0}
        >
            <div className="space-y-1 max-h-64 overflow-y-auto">
                {properties.length === 0 && (
                    <div className="text-[11px] text-slate-500 px-2 py-2">No properties configured</div>
                )}
                {properties.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded text-[11px] cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selected.includes(p.id)}
                            onChange={(e) => {
                                onChange(
                                    e.target.checked
                                        ? [...selected, p.id]
                                        : selected.filter((x) => x !== p.id)
                                );
                            }}
                            className="rounded border-slate-300"
                        />
                        <span className="flex-1 truncate">{p.name}</span>
                    </label>
                ))}
            </div>
        </FilterDropdown>
    );
}

function FilterDropdown({
    isOpen, onToggle, label, active, children, onClose,
}: {
    isOpen: boolean;
    onToggle: () => void;
    onClose: () => void;
    label: string;
    active: boolean;
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, onClose]);
    return (
        <div className="relative" ref={ref}>
            <button
                onClick={onToggle}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    active
                        ? 'bg-primary text-white'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
            >
                <Filter className="w-3.5 h-3.5" />
                {label}
            </button>
            {isOpen && (
                <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-2 w-72">
                    {children}
                </div>
            )}
        </div>
    );
}
