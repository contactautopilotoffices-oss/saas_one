'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { CRMSavedView, SavedViewFilters, LeadStatusConfig, LeadSource, ViewPeriodPreset } from '@/frontend/types/crm';
import { getSourceVisual } from '@/frontend/lib/crm/sourceIcons';
import { resolvePeriodPreset } from '@/frontend/lib/crm/views';

interface ViewBuilderProps {
    open: boolean;
    mode: 'create' | 'edit';
    // Seed for edit, or the captured "current filters" for a new view.
    initial?: { id?: string; name?: string; icon?: string | null; color?: string | null; filters?: SavedViewFilters; is_default?: boolean };
    onClose: () => void;
    onSaved: (view: CRMSavedView) => void;
}

const ICONS = ['📁', '🔥', '⭐', '📅', '📌', '💰', '🏙️', '🚀', '⚡', '🎯', '📞', '🧊'];
const COLORS = ['#6B7280', '#F97316', '#22C55E', '#3B82F6', '#8B5CF6', '#EF4444', '#0EA5E9', '#EAB308'];

const PERIOD_PRESETS: { key: ViewPeriodPreset; label: string }[] = [
    { key: 'this_week', label: 'This Week' },
    { key: 'last_week', label: 'Last Week' },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_month', label: 'Last Month' },
    { key: 'last_30', label: 'Last 30 Days' },
    { key: 'this_quarter', label: 'This Quarter' },
];

const DATE_FIELDS: { key: NonNullable<SavedViewFilters['period']>['date_field']; label: string }[] = [
    { key: 'created_at', label: 'Created' },
    { key: 'next_followup_date', label: 'Follow-up' },
    { key: 'last_contacted', label: 'Last contacted' },
];

const SEAT_RANGES = [
    { label: '< 25', value: 'lt25' },
    { label: '25–50', value: '25to50' },
    { label: '50–100', value: '50to100' },
    { label: '100+', value: 'gt100' },
];

const SORTS = [
    { label: 'Newest first', by: 'created_at', order: 'desc' as const },
    { label: 'Oldest first', by: 'created_at', order: 'asc' as const },
    { label: 'Follow-up date', by: 'next_followup_date', order: 'asc' as const },
    { label: 'Deal value (high→low)', by: 'deal_value', order: 'desc' as const },
    { label: 'Company (A→Z)', by: 'company_name', order: 'asc' as const },
];

export default function ViewBuilder({ open, mode, initial, onClose, onSaved }: ViewBuilderProps) {
    const { user, membership } = useAuth();
    const isBdRep = membership?.org_role === 'bd_rep';

    const [name, setName] = useState('');
    const [icon, setIcon] = useState<string>('📁');
    const [color, setColor] = useState<string>('#6B7280');
    const [isDefault, setIsDefault] = useState(false);
    const [filters, setFilters] = useState<SavedViewFilters>({ scope: 'all', period: { mode: 'any' } });

    const [statuses, setStatuses] = useState<LeadStatusConfig[]>([]);
    const [sources, setSources] = useState<LeadSource[]>([]);
    const [campaigns, setCampaigns] = useState<string[]>([]);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewCount, setPreviewCount] = useState<number | null>(null);
    const [previewing, setPreviewing] = useState(false);

    // Reset the form each time the modal opens.
    useEffect(() => {
        if (!open) return;
        setName(initial?.name || '');
        setIcon(initial?.icon || '📁');
        setColor(initial?.color || '#6B7280');
        setIsDefault(!!initial?.is_default);
        setFilters(initial?.filters ? { scope: 'all', period: { mode: 'any' }, ...initial.filters } : { scope: 'all', period: { mode: 'any' } });
        setError(null);
    }, [open, initial]);

    // Load the org's status / source / campaign options.
    useEffect(() => {
        if (!open) return;
        (async () => {
            try {
                const [settingsRes, campaignsRes] = await Promise.all([
                    fetch('/api/crm/settings?type=all&scope=bd'),
                    fetch('/api/crm/campaigns'),
                ]);
                if (settingsRes.ok) {
                    const d = await settingsRes.json();
                    setStatuses(d.statuses || []);
                    setSources(d.sources || []);
                }
                if (campaignsRes.ok) {
                    const d = await campaignsRes.json();
                    setCampaigns((d.campaigns || []).map((c: { name?: string }) => c.name).filter(Boolean));
                }
            } catch { /* non-fatal */ }
        })();
    }, [open]);

    const period = filters.period || { mode: 'any' };
    const setPeriod = (p: SavedViewFilters['period']) => setFilters(f => ({ ...f, period: p }));
    const toggleIn = (key: 'status' | 'lead_source' | 'city' | 'campaign', val: string) => {
        setFilters(f => {
            const cur = (f[key] as string[] | undefined) || [];
            const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
            return { ...f, [key]: next };
        });
    };

    // Build the count-preview query for the current draft filters. Reads
    // filters.period internally so the callback stays stable across renders
    // (a fresh {mode:'any'} literal in deps would spin the preview effect).
    const previewParams = useCallback((): string => {
        const per = filters.period || { mode: 'any' as const };
        const p = new URLSearchParams({ page: '1', page_size: '1' });
        if (filters.scope === 'mine' && user?.id) p.set('assigned_to', user.id);
        filters.status?.forEach(s => p.append('status', s));
        filters.lead_source?.forEach(s => p.append('lead_source', s));
        filters.city?.forEach(c => p.append('city', c));
        filters.campaign?.forEach(c => p.append('campaign', c));
        if (filters.seats_range) p.set('seats_range', filters.seats_range);
        if (per.mode !== 'any') {
            let from = '', to = '';
            if (per.mode === 'rolling' && per.preset) ({ from, to } = resolvePeriodPreset(per.preset));
            else { from = per.date_from || ''; to = per.date_to || ''; }
            if (from) p.set('date_from', from);
            if (to) p.set('date_to', to);
            if (per.date_field && per.date_field !== 'created_at') p.set('date_field', per.date_field);
        }
        return p.toString();
    }, [filters, user?.id]);

    // Debounced live preview.
    useEffect(() => {
        if (!open) return;
        setPreviewing(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/crm/leads?${previewParams()}`);
                if (res.ok) {
                    const d = await res.json();
                    setPreviewCount(d.pagination?.total ?? 0);
                }
            } catch { /* ignore */ }
            finally { setPreviewing(false); }
        }, 450);
        return () => clearTimeout(t);
    }, [open, previewParams]);

    const activeSort = useMemo(
        () => SORTS.find(s => s.by === (filters.sort_by || 'created_at') && s.order === (filters.sort_order || 'desc')) || SORTS[0],
        [filters.sort_by, filters.sort_order]
    );

    const defaultName = useMemo(() => {
        if (name.trim()) return name.trim();
        const parts: string[] = [];
        if (filters.period?.mode === 'fixed') {
            if (filters.period.date_from || filters.period.date_to) {
                parts.push(`${filters.period.date_from || ''} to ${filters.period.date_to || ''}`);
            } else {
                parts.push('Fixed Range');
            }
        } else if (filters.period?.mode === 'rolling' && filters.period.preset) {
            const labels: Record<string, string> = {
                this_week: 'This Week',
                last_week: 'Last Week',
                this_month: 'This Month',
                last_month: 'Last Month',
                last_30: 'Last 30 Days',
                this_quarter: 'This Quarter',
            };
            parts.push(labels[filters.period.preset] || 'Rolling');
        }
        if (filters.status?.length) {
            parts.push(`${filters.status.length} status${filters.status.length > 1 ? 'es' : ''}`);
        }
        if (filters.lead_source?.length) {
            parts.push(`${filters.lead_source.length} source${filters.lead_source.length > 1 ? 's' : ''}`);
        }
        return parts.join(' · ') || 'Custom View';
    }, [name, filters]);

    const handleSave = async () => {
        const viewName = name.trim() || defaultName;
        setSaving(true);
        setError(null);
        try {
            const action = mode === 'edit' ? 'update_view' : 'create_view';
            const payload = {
                action,
                data: {
                    ...(mode === 'edit' ? { id: initial?.id } : {}),
                    name: viewName,
                    icon,
                    color,
                    filters,
                    is_default: isDefault,
                },
            };
            const res = await fetch('/api/crm/views', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || 'Failed to save view');
            }
            const { view } = await res.json();
            onSaved(view);
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save view');
        } finally {
            setSaving(false);
        }
    };

    // Rendered through a portal to document.body: the page is wrapped in a
    // framer-motion transform (PageTransition), which would otherwise make this
    // fixed overlay resolve against the content column instead of the viewport.
    if (!open || typeof document === 'undefined') return null;

    const chip = (active: boolean) =>
        `px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
            active ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:border-primary/40'
        }`;

    return createPortal(
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-surface rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] my-auto flex flex-col overflow-hidden border border-border"
                >
                    {/* Header */}
                    <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
                        <h3 className="text-base font-bold text-text-primary">{mode === 'edit' ? 'Edit view' : 'Create view'}</h3>
                        <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-muted rounded-xl transition-colors">
                            <X className="w-5 h-5 text-text-secondary" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5 text-text-primary">
                        {/* Name / icon / color */}
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Name</label>
                            <div className="flex items-center gap-2">
                                <input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={`e.g. ${defaultName}`}
                                    autoFocus
                                    className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                />
                            </div>
                            <div className="flex items-center gap-4 mt-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {ICONS.map(i => (
                                        <button key={i} onClick={() => setIcon(i)}
                                            className={`w-8 h-8 rounded-lg text-base leading-none flex items-center justify-center border transition-colors ${icon === i ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'}`}
                                        >{i}</button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                                    {COLORS.map(c => (
                                        <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
                                            className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-text-primary' : 'border-transparent'}`}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* WHO */}
                        {!isBdRep && (
                            <div>
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Who</label>
                                <div className="flex gap-2">
                                    {([['all', 'All leads in my market'], ['mine', 'Only my leads']] as const).map(([k, label]) => (
                                        <button key={k} onClick={() => setFilters(f => ({ ...f, scope: k }))} className={chip((filters.scope || 'all') === k)}>{label}</button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* PERIOD */}
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Period</label>
                            <div className="flex gap-2 mb-2 flex-wrap">
                                {([['any', 'Any time'], ['rolling', 'Rolling'], ['fixed', 'Fixed range']] as const).map(([k, label]) => (
                                    <button key={k}
                                        onClick={() => setPeriod({ mode: k, date_field: period.date_field || 'created_at', preset: k === 'rolling' ? (period.preset || 'this_month') : undefined })}
                                        className={chip(period.mode === k)}>{label}</button>
                                ))}
                            </div>
                            {period.mode === 'rolling' && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {PERIOD_PRESETS.map(p => (
                                        <button key={p.key} onClick={() => setPeriod({ ...period, preset: p.key })} className={chip(period.preset === p.key)}>{p.label}</button>
                                    ))}
                                    <p className="w-full text-[11px] text-text-tertiary mt-1">Auto-advances — this tab always shows the current period.</p>
                                </div>
                            )}
                            {period.mode === 'fixed' && (
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <input type="date" value={period.date_from || ''} onChange={(e) => setPeriod({ ...period, date_from: e.target.value || undefined })}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                                    <span className="text-xs text-text-tertiary">to</span>
                                    <input type="date" value={period.date_to || ''} onChange={(e) => setPeriod({ ...period, date_to: e.target.value || undefined })}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                                </div>
                            )}
                            {period.mode !== 'any' && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[11px] text-text-tertiary">Date field:</span>
                                    {DATE_FIELDS.map(df => (
                                        <button key={df.key} onClick={() => setPeriod({ ...period, date_field: df.key })}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${(period.date_field || 'created_at') === df.key ? 'bg-primary/10 text-primary border-primary/40' : 'bg-surface text-text-secondary border-border'}`}>{df.label}</button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* STATUS */}
                        {statuses.length > 0 && (
                            <div>
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Status</label>
                                <div className="flex flex-wrap gap-2">
                                    {statuses.map(s => (
                                        <button key={s.id} onClick={() => toggleIn('status', s.id)} className={chip(!!filters.status?.includes(s.id))}
                                            style={filters.status?.includes(s.id) ? {} : { borderColor: s.color ? `${s.color}44` : undefined }}>
                                            {filters.status?.includes(s.id) && <span className="mr-1">✓</span>}{s.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* SOURCE */}
                        {sources.length > 0 && (
                            <div>
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Source</label>
                                <div className="flex flex-wrap gap-2">
                                    {sources.map(s => {
                                        const sv = getSourceVisual(s.name); const Icon = sv.icon;
                                        const active = !!filters.lead_source?.includes(s.id);
                                        return (
                                            <button key={s.id} onClick={() => toggleIn('lead_source', s.id)} className={`inline-flex items-center gap-1.5 ${chip(active)}`}>
                                                <Icon className="w-3.5 h-3.5" style={active ? {} : { color: sv.color }} />{s.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* CITY (admins) + SEATS */}
                        {!isBdRep && (
                            <div>
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">City</label>
                                <div className="flex flex-wrap gap-2">
                                    {['Mumbai', 'Bangalore', 'Noida'].map(c => (
                                        <button key={c} onClick={() => toggleIn('city', c)} className={chip(!!filters.city?.includes(c))}>{c}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Seat count</label>
                            <div className="flex flex-wrap gap-2">
                                {SEAT_RANGES.map(r => (
                                    <button key={r.value} onClick={() => setFilters(f => ({ ...f, seats_range: f.seats_range === r.value ? undefined : r.value }))} className={chip(filters.seats_range === r.value)}>{r.label}</button>
                                ))}
                            </div>
                        </div>

                        {/* CAMPAIGN */}
                        {campaigns.length > 0 && (
                            <div>
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Campaign</label>
                                <div className="flex flex-wrap gap-2">
                                    {campaigns.map(c => (
                                        <button key={c} onClick={() => toggleIn('campaign', c)} className={chip(!!filters.campaign?.includes(c))}>{c}</button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* SORT */}
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Sort</label>
                            <select
                                value={`${activeSort.by}:${activeSort.order}`}
                                onChange={(e) => { const [by, order] = e.target.value.split(':'); setFilters(f => ({ ...f, sort_by: by, sort_order: order as 'asc' | 'desc' })); }}
                                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            >
                                {SORTS.map(s => <option key={`${s.by}:${s.order}`} value={`${s.by}:${s.order}`}>{s.label}</option>)}
                            </select>
                        </div>

                        {/* Default */}
                        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded border-border" />
                            Open this view by default
                        </label>

                        {error && <p className="text-sm text-red-600">{error}</p>}
                    </div>

                    {/* Footer */}
                    <div className="flex-shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                        <span className="text-sm text-text-secondary inline-flex items-center gap-1.5">
                            {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="font-bold text-text-primary">{previewCount ?? '—'}</span>}
                            leads match
                        </span>
                        <div className="flex items-center gap-3">
                            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl transition-colors">Cancel</button>
                            <button onClick={handleSave} disabled={saving}
                                className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                {mode === 'edit' ? 'Save changes' : 'Save view'}
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>,
        document.body
    );
}
