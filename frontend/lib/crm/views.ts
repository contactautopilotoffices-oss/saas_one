// Resolve a saved view into the concrete filter bundle the leads table + API
// consume. Rolling periods (e.g. "This month") are computed at resolve time, so
// they always reflect the current month/week — the tab never needs recreating.

import { CRMSavedView, SavedViewFilters, ViewPeriodPreset } from '@/frontend/types/crm';

// The table's internal applied-filter shape (kept in sync with LeadsTable).
export interface ViewAppliedFilters {
    status?: string[];
    campaign?: string[];
    city?: string[];
    lead_source?: string[];
    date_from?: string;
    date_to?: string;
    week?: 'this_week' | 'last_week';
    month?: string;
    seats_range?: string;
    date_field?: string;
}

// A fully-resolved view that drives the table's scope / filters / sort / search.
export interface ResolvedView {
    key: string;                 // view id, or 'all' for the built-in tab
    scope: 'mine' | 'all';
    search: string;
    appliedFilters: ViewAppliedFilters;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
}

// The built-in first tab — everything the user can see, newest first.
export const ALL_LEADS_VIEW: ResolvedView = {
    key: 'all',
    scope: 'all',
    search: '',
    appliedFilters: {},
    sortBy: 'created_at',
    sortOrder: 'desc',
};

function fmtLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function mondayOf(d: Date): Date {
    const x = new Date(d);
    const dow = x.getDay();                 // 0 = Sun
    const offset = dow === 0 ? -6 : 1 - dow; // back to Monday
    x.setDate(x.getDate() + offset);
    x.setHours(0, 0, 0, 0);
    return x;
}

// Turn a rolling preset into an inclusive [from, to] date pair (local time).
export function resolvePeriodPreset(preset: ViewPeriodPreset, now: Date = new Date()): { from: string; to: string } {
    switch (preset) {
        case 'this_week': {
            const mon = mondayOf(now);
            const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
            return { from: fmtLocal(mon), to: fmtLocal(sun) };
        }
        case 'last_week': {
            const mon = mondayOf(now);
            const lastMon = new Date(mon); lastMon.setDate(mon.getDate() - 7);
            const lastSun = new Date(mon); lastSun.setDate(mon.getDate() - 1);
            return { from: fmtLocal(lastMon), to: fmtLocal(lastSun) };
        }
        case 'this_month': {
            const first = new Date(now.getFullYear(), now.getMonth(), 1);
            const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return { from: fmtLocal(first), to: fmtLocal(last) };
        }
        case 'last_month': {
            const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const last = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: fmtLocal(first), to: fmtLocal(last) };
        }
        case 'last_30': {
            const to = new Date(now); to.setHours(0, 0, 0, 0);
            const from = new Date(to); from.setDate(to.getDate() - 29);
            return { from: fmtLocal(from), to: fmtLocal(to) };
        }
        case 'this_quarter': {
            const q = Math.floor(now.getMonth() / 3);
            const first = new Date(now.getFullYear(), q * 3, 1);
            const last = new Date(now.getFullYear(), q * 3 + 3, 0);
            return { from: fmtLocal(first), to: fmtLocal(last) };
        }
        default:
            return { from: '', to: '' };
    }
}

export function resolveView(view: CRMSavedView): ResolvedView {
    const f: SavedViewFilters = view.filters || {};
    const applied: ViewAppliedFilters = {};

    if (f.status?.length) applied.status = f.status;
    if (f.lead_source?.length) applied.lead_source = f.lead_source;
    if (f.city?.length) applied.city = f.city;
    if (f.campaign?.length) applied.campaign = f.campaign;
    if (f.seats_range) applied.seats_range = f.seats_range;

    const p = f.period;
    if (p && p.mode !== 'any') {
        if (p.mode === 'rolling' && p.preset) {
            const { from, to } = resolvePeriodPreset(p.preset);
            if (from) applied.date_from = from;
            if (to) applied.date_to = to;
        } else if (p.mode === 'fixed') {
            if (p.date_from) applied.date_from = p.date_from;
            if (p.date_to) applied.date_to = p.date_to;
        }
        if (p.date_field && p.date_field !== 'created_at') applied.date_field = p.date_field;
    }

    return {
        key: view.id,
        scope: f.scope === 'mine' ? 'mine' : 'all',
        search: f.search || '',
        appliedFilters: applied,
        sortBy: f.sort_by || 'created_at',
        sortOrder: f.sort_order === 'asc' ? 'asc' : 'desc',
    };
}

// Reverse: capture the table's current live state as a persistable filter
// bundle ("Save current filters as a view"). Concrete date ranges are frozen as
// a fixed period; the Week quick-filter is preserved as a rolling preset.
export function liveStateToFilters(state: ResolvedView): SavedViewFilters {
    const a = state.appliedFilters;
    const f: SavedViewFilters = {
        scope: state.scope,
        sort_by: state.sortBy,
        sort_order: state.sortOrder,
    };
    if (state.search) f.search = state.search;
    if (a.status?.length) f.status = a.status;
    if (a.lead_source?.length) f.lead_source = a.lead_source;
    if (a.city?.length) f.city = a.city;
    if (a.campaign?.length) f.campaign = a.campaign;
    if (a.seats_range) f.seats_range = a.seats_range;

    const dateField = (a.date_field as SavedViewPeriodField) || 'created_at';
    if (a.week === 'this_week' || a.week === 'last_week') {
        f.period = { mode: 'rolling', preset: a.week, date_field: dateField };
    } else if (a.date_from || a.date_to) {
        f.period = { mode: 'fixed', date_from: a.date_from, date_to: a.date_to, date_field: dateField };
    } else {
        f.period = { mode: 'any' };
    }
    return f;
}

type SavedViewPeriodField = 'created_at' | 'next_followup_date' | 'last_contacted';
