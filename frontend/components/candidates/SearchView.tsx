'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Download, ListFilter, Sparkles, X } from 'lucide-react';
import {
    blankFields, EMPTY_FILTERS, filterChips, hasActiveFilter, SORT_LABELS, SORTS,
    type FieldAvailability, type FilterResponse, type FilterSort, type PreferredItem, type SearchFilters, type UnderstandResponse,
} from '@/backend/lib/candidates/filters';
import type { Preferences } from '@/backend/lib/candidates/query-spec';
import { RECORD_STATUSES, STATUS_LABELS, type CandidateRecord, type RecordStatus, type SearchResponse, type SearchResult } from '@/backend/lib/candidates/types';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api } from './api';
import CandidateDetails from './CandidateDetails';
import { downloadCsv, recordsToCsv } from './export-csv';
import type { PanelToggleVariant } from '@/frontend/components/ui/PanelToggle';
import FilterRail, { FilterStrip } from './FilterRail';
import { formatCount } from './format';
import KeywordBar from './KeywordBar';
import QuickView from './QuickView';
import RecordForm from './RecordForm';
import ResultCard from './ResultCard';
import UnderstoodCard from './UnderstoodCard';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dropdown, Spinner, useUi, WELL, type DropdownOption } from './ui';

/**
 * The search screen (owner 2026-11-06): keywords and filters change the list at once, straight from the database. AI is
 * optional: it can read a job description into these filters, and rank the current list on request.
 *
 * Redesign (owner 2026-11-11): the same filters, keyword bar and AI ranking, with denser result cards that show the
 * resume lines around the keywords, tick boxes for bulk actions (status, export), and on a wide screen a quick view
 * of the candidate whose name was clicked, beside the list. Opening a candidate shows the resume beside the details.
 */

const PAGE_SIZE = 20;
const RAIL_MIN = 260;
const RAIL_MAX = 520;
const RAIL_DEFAULT = 280;
/** Keep at least this much for the list beside the panel, gap included. */
const LIST_MIN = 416;
/** Space on the row, so a collapsed app sidebar counts: under OVER_WIDTH the panel slides over; under OPEN_WIDTH it starts as a strip. */
const OVER_WIDTH = 698;
const OPEN_WIDTH = 928;
const RAIL_STORE = 'candidate-search-filters';
/** The quick view beside the list: its width, and the row width from which there is room for it. */
const QUICK_WIDTH = 380;
const QUICK_FROM = 1160;
/** Status changes sent at the same time by "Set status" on the ticked candidates. */
const BULK_PARALLEL = 4;

type SortValue = FilterSort | 'match';

interface RailPrefs { width: number; collapsed: boolean | null }

function readRail(): RailPrefs {
    try {
        const saved = JSON.parse(localStorage.getItem(RAIL_STORE) ?? '{}') as Partial<RailPrefs>;
        const width = typeof saved.width === 'number' ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, saved.width)) : RAIL_DEFAULT;
        return { width, collapsed: typeof saved.collapsed === 'boolean' ? saved.collapsed : null };
    } catch {
        return { width: RAIL_DEFAULT, collapsed: null };
    }
}

function saveRail(prefs: RailPrefs) {
    try { localStorage.setItem(RAIL_STORE, JSON.stringify(prefs)); } catch { /* a remembered width is only a convenience */ }
}

function plainResult(record: CandidateRecord, index: number): SearchResult {
    return { rank: index + 1, record, matchPercent: null, criteria: [], reasons: [], missing: [], summary: record.remark ?? '' };
}

export default function SearchView({ orgId, dataVersion, onDataChanged, collapseStyle = 'panel' }: {
    orgId: string; dataVersion: number; onDataChanged: () => void;
    /** The filters' collapse button follows the host console's sidebar button (owner 2026-11-09). */
    collapseStyle?: PanelToggleVariant;
}) {
    const { notify, reportError } = useUi();
    const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
    const [page, setPage] = useState(1);
    const [list, setList] = useState<{ key: string; total: number; blankCount: number; records: CandidateRecord[] } | null>(null);
    const [listError, setListError] = useState('');
    const [loading, setLoading] = useState(true);
    const [ranked, setRanked] = useState<SearchResponse | null>(null);
    const [ranking, setRanking] = useState(false);
    const [notices, setNotices] = useState<string[]>([]);
    const [prefer, setPrefer] = useState<Preferences>({});
    const [preferred, setPreferred] = useState<PreferredItem[]>([]);
    const [jobText, setJobText] = useState('');
    const [jobNote, setJobNote] = useState('');
    const [reading, setReading] = useState(false);
    const [statusBusy, setStatusBusy] = useState<Record<string, boolean>>({});
    const [loosen, setLoosen] = useState<{ label: string; count: number; clear: Partial<SearchFilters> } | null>(null);
    const [details, setDetails] = useState<{ record: CandidateRecord; open: boolean } | null>(null);
    const [editor, setEditor] = useState<{ record: CandidateRecord; key: number; open: boolean } | null>(null);
    const [availability, setAvailability] = useState<FieldAvailability | null>(null);
    // Ticked candidates belong to one set of filters; another search starts with nothing ticked.
    const [pickedState, setPickedState] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
    const [bulkBusy, setBulkBusy] = useState(false);
    /** The candidate shown in the quick view. Owner 2026-11-11: it is closed until a card is clicked. */
    const [focusId, setFocusId] = useState<string | null>(null);

    const rowRef = useRef<HTMLDivElement | null>(null);
    const [rowWidth, setRowWidth] = useState<number | null>(null);
    const [rail, setRail] = useState<RailPrefs>({ width: RAIL_DEFAULT, collapsed: null });
    const [overOpen, setOverOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<{ x: number; width: number; max: number } | null>(null);

    useEffect(() => { setRail(readRail()); }, []);
    useEffect(() => {
        const row = rowRef.current;
        if (!row) return;
        const observer = new ResizeObserver(() => setRowWidth(row.clientWidth));
        observer.observe(row);
        return () => observer.disconnect();
    }, []);

    const over = rowWidth !== null && rowWidth < OVER_WIDTH;
    const collapsed = !over && (rail.collapsed ?? (rowWidth !== null && rowWidth < OPEN_WIDTH));
    /** The row is wide enough for the quick view beside the list (on a narrow one a card opens the full profile). */
    const canQuick = rowWidth !== null && rowWidth >= QUICK_FROM;

    const changeRail = (patch: Partial<RailPrefs>) => setRail(r => {
        const next = { ...r, ...patch };
        saveRail(next);
        return next;
    });

    const update = useCallback((patch: Partial<SearchFilters>) => {
        setFilters(f => ({ ...f, ...patch }));
        setPage(1);
        setRanked(null);
        setNotices([]);
    }, []);

    // Which resume filters have data yet; the rest stay greyed out. Refreshed after an upload or an edit.
    useEffect(() => {
        const ctrl = new AbortController();
        void api<FieldAvailability>(`/api/candidates/filter-fields?orgId=${encodeURIComponent(orgId)}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted && res.ok) setAvailability(res.data);
        });
        return () => ctrl.abort();
    }, [orgId, dataVersion]);

    // The list: a short pause after a change, and the old list stays up meanwhile, so nothing flashes.
    const filterKey = JSON.stringify(filters);
    useEffect(() => {
        const ctrl = new AbortController();
        setLoading(true);
        const t = setTimeout(() => {
            void api<FilterResponse>('/api/candidates/filter', { json: { orgId, filters, page, pageSize: PAGE_SIZE }, signal: ctrl.signal }).then(res => {
                if (ctrl.signal.aborted) return;
                setLoading(false);
                if (!res.ok) { setListError(res.error); if (res.noAccess) reportError(res); return; }
                setListError('');
                setList(prev => ({
                    key: filterKey,
                    total: res.data.total,
                    blankCount: res.data.blankCount,
                    records: page > 1 && prev?.key === filterKey ? [...prev.records, ...res.data.records.filter(r => !prev.records.some(x => x.id === r.id))] : res.data.records,
                }));
            });
        }, page > 1 ? 0 : 250);
        return () => { clearTimeout(t); ctrl.abort(); };
        // filterKey stands for filters; dataVersion refetches after an edit, an upload or a delete in another view.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterKey, page, orgId, dataVersion, reportError]);

    // No results: find the one filter whose removal brings back the most candidates.
    const total = list?.key === filterKey ? list.total : null;
    const blankCount = list?.key === filterKey ? list.blankCount : 0;
    useEffect(() => {
        setLoosen(null);
        if (total !== 0) return;
        const chips = filterChips(filters).slice(0, 8);
        if (!chips.length) return;
        const ctrl = new AbortController();
        void Promise.all(chips.map(async chip => {
            const res = await api<FilterResponse>('/api/candidates/filter', { json: { orgId, filters: { ...filters, ...chip.clear }, page: 1, pageSize: 1 }, signal: ctrl.signal });
            return { chip, count: res.ok ? res.data.total : 0 };
        })).then(all => {
            if (ctrl.signal.aborted) return;
            const best = all.filter(a => a.count > 0).sort((a, b) => b.count - a.count)[0];
            if (best) setLoosen({ label: best.chip.label, count: best.count, clear: best.chip.clear });
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [total, filterKey, orgId]);

    const clearAll = () => {
        setFilters(f => ({ ...EMPTY_FILTERS, sort: f.sort, expBasis: f.expBasis, salaryBasis: f.salaryBasis, salaryUnit: f.salaryUnit }));
        setPage(1);
        setRanked(null);
        setNotices([]);
        setPrefer({});
        setPreferred([]);
        setJobText('');
        setJobNote('');
    };

    const removePreferred = (key: PreferredItem['key']) => {
        setPrefer(p => { const next = { ...p }; delete next[key]; return next; });
        setPreferred(items => items.filter(i => i.key !== key));
        setRanked(null);
    };

    const readJob = async (text: string): Promise<boolean> => {
        setReading(true);
        setJobNote('');
        const res = await api<UnderstandResponse>('/api/candidates/understand', { json: { orgId, text } });
        setReading(false);
        if (!res.ok) { setJobNote(res.error); if (res.noAccess) reportError(res); return false; }
        if (!res.data.aiParsed) { setJobNote(res.data.notices[0] ?? 'Nothing could be read from that.'); return false; }
        update(res.data.filters);
        setPrefer(res.data.prefer);
        setPreferred(res.data.preferred);
        setJobText(res.data.summary);
        setJobNote('Filled in from the job description. Check the filters and change anything you need.');
        return true;
    };

    const rank = async () => {
        setRanking(true);
        setNotices([]);
        const res = await api<SearchResponse>('/api/candidates/rank', { json: { orgId, filters, prefer, jobText } });
        setRanking(false);
        if (!res.ok) { setNotices([res.error]); if (res.noAccess) reportError(res); return; }
        setNotices(res.data.notices);
        if (res.data.aiRanked) setRanked(res.data);
    };

    // The saved record replaces the one on screen; what only the list knows (the resume lines for these keywords) stays.
    const replaceRecord = (record: CandidateRecord) => {
        const merge = (old: CandidateRecord): CandidateRecord => ({ ...old, ...record });
        setList(prev => prev && { ...prev, records: prev.records.map(r => (r.id === record.id ? merge(r) : r)) });
        setRanked(prev => prev && { ...prev, results: prev.results.map(x => (x.record.id === record.id ? { ...x, record: merge(x.record) } : x)) });
        setDetails(d => (d && d.record.id === record.id ? { ...d, record: merge(d.record) } : d));
    };

    const changeStatus = async (record: CandidateRecord, status: RecordStatus) => {
        if (status === record.status) return;
        setStatusBusy(b => ({ ...b, [record.id]: true }));
        const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}`, { method: 'PATCH', json: { orgId, status } });
        setStatusBusy(b => ({ ...b, [record.id]: false }));
        if (!res.ok) { reportError(res); return; }
        replaceRecord(res.data.record);
        notify(`${record.fullName}: status updated`, 'success');
        onDataChanged();
    };

    const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { x: e.clientX, width: rail.width, max: Math.max(RAIL_DEFAULT, Math.min(RAIL_MAX, (rowWidth ?? 0) - LIST_MIN - (canQuick && focusId ? QUICK_WIDTH + 16 : 0))) };
        setDragging(true);
    };
    const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        const d = dragRef.current;
        if (d) setRail(r => ({ ...r, width: Math.max(RAIL_MIN, Math.min(d.max, d.width + e.clientX - d.x)) }));
    };
    const onHandleUp = () => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDragging(false);
        setRail(r => { saveRail(r); return r; });
    };
    const onHandleKey = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        changeRail({ width: Math.max(RAIL_MIN, Math.min(RAIL_MAX, rail.width + (e.key === 'ArrowRight' ? 16 : -16))) });
    };

    const records = list?.records ?? [];
    const results: SearchResult[] = ranked ? ranked.results : records.map(plainResult);
    const active = hasActiveFilter(filters) || preferred.length > 0;
    const activeCount = filterChips(filters).length + filters.keywords.length + filters.excludes.length;
    const sortOptions = useMemo<DropdownOption<SortValue>[]>(() => [
        ...(ranked ? [{ value: 'match' as const, label: 'Best AI match' }] : []),
        ...SORTS.map(value => ({ value, label: SORT_LABELS[value] })),
    ], [ranked]);
    const canShowMore = !ranked && total !== null && records.length < total;
    const showBlanks = blankCount > 0 && !ranked;

    // Bulk actions on the ticked candidates (owner 2026-11-11).
    const picked = pickedState.key === filterKey ? pickedState.ids : [];
    const pickedRecords = results.map(x => x.record).filter(r => picked.includes(r.id));
    const allPicked = results.length > 0 && results.every(x => picked.includes(x.record.id));
    const pick = (record: CandidateRecord, on: boolean) => setPickedState({ key: filterKey, ids: on ? [...picked.filter(id => id !== record.id), record.id] : picked.filter(id => id !== record.id) });
    const pickAll = (on: boolean) => setPickedState({ key: filterKey, ids: on ? results.map(x => x.record.id) : [] });
    const exportPicked = () => {
        if (!pickedRecords.length) return;
        downloadCsv(`candidates-${new Date().toISOString().slice(0, 10)}.csv`, recordsToCsv(pickedRecords));
        notify(`${formatCount(pickedRecords.length)} ${pickedRecords.length === 1 ? 'candidate' : 'candidates'} exported`, 'success');
    };
    const bulkStatus = async (status: RecordStatus) => {
        const targets = pickedRecords.filter(r => r.status !== status);
        if (!targets.length || bulkBusy) return;
        setBulkBusy(true);
        let done = 0;
        let failed = 0;
        let next = 0;
        const lane = async () => {
            while (next < targets.length) {
                const record = targets[next];
                next += 1;
                const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}`, { method: 'PATCH', json: { orgId, status } });
                if (res.ok) { replaceRecord(res.data.record); done += 1; } else { failed += 1; if (res.noAccess) reportError(res); }
            }
        };
        await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, targets.length) }, lane));
        setBulkBusy(false);
        if (done) { notify(`${formatCount(done)} ${done === 1 ? 'candidate' : 'candidates'} set to ${STATUS_LABELS[status]}${failed ? `; ${formatCount(failed)} could not be changed` : ''}`, failed ? 'info' : 'success'); onDataChanged(); }
        else if (failed) notify('The status could not be changed. Please try again.', 'error');
    };

    // Open only for a card that was clicked and is still in the list; a new search that drops it closes the view.
    const focused = canQuick && focusId ? results.find(x => x.record.id === focusId) ?? null : null;

    return (
        <div className="space-y-4">
            <KeywordBar orgId={orgId} filters={filters} update={update} reading={reading} onReadJob={readJob} jobNote={jobNote} />

            <div ref={rowRef} className="flex items-start gap-x-4 gap-y-4">
                {over && overOpen && <button type="button" aria-label="Close filters" onClick={() => setOverOpen(false)} className="fixed inset-0 z-[79] bg-slate-900/30" />}

                <div
                    style={over ? undefined : { flexBasis: collapsed ? 56 : rail.width }}
                    className={over
                        ? `fixed inset-y-0 left-0 z-[80] w-[min(360px,100vw)] transition-[transform,visibility] duration-300 ease-[var(--w-ease-patient)] motion-reduce:transition-none ${overOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`
                        : `sticky top-[var(--panel-sticky-top,5rem)] min-w-0 shrink-0 grow-0 ${dragging ? '' :'transition-[flex-basis] duration-300 ease-[var(--w-ease-patient)] motion-reduce:transition-none'}`}
                >
                    <aside aria-label="Filters" className={`${over ? 'h-full rounded-none' : 'max-h-[calc(100dvh/var(--app-zoom,1)-6rem)]'} ${CARD} overflow-y-auto overscroll-contain ${collapsed ? 'p-1.5' : 'px-4 py-4'}`}>
                        {collapsed
                            ? <FilterStrip activeCount={activeCount} onExpand={() => changeRail({ collapsed: false })} collapseStyle={collapseStyle} />
                            : (
                                <FilterRail
                                    collapseStyle={collapseStyle}
                                    orgId={orgId}
                                    filters={filters}
                                    update={update}
                                    availability={availability}
                                    canClear={active}
                                    onClear={clearAll}
                                    onCollapse={() => (over ? setOverOpen(false) : changeRail({ collapsed: true }))}
                                    collapseLabel={over ? 'Close filters' : 'Collapse filters'}
                                />
                            )}
                    </aside>
                    {!over && !collapsed && (
                        <button
                            type="button"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize filters. Use the left and right arrow keys."
                            aria-valuemin={RAIL_MIN}
                            aria-valuemax={RAIL_MAX}
                            aria-valuenow={rail.width}
                            title="Drag to resize. Double-click to reset."
                            onPointerDown={onHandleDown}
                            onPointerMove={onHandleMove}
                            onPointerUp={onHandleUp}
                            onPointerCancel={onHandleUp}
                            onKeyDown={onHandleKey}
                            onDoubleClick={() => changeRail({ width: RAIL_DEFAULT })}
                            className="group absolute inset-y-0 -right-3.5 flex w-3 cursor-col-resize touch-none items-center justify-center rounded-md"
                        >
                            <span className="block h-10 w-1 rounded-full bg-border transition-all duration-200 group-hover:h-16 group-hover:bg-primary group-focus-visible:h-16 group-focus-visible:bg-primary group-active:h-16 group-active:bg-primary" aria-hidden />
                        </button>
                    )}
                </div>

                <section aria-label="Search results" className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                            {over && (
                                <button type="button" onClick={() => setOverOpen(true)} aria-expanded={overOpen} className={`${BTN_SECONDARY} h-9 px-3`}>
                                    <ListFilter className="h-4 w-4" aria-hidden />{activeCount ? `Filters (${activeCount})` : 'Filters'}
                                </button>
                            )}
                            <p role="status" className="flex items-center gap-x-2 gap-y-2 font-display text-lg font-semibold text-text-primary">
                                {total === null ? 'Loading…' : `${formatCount(total)} ${total === 1 ? 'candidate' : 'candidates'}`}
                                {loading && total !== null && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                            <span className="text-[13px] font-semibold text-text-secondary">Sort</span>
                            <div className="w-[218px]">
                                <Dropdown
                                    variant="compact"
                                    label="Sort"
                                    value={ranked ? 'match' : filters.sort}
                                    options={sortOptions}
                                    onChange={value => { if (value !== 'match') update({ sort: value }); }}
                                />
                            </div>
                            <button type="button" onClick={() => void rank()} disabled={ranking || !total || !!ranked} className={`${BTN_PRIMARY} h-9 rounded-[10px] px-3`}>
                                {ranking ? <Spinner /> : <Sparkles className="h-4 w-4" aria-hidden />}{ranking ? 'Comparing…' : ranked ? 'Ranked' : 'Rank with AI'}
                            </button>
                        </div>
                    </div>

                    {active && (
                        <UnderstoodCard
                            filters={filters}
                            update={update}
                            preferred={preferred}
                            onRemovePreferred={removePreferred}
                            total={ranked?.matchingCount ?? total ?? 0}
                            shown={results.length}
                            comparedCount={ranked?.comparedCount ?? null}
                        />
                    )}

                    {showBlanks && (
                        <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-text-secondary">
                            {filters.includeBlank
                                ? `Showing ${formatCount(blankCount)} with blank details.`
                                : `${formatCount(blankCount)} more ${blankCount === 1 ? 'has' : 'have'} blank details.`}
                            <button type="button" onClick={() => update({ includeBlank: !filters.includeBlank })} className="font-bold text-primary-dark underline">
                                {filters.includeBlank ? 'Hide them' : 'Show them'}
                            </button>
                        </p>
                    )}

                    {ranked && (
                        <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-text-secondary">
                            Ranked by AI.
                            <button type="button" onClick={() => setRanked(null)} className="font-bold text-primary-dark underline">Remove ranking</button>
                        </p>
                    )}

                    {notices.length > 0 && (
                        <ul className="space-y-2" aria-live="polite">
                            {notices.map(n => (
                                <li key={n} className={`${WELL} flex gap-2.5 border-l-2 border-warning px-4 py-3 text-sm text-text-primary`}>
                                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />{n}
                                </li>
                            ))}
                        </ul>
                    )}

                    {listError && (
                        <p role="alert" className={`${CARD} flex gap-x-3 gap-y-3 border-l-2 border-error px-4 py-4 text-sm text-text-primary`}>
                            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden />{listError}
                        </p>
                    )}

                    {!list && !listError && [0, 1, 2].map(i => (
                        <div key={i} className={`${CARD} space-y-3 px-4 py-4 sm:p-6`}>
                            <div className="flex gap-x-3 gap-y-3"><Skeleton className="h-8 w-8 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/2" /></div></div>
                            <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" />
                        </div>
                    ))}

                    {total === 0 && !listError && (
                        <div className={`${CARD} flex flex-col items-center gap-x-2 gap-y-2 px-4 py-10 text-center`}>
                            <p className="font-display text-base font-semibold text-text-primary">{active ? 'No candidates match' : 'No candidates yet'}</p>
                            {loosen
                                ? <button type="button" onClick={() => update(loosen.clear)} className={BTN_PRIMARY}>Remove {loosen.label} to see {formatCount(loosen.count)} {loosen.count === 1 ? 'candidate' : 'candidates'}</button>
                                : <p className="text-sm text-text-secondary">{active ? 'Try removing a few filters or keywords.' : 'Upload a sheet from the Sheets tab to get started.'}</p>}
                        </div>
                    )}

                    {results.length > 0 && (
                        <div className={`${WELL} flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5`} aria-live="polite">
                            <label className="inline-flex cursor-pointer items-center gap-x-2 gap-y-2 text-sm font-semibold text-text-secondary">
                                <input type="checkbox" checked={allPicked} onChange={e => pickAll(e.target.checked)} className="h-4 w-4 accent-[var(--primary-dark)]" />
                                {pickedRecords.length ? <span className="text-text-primary"><span className="tabular-nums">{formatCount(pickedRecords.length)}</span> selected</span> : 'Select all shown'}
                            </label>
                            {pickedRecords.length > 0 && (
                                <>
                                    <button type="button" onClick={() => pickAll(false)} className={`${BTN_GHOST} h-8`}><X className="h-3.5 w-3.5" />Clear</button>
                                    <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2">
                                        {bulkBusy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                                        <select
                                            aria-label="Set the status of the selected candidates"
                                            value=""
                                            disabled={bulkBusy}
                                            onChange={e => { if (e.target.value) void bulkStatus(e.target.value as RecordStatus); }}
                                            className="h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-sm font-semibold text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                                        >
                                            <option value="">Set status…</option>
                                            {RECORD_STATUSES.map(st => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                                        </select>
                                        <button type="button" onClick={exportPicked} className={`${BTN_SECONDARY} h-8 rounded-lg px-3`}><Download className="h-4 w-4" />Export to Excel</button>
                                    </span>
                                </>
                            )}
                        </div>
                    )}

                    <ol className="space-y-3">
                        {results.map(res => (
                            <li key={res.record.id}>
                                <ResultCard
                                    result={res}
                                    blankFields={filters.includeBlank ? blankFields(res.record, filters) : []}
                                    statusBusy={!!statusBusy[res.record.id]}
                                    onStatus={changeStatus}
                                    onOpen={record => setDetails({ record, open: true })}
                                    checked={picked.includes(res.record.id)}
                                    onCheck={pick}
                                    focused={focused?.record.id === res.record.id}
                                    onFocus={canQuick ? record => setFocusId(record.id) : undefined}
                                />
                            </li>
                        ))}
                    </ol>

                    {canShowMore && (
                        <div className="flex justify-center">
                            <button type="button" onClick={() => setPage(p => p + 1)} disabled={loading} className={BTN_SECONDARY}>
                                {loading && <Spinner />}Show more ({formatCount((total ?? 0) - records.length)} left)
                            </button>
                        </div>
                    )}
                </section>

                {focused && (
                    <div style={{ flexBasis: QUICK_WIDTH }} className="sticky top-[var(--panel-sticky-top,5rem)] min-w-0 shrink-0 grow-0">
                        <QuickView
                            result={focused}
                            onOpen={record => setDetails({ record, open: true })}
                            onStatus={changeStatus}
                            statusBusy={!!statusBusy[focused.record.id]}
                            onClose={() => setFocusId(null)}
                        />
                    </div>
                )}
            </div>

            {details && (
                <CandidateDetails
                    orgId={orgId}
                    onChanged={onDataChanged}
                    keywords={filters.keywords.map(k => k.text)}
                    record={details.record}
                    open={details.open}
                    onClose={() => setDetails(d => (d ? { ...d, open: false } : d))}
                    onEdit={() => {
                        setDetails(d => (d ? { ...d, open: false } : d));
                        setEditor(e => ({ record: details.record, key: (e?.key ?? 0) + 1, open: true }));
                    }}
                />
            )}
            {editor && (
                <RecordForm
                    key={editor.key}
                    orgId={orgId}
                    record={editor.record}
                    open={editor.open}
                    onClose={() => setEditor(e => (e ? { ...e, open: false } : e))}
                    onSaved={record => {
                        replaceRecord(record);
                        setEditor(e => (e ? { ...e, open: false } : e));
                        setDetails({ record, open: true });
                        onDataChanged();
                    }}
                />
            )}
        </div>
    );
}
