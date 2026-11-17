'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, Building2, CalendarDays, CalendarX, ChevronRight, Clock, Coins, Download,
    IndianRupee, Layers, Loader2, Lock, User, UserCog, Users, Wallet,
} from 'lucide-react';
import type {
    RevenueBookingLine, RevenueClient, RevenueReport, RevenueRoomTotals, RevenueView,
} from '@/backend/lib/meetingRooms/revenue';

/**
 * Meeting room revenue for one property and one month.
 * Reads GET /api/meeting-rooms/revenue; the split rules live in backend/lib/meetingRooms/revenue.ts.
 *
 * Visual language follows the sibling panels (AdminCreditsPanel, AdminBookingList):
 * white rounded-2xl cards with border-slate-100 + shadow-sm, font-black uppercase micro
 * labels at 9 to 10px, slate palette, primary for the one number that matters (billable).
 * The view toggle reuses the tab-pill recipe from AdminRoomManager (bg-slate-50 p-1 track,
 * bg-white shadow-sm active pill).
 *
 * View: 'clients' (default) covers companies and tenants, the only revenue. 'internal' covers
 * staff, admins and internal teams, hours only. 'all' covers both; money still comes from clients.
 */

interface AdminRevenuePanelProps {
    propertyId: string;
}

type RevenueResponse = RevenueReport & {
    property: { id: string; name: string };
    month: string;
    rateColumnMissing: boolean;
};

type LoadState =
    | { kind: 'loading' }
    | { kind: 'ready'; data: RevenueResponse }
    | { kind: 'forbidden' }
    | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const inr = (n: number) =>
    (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const hrs = (n: number) =>
    (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const isValidMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

const monthLabel = (m: string) => {
    if (!isValidMonth(m)) return '';
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const VIEWS: { id: RevenueView; label: string; icon: React.ElementType }[] = [
    { id: 'clients', label: 'Clients', icon: Building2 },
    { id: 'internal', label: 'Internal', icon: UserCog },
    { id: 'all', label: 'All', icon: Users },
];

const VIEW_COPY: Record<RevenueView, {
    helper: string;
    clientTitle: string;
    roomTitle: string;
    nameHeader: string;
    emptyTitle: (month: string) => string;
    emptySub: string;
}> = {
    clients: {
        helper: 'Companies and tenants. Only these count as revenue.',
        clientTitle: 'Revenue by client',
        roomTitle: 'Revenue by meeting room',
        nameHeader: 'Client',
        emptyTitle: m => `No client bookings in ${m}.`,
        emptySub: 'Confirmed bookings by companies and tenants will show up here.',
    },
    internal: {
        helper: 'Staff, admins and internal teams. Hours only, never charged.',
        clientTitle: 'Usage by internal users',
        roomTitle: 'Usage by meeting room',
        nameHeader: 'Person',
        emptyTitle: m => `No internal bookings in ${m}.`,
        emptySub: 'Bookings by staff, admins and internal teams will show up here.',
    },
    all: {
        helper: 'Everyone. Revenue still comes from clients only.',
        clientTitle: 'Revenue and usage by person',
        roomTitle: 'Revenue and usage by meeting room',
        nameHeader: 'Client or person',
        emptyTitle: m => `No bookings in ${m}.`,
        emptySub: 'Confirmed bookings for this month will show up here.',
    },
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** Micro label, same recipe as the sibling panels' field labels. */
const MicroLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <span className={`text-[9px] font-black uppercase tracking-widest text-slate-400 ${className}`}>{children}</span>
);

/** Number cell: right aligned, tabular, zeros dimmed so the eye lands on real values. */
const NumCell: React.FC<{ value: number; money?: boolean; strong?: boolean; accent?: boolean }> = ({ value, money, strong, accent }) => {
    const zero = !value;
    const tone = zero ? 'text-slate-300' : accent ? 'text-primary-dark' : strong ? 'text-slate-900' : 'text-slate-600';
    return (
        <td className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${strong || accent ? 'font-black' : 'font-bold'} ${tone}`}>
            {money ? inr(value) : hrs(value)}
        </td>
    );
};

const Th: React.FC<{ children: React.ReactNode; align?: 'left' | 'right'; sticky?: boolean }> = ({ children, align = 'right', sticky }) => (
    <th
        scope="col"
        className={`px-3 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap bg-slate-50 ${align === 'left' ? 'text-left' : 'text-right'} ${sticky ? 'sticky left-0 z-10' : ''}`}
    >
        {children}
    </th>
);

const TAG_TONES = {
    slate: 'bg-slate-50 border-slate-100 text-slate-500',
    amber: 'bg-amber-50 border-amber-100 text-amber-600',
    // Revenue rows (Company, Tenant) carry the brand tint so they stand apart from Internal in the All view.
    primary: 'bg-primary/5 border-primary/15 text-primary-dark',
} as const;

const Tag: React.FC<{ children: React.ReactNode; tone?: keyof typeof TAG_TONES }> = ({ children, tone = 'slate' }) => (
    <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider border whitespace-nowrap ${TAG_TONES[tone]}`}
    >
        {children}
    </span>
);

const Warning: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs font-bold text-amber-700 leading-relaxed">{children}</p>
    </div>
);

const StatTile: React.FC<{
    label: string;
    value: React.ReactNode;
    sub: React.ReactNode;
    icon: React.ElementType;
    hero?: boolean;
    className?: string;
}> = ({ label, value, sub, icon: Icon, hero, className = '' }) => (
    <div
        className={`bg-white border rounded-2xl p-4 shadow-sm flex flex-col gap-2 min-w-0 ${
            hero ? 'border-primary/20 ring-1 ring-primary/10' : 'border-slate-100'
        } ${className}`}
    >
        <div className="flex items-center justify-between gap-2">
            <MicroLabel className={hero ? 'text-primary' : ''}>{label}</MicroLabel>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${hero ? 'bg-primary/10' : 'bg-slate-50'}`}>
                <Icon className={`w-3.5 h-3.5 ${hero ? 'text-primary' : 'text-slate-400'}`} />
            </div>
        </div>
        <p
            className={`font-black tracking-tight tabular-nums truncate ${
                hero ? 'text-2xl md:text-3xl text-primary' : 'text-lg md:text-xl text-slate-900'
            }`}
        >
            {value}
        </p>
        <p className="text-[10px] font-bold text-slate-400 leading-snug">{sub}</p>
    </div>
);

const SectionCard: React.FC<{ title: string; count: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, count, icon: Icon, children }) => (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                {/* p, not h3: globals.css forces h3 to 1.5rem / 500 !important; sibling panels title cards with p. */}
                <p className="text-sm font-black text-slate-900 truncate">{title}</p>
            </div>
            <MicroLabel className="flex-shrink-0">{count}</MicroLabel>
        </div>
        {/* Tables scroll inside the card, never the page. */}
        <div className="overflow-x-auto">{children}</div>
    </div>
);

/** Segmented toggle. Same pill recipe as the tab bar in AdminRoomManager. */
const ViewToggle: React.FC<{ value: RevenueView; onChange: (v: RevenueView) => void }> = ({ value, onChange }) => (
    <div role="group" aria-label="Whose bookings to show" className="grid grid-cols-3 bg-slate-50 p-1 rounded-xl w-full sm:w-auto">
        {VIEWS.map(({ id, label, icon: Icon }) => {
            const active = value === id;
            return (
                <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(id)}
                    className={`flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
                        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                    }`}
                >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {label}
                </button>
            );
        })}
    </div>
);

// ---------------------------------------------------------------------------
// Client table
// ---------------------------------------------------------------------------

const ClientBookings: React.FC<{ bookings: RevenueBookingLine[]; internal?: boolean }> = ({ bookings, internal }) => (
    <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
            <thead>
                <tr className="border-b border-slate-100">
                    <Th align="left">Date</Th>
                    <Th align="left">Time</Th>
                    <Th align="left">Room</Th>
                    <Th align="left">Booked by</Th>
                    <Th align="left">Notes / Client</Th>
                    <Th>Hours</Th>
                    <Th>Credit hrs</Th>
                    <Th>Exceeded hrs</Th>
                    <Th>Amount</Th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
                {bookings.map(b => (
                    <tr key={b.bookingId}>
                        <td className="px-3 py-2.5 font-bold text-slate-700 whitespace-nowrap">{dayLabel(b.date)}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-500 tabular-nums whitespace-nowrap">{b.startTime}-{b.endTime}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-700 whitespace-nowrap">{b.roomName}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-500 whitespace-nowrap">{b.bookedBy}</td>
                        <td className="px-3 py-2.5 text-slate-600">
                            {b.comment ? (
                                <div className="flex flex-col gap-0.5">
                                    <span className="italic text-slate-700 font-medium break-words max-w-[240px]">"{b.comment}"</span>
                                    {b.clientMatchedFromNote && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded w-fit">
                                            ✓ Matched from note
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span className="text-slate-300">—</span>
                            )}
                        </td>
                        <NumCell value={b.hours} strong />
                        <NumCell value={b.creditHours} />
                        <NumCell value={b.exceededHours} />
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {/* Internal bookings are never charged: always a muted zero, never a billable line. */}
                            <span className={`block font-black tabular-nums ${!internal && b.totalValue ? 'text-slate-900' : 'text-slate-300'}`}>
                                {inr(internal ? 0 : b.totalValue)}
                            </span>
                            {!internal && b.exceededRevenue > 0 && (
                                <span className="block text-[9px] font-black uppercase tracking-wider text-primary-dark tabular-nums">
                                    {inr(b.exceededRevenue)} billable
                                </span>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const ClientTable: React.FC<{ clients: RevenueClient[]; data: RevenueResponse; nameHeader: string }> = ({ clients, data, nameHeader }) => {
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const toggle = (key: string) => setOpen(prev => ({ ...prev, [key]: !prev[key] }));
    const totalCredits = clients.reduce((s, c) => s + (c.category === 'client' && c.hasCreditPlan ? c.monthlyCreditHours : 0), 0);
    const COLS = 9;

    return (
        <table className="w-full min-w-[980px] text-xs">
            <thead>
                <tr className="border-b border-slate-100">
                    <Th align="left" sticky>{nameHeader}</Th>
                    <Th>Monthly credits</Th>
                    <Th>Hours booked</Th>
                    <Th>Credit hrs</Th>
                    <Th>Exceeded hrs</Th>
                    <Th>Internal hrs</Th>
                    <Th>Credit value</Th>
                    <Th>Exceeded revenue</Th>
                    <Th>Total</Th>
                </tr>
            </thead>
            <tbody>
                {clients.map(c => {
                    const isOpen = !!open[c.key];
                    const isInternal = c.category === 'internal';
                    return (
                        <React.Fragment key={c.key}>
                            <tr
                                onClick={() => toggle(c.key)}
                                className={`group cursor-pointer border-b border-slate-50 transition-colors ${isOpen ? 'bg-slate-50/70' : 'hover:bg-slate-50/70'}`}
                            >
                                <td className={`sticky left-0 z-10 px-3 py-3 transition-colors ${isOpen ? 'bg-slate-50' : 'bg-white group-hover:bg-slate-50'}`}>
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        aria-label={`${isOpen ? 'Hide' : 'Show'} bookings for ${c.name}`}
                                        title={c.name}
                                        className="flex items-center gap-2 text-left min-w-0 max-w-[170px] md:max-w-[320px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-lg"
                                    >
                                        <ChevronRight className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90 text-primary' : ''}`} />
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isInternal ? 'bg-slate-100' : 'bg-primary/10'}`}>
                                            {isInternal
                                                ? <UserCog className="w-3.5 h-3.5 text-slate-400" />
                                                : c.type === 'company'
                                                    ? <Building2 className="w-3.5 h-3.5 text-primary" />
                                                    : <User className="w-3.5 h-3.5 text-primary" />}
                                        </div>
                                        <span className="min-w-0">
                                            <span className="block font-bold text-slate-900 text-sm truncate">{c.name}</span>
                                            <span className="flex flex-wrap items-center gap-1 mt-0.5">
                                                {isInternal
                                                    ? <Tag>Internal</Tag>
                                                    : <Tag tone="primary">{c.type === 'company' ? 'Company' : 'Tenant'}</Tag>}
                                                {!isInternal && !c.hasCreditPlan && <Tag tone="amber">No credit plan</Tag>}
                                            </span>
                                        </span>
                                    </button>
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap font-bold">
                                    {isInternal
                                        ? <span className="text-slate-300">n/a</span>
                                        : c.hasCreditPlan
                                            ? <span className={c.monthlyCreditHours ? 'text-slate-600' : 'text-slate-300'}>{hrs(c.monthlyCreditHours)}</span>
                                            : <span className="text-slate-300">None</span>}
                                </td>
                                <NumCell value={c.bookedHours} strong />
                                <NumCell value={c.creditHours} />
                                <NumCell value={c.exceededHours} />
                                <NumCell value={c.internalHours} />
                                <NumCell value={c.creditValue} money />
                                <NumCell value={c.exceededRevenue} money accent />
                                <NumCell value={c.totalValue} money strong />
                            </tr>
                            {isOpen && (
                                <tr className="border-b border-slate-100">
                                    <td colSpan={COLS} className="bg-slate-50/70 px-3 pb-3 pt-1">
                                        <div className="flex items-center justify-between gap-3 px-1 py-2">
                                            <MicroLabel>
                                                {c.bookingCount} booking{c.bookingCount === 1 ? '' : 's'}
                                            </MicroLabel>
                                            {isInternal
                                                ? <MicroLabel>No charge</MicroLabel>
                                                : c.hasCreditPlan && (
                                                    <MicroLabel>{hrs(c.unusedCreditHours)} credit hrs unused</MicroLabel>
                                                )}
                                        </div>
                                        <ClientBookings bookings={c.bookings} internal={isInternal} />
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </tbody>
            <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="sticky left-0 z-10 bg-slate-50 px-3 py-3">
                        <MicroLabel className="text-slate-500">Total</MicroLabel>
                    </td>
                    <NumCell value={totalCredits} />
                    <NumCell value={data.totals.bookedHours} strong />
                    <NumCell value={data.totals.creditHours} strong />
                    <NumCell value={data.totals.exceededHours} strong />
                    <NumCell value={data.totals.internalHours} strong />
                    <NumCell value={data.totals.creditValue} money strong />
                    <NumCell value={data.totals.exceededRevenue} money accent />
                    <NumCell value={data.totals.totalValue} money strong />
                </tr>
            </tfoot>
        </table>
    );
};

// ---------------------------------------------------------------------------
// Room table
// ---------------------------------------------------------------------------

const RoomTable: React.FC<{ rooms: RevenueRoomTotals[] }> = ({ rooms }) => {
    const sum = (k: keyof Pick<RevenueRoomTotals, 'bookingCount' | 'bookedHours' | 'creditHours' | 'exceededHours' | 'internalHours' | 'creditValue' | 'exceededRevenue' | 'totalValue'>) =>
        rooms.reduce((s, r) => s + (r[k] || 0), 0);

    return (
        <table className="w-full min-w-[900px] text-xs">
            <thead>
                <tr className="border-b border-slate-100">
                    <Th align="left" sticky>Room</Th>
                    <Th>Rate / hr</Th>
                    <Th>Bookings</Th>
                    <Th>Hours</Th>
                    <Th>Credit hrs</Th>
                    <Th>Exceeded hrs</Th>
                    <Th>Internal hrs</Th>
                    <Th>Credit value</Th>
                    <Th>Exceeded revenue</Th>
                    <Th>Total</Th>
                </tr>
            </thead>
            <tbody>
                {rooms.map(r => (
                    <tr key={r.roomId} className="group border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 transition-colors px-3 py-3">
                            <span title={r.roomName} className="block font-bold text-slate-900 text-sm truncate max-w-[150px] md:max-w-[260px]">{r.roomName}</span>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                            {r.rateSet
                                ? <span className="font-bold text-slate-600 tabular-nums">{inr(r.hourlyRate)}</span>
                                : <Tag tone="amber">Not set</Tag>}
                        </td>
                        <td className={`px-3 py-3 text-right tabular-nums whitespace-nowrap font-bold ${r.bookingCount ? 'text-slate-600' : 'text-slate-300'}`}>
                            {r.bookingCount.toLocaleString('en-IN')}
                        </td>
                        <NumCell value={r.bookedHours} strong />
                        <NumCell value={r.creditHours} />
                        <NumCell value={r.exceededHours} />
                        <NumCell value={r.internalHours} />
                        <NumCell value={r.creditValue} money />
                        <NumCell value={r.exceededRevenue} money accent />
                        <NumCell value={r.totalValue} money strong />
                    </tr>
                ))}
            </tbody>
            <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="sticky left-0 z-10 bg-slate-50 px-3 py-3">
                        <MicroLabel className="text-slate-500">Total</MicroLabel>
                    </td>
                    <td className="px-3 py-3" />
                    <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap font-black text-slate-900">
                        {sum('bookingCount').toLocaleString('en-IN')}
                    </td>
                    <NumCell value={sum('bookedHours')} strong />
                    <NumCell value={sum('creditHours')} strong />
                    <NumCell value={sum('exceededHours')} strong />
                    <NumCell value={sum('internalHours')} strong />
                    <NumCell value={sum('creditValue')} money strong />
                    <NumCell value={sum('exceededRevenue')} money accent />
                    <NumCell value={sum('totalValue')} money strong />
                </tr>
            </tfoot>
        </table>
    );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const AdminRevenuePanel: React.FC<AdminRevenuePanelProps> = ({ propertyId }) => {
    const [month, setMonth] = useState<string>(currentMonth);
    const [view, setView] = useState<RevenueView>('clients');
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const [reloading, setReloading] = useState(false);

    const query = useMemo(
        () => `/api/meeting-rooms/revenue?propertyId=${encodeURIComponent(propertyId)}&month=${encodeURIComponent(month)}&view=${view}`,
        [propertyId, month, view],
    );

    useEffect(() => {
        if (!propertyId || !isValidMonth(month)) return;
        const controller = new AbortController();
        setReloading(true);

        (async () => {
            try {
                const res = await fetch(query, { signal: controller.signal, cache: 'no-store' });
                const body = await res.json().catch(() => ({}));
                if (controller.signal.aborted) return;
                if (res.status === 403) {
                    setState({ kind: 'forbidden' });
                } else if (res.status === 401) {
                    setState({ kind: 'error', message: 'Your session has expired. Please sign in again.' });
                } else if (!res.ok) {
                    setState({ kind: 'error', message: body?.error || 'Could not load revenue. Please try again.' });
                } else {
                    setState({ kind: 'ready', data: body as RevenueResponse });
                }
            } catch (err) {
                if (controller.signal.aborted) return;
                console.error('[AdminRevenuePanel] fetch error:', err);
                setState({ kind: 'error', message: 'Could not load revenue. Check your connection and try again.' });
            } finally {
                if (!controller.signal.aborted) setReloading(false);
            }
        })();

        return () => controller.abort();
    }, [query, propertyId, month]);

    const canDownload = isValidMonth(month) && state.kind !== 'forbidden' && !!propertyId;
    const data = state.kind === 'ready' ? state.data : null;
    const hasBookings = !!data && data.totals.bookingCount > 0;
    // Labels follow the view the shown data was built for, so titles never disagree with the
    // rows still on screen while a newer view is loading. The helper line follows the toggle.
    const shownView: RevenueView = data?.view || view;
    const copy = VIEW_COPY[shownView];
    const clientRows = data ? data.clients.filter(c => c.category === 'client').length : 0;
    const internalRows = data ? data.clients.length - clientRows : 0;
    const clientCount =
        shownView === 'internal' ? plural(internalRows, 'person', 'people')
            : shownView === 'clients' ? plural(clientRows, 'client', 'clients')
                : `${plural(clientRows, 'client', 'clients')}, ${internalRows.toLocaleString('en-IN')} internal`;

    if (state.kind === 'forbidden') {
        return (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                <Lock className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="font-bold text-slate-700 text-sm">Only property admins can view revenue.</p>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* Header: title, view toggle, month picker, download. Wraps instead of scrolling. */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <IndianRupee className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                            <p className="font-black text-slate-900 text-sm truncate">
                                Meeting room revenue{data?.property?.name ? `, ${data.property.name}` : ''}
                            </p>
                            <MicroLabel>{monthLabel(month) || 'Pick a month'}</MicroLabel>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <ViewToggle value={view} onChange={setView} />
                        <label className="sr-only" htmlFor="revenue-month">Month</label>
                        <input
                            id="revenue-month"
                            type="month"
                            value={month}
                            onChange={e => setMonth(e.target.value)}
                            className="flex-1 sm:flex-none min-w-0 px-3 py-2 text-sm font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                        {canDownload ? (
                            <a
                                href={`${query}&format=xlsx`}
                                download
                                aria-label="Download Excel"
                                className="flex-shrink-0 px-4 py-2.5 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:opacity-95 transition-all flex items-center justify-center gap-2 shadow-sm"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span className="sm:hidden">Excel</span>
                                <span className="hidden sm:inline">Download Excel</span>
                            </a>
                        ) : (
                            <button
                                type="button"
                                disabled
                                className="flex-shrink-0 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-400 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 cursor-not-allowed"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span className="sm:hidden">Excel</span>
                                <span className="hidden sm:inline">Download Excel</span>
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-[11px] font-bold text-slate-500 leading-snug border-t border-slate-50 pt-3">{VIEW_COPY[view].helper}</p>
            </div>

            {!isValidMonth(month) ? (
                <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                    <CalendarX className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="font-bold text-slate-700 text-sm">Pick a month to see revenue</p>
                </div>
            ) : state.kind === 'loading' ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
            ) : state.kind === 'error' ? (
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 text-center">
                    <AlertTriangle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
                    <p className="font-bold text-rose-700 text-sm">{state.message}</p>
                </div>
            ) : data ? (
                <div className={`space-y-5 transition-opacity ${reloading ? 'opacity-60 pointer-events-none' : ''}`}>
                    {reloading && (
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            Updating
                        </div>
                    )}

                    {/* Warnings */}
                    {(data.rateColumnMissing || (shownView !== 'internal' && data.roomsWithoutRate.length > 0)) && (
                        <div className="space-y-2">
                            {data.rateColumnMissing && (
                                <Warning>Prices are not set up yet. The database update for room prices has not been applied.</Warning>
                            )}
                            {!data.rateColumnMissing && shownView !== 'internal' && data.roomsWithoutRate.length > 0 && (
                                <Warning>
                                    Price not set for: {data.roomsWithoutRate.join(', ')}. Their hours count as ₹0. Set it in Assets &gt; Edit room.
                                </Warning>
                            )}
                        </div>
                    )}

                    {/* Stat tiles. Internal view has no money, so it leads with hours and shows no ₹0 tiles. */}
                    {shownView === 'internal' ? (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <StatTile
                                hero
                                className="col-span-2"
                                label="Internal hours"
                                icon={Clock}
                                value={`${hrs(data.totals.internalHours)}h`}
                                sub={`No charge. ${plural(data.totals.bookingCount, 'booking', 'bookings')} by ${plural(internalRows, 'person', 'people')}`}
                            />
                            <StatTile
                                label="Bookings"
                                icon={CalendarDays}
                                value={data.totals.bookingCount.toLocaleString('en-IN')}
                                sub="Confirmed this month"
                            />
                            <StatTile
                                label="People"
                                icon={UserCog}
                                value={internalRows.toLocaleString('en-IN')}
                                sub="Staff, admins and teams"
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                            <StatTile
                                hero
                                className="col-span-2"
                                label="Exceeded revenue"
                                icon={IndianRupee}
                                value={inr(data.totals.exceededRevenue)}
                                sub={`Billable. ${hrs(data.totals.exceededHours)} hrs beyond credit plans`}
                            />
                            <StatTile
                                label="Credit value"
                                icon={Wallet}
                                value={inr(data.totals.creditValue)}
                                sub="Covered by credit plans"
                            />
                            <StatTile
                                label="Total value"
                                icon={Coins}
                                value={inr(data.totals.totalValue)}
                                sub="Credit + exceeded"
                            />
                            <StatTile
                                label="Hours"
                                icon={Clock}
                                value={
                                    <>
                                        {hrs(data.totals.creditHours)}
                                        <span className="text-slate-300 font-bold"> / </span>
                                        {hrs(data.totals.exceededHours)}
                                    </>
                                }
                                sub="Credit hrs / exceeded hrs"
                            />
                            <StatTile
                                label="Internal hours"
                                icon={Users}
                                value={shownView === 'clients'
                                    ? <span className="text-slate-300">n/a</span>
                                    : `${hrs(data.internal.hours)}h`}
                                sub={shownView === 'clients'
                                    ? 'Not in this view. Switch to Internal or All.'
                                    : `No charge. ${plural(data.internal.bookingCount, 'booking', 'bookings')}`}
                            />
                        </div>
                    )}

                    {!hasBookings ? (
                        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                            <CalendarX className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                            <p className="font-bold text-slate-700 text-sm">{copy.emptyTitle(monthLabel(data.month) || monthLabel(month))}</p>
                            <p className="text-slate-400 text-xs mt-1">{copy.emptySub}</p>
                        </div>
                    ) : (
                        <>
                            {data.clients.length > 0 && (
                                <SectionCard
                                    title={copy.clientTitle}
                                    icon={VIEWS.find(v => v.id === shownView)?.icon || Building2}
                                    count={clientCount}
                                >
                                    <ClientTable clients={data.clients} data={data} nameHeader={copy.nameHeader} />
                                </SectionCard>
                            )}

                            <SectionCard
                                title={copy.roomTitle}
                                icon={Layers}
                                count={`${data.rooms.length} room${data.rooms.length === 1 ? '' : 's'}`}
                            >
                                <RoomTable rooms={data.rooms} />
                            </SectionCard>
                        </>
                    )}
                </div>
            ) : null}
        </div>
    );
};

export default AdminRevenuePanel;
