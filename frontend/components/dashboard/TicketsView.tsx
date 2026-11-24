'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CheckCircle2, Plus, X, Loader2, Activity, Search, Calendar, User, ChevronDown, ChevronRight, Check, Building2, SlidersHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Custom styled dropdown to replace native <select>
function FilterDropdown({
    value, onChange, options, icon, placeholder
}: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    icon?: React.ReactNode;
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find(o => o.value === value);
    const isActive = value !== options[0]?.value;

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(p => !p)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`flex items-center gap-[8px] h-10 px-3 bg-white border rounded-full hover:border-slate-400 transition-colors text-sm font-semibold whitespace-nowrap ${isActive ? 'border-primary/50 text-primary' : 'border-slate-300 text-slate-700'}`}
            >
                {icon && <span className={isActive ? 'text-primary' : 'text-slate-400'}>{icon}</span>}
                <span>{selected?.label ?? placeholder}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''} ${isActive ? 'text-primary' : 'text-slate-400'}`} />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[180px] max-w-[240px] bg-white border border-slate-200 rounded-[20px] shadow-xl overflow-hidden"
                    >
                        <div className="max-h-60 overflow-y-auto py-1.5">
                            {options.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => { onChange(opt.value); setOpen(false); }}
                                    className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-left transition-colors hover:bg-slate-50 ${value === opt.value ? 'text-primary bg-primary/5' : 'text-slate-700'}`}
                                >
                                    <span className="truncate">{opt.label}</span>
                                    {value === opt.value && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

interface StatusOption {
    value: string;
    label: string;
    group?: 'status' | 'flag';
}

function parseInitialStatuses(searchParams: { get: (k: string) => string | null }, initialProp?: string): string[] {
    const selected: string[] = [];
    const sla = searchParams.get('slaBreached');
    const internal = searchParams.get('isInternal');
    const raisedByRole = searchParams.get('raisedByRole');
    const materials = searchParams.get('materialsRequired');
    const vendor = searchParams.get('vendorTagged');
    const statusParam = searchParams.get('status');

    if (sla === 'true') selected.push('sla_breached');
    if (vendor === 'true') selected.push('vendor_tagged');
    if (internal === 'true') selected.push('internal');
    if (raisedByRole === 'tenant') selected.push('tenant_raised');
    if (materials === 'true') selected.push('materials_required');

    const handleStatusStr = (str: string) => {
        if (!str || str === 'all') return;
        const tokens = str.split(',').map(s => s.trim());
        for (const token of tokens) {
            if (token === 'sla_breached') {
                if (!selected.includes('sla_breached')) selected.push('sla_breached');
            } else if (token === 'vendor_tagged') {
                if (!selected.includes('vendor_tagged')) selected.push('vendor_tagged');
            } else if (token === 'internal') {
                if (!selected.includes('internal')) selected.push('internal');
            } else if (token === 'tenant_raised') {
                if (!selected.includes('tenant_raised')) selected.push('tenant_raised');
            } else if (token === 'materials_required') {
                if (!selected.includes('materials_required')) selected.push('materials_required');
            } else if (token === 'waitlist') {
                if (!selected.includes('waitlist')) selected.push('waitlist');
            } else if (token === 'pending_validation') {
                if (!selected.includes('pending_validation')) selected.push('pending_validation');
            } else if (['open', 'assigned', 'in_progress', 'blocked'].includes(token)) {
                if (!selected.includes('open,assigned,in_progress,blocked,waitlist')) {
                    selected.push('open,assigned,in_progress,blocked,waitlist');
                }
            } else if (['resolved', 'closed'].includes(token)) {
                if (!selected.includes('resolved,closed,pending_validation')) {
                    selected.push('resolved,closed,pending_validation');
                }
            } else {
                if (!selected.includes(token)) selected.push(token);
            }
        }
    };

    if (statusParam) {
        handleStatusStr(statusParam);
    } else if (selected.length === 0 && initialProp && initialProp !== 'all') {
        handleStatusStr(initialProp);
    }

    return Array.from(new Set(selected));
}

function MultiSelectStatusDropdown({
    selectedValues,
    onChange,
    options,
    placeholder = 'Status',
}: {
    selectedValues: string[];
    onChange: (values: string[]) => void;
    options: StatusOption[];
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const isActive = selectedValues.length > 0;

    const toggleValue = (val: string) => {
        if (selectedValues.includes(val)) {
            onChange(selectedValues.filter(v => v !== val));
        } else {
            onChange([...selectedValues, val]);
        }
    };

    const buttonLabel = useMemo(() => {
        if (!isActive) return `${placeholder}: All`;
        if (selectedValues.length === 1) {
            const opt = options.find(o => o.value === selectedValues[0]);
            return `${placeholder}: ${opt?.label ?? selectedValues[0]}`;
        }
        if (selectedValues.length === 2) {
            const l1 = options.find(o => o.value === selectedValues[0])?.label ?? selectedValues[0];
            const l2 = options.find(o => o.value === selectedValues[1])?.label ?? selectedValues[1];
            if (l1.length + l2.length <= 18) {
                return `${placeholder}: ${l1}, ${l2}`;
            }
            return `${placeholder}: ${l1} (+1)`;
        }
        const first = options.find(o => o.value === selectedValues[0])?.label ?? selectedValues[0];
        return `${placeholder}: ${first} (+${selectedValues.length - 1})`;
    }, [isActive, selectedValues, options, placeholder]);

    const statusItems = options.filter(o => o.group === 'status');
    const flagItems = options.filter(o => o.group === 'flag');

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(p => !p)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`flex items-center gap-[8px] h-10 px-3 bg-white border rounded-full hover:border-slate-400 transition-colors text-sm font-semibold whitespace-nowrap ${isActive ? 'border-primary/50 text-primary bg-primary/5' : 'border-slate-300 text-slate-700'}`}
            >
                <span>{buttonLabel}</span>
                {isActive && (
                    <span className="flex items-center justify-center h-4 min-w-[16px] px-1 text-[10px] font-bold bg-primary text-white rounded-full">
                        {selectedValues.length}
                    </span>
                )}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''} ${isActive ? 'text-primary' : 'text-slate-400'}`} />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[220px] max-w-[280px] bg-white border border-slate-200 rounded-[20px] shadow-xl overflow-hidden p-2"
                    >
                        <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-100 text-xs font-semibold text-slate-500">
                            <span>Filter Status</span>
                            {isActive && (
                                <button
                                    type="button"
                                    onClick={() => onChange([])}
                                    className="text-primary hover:underline hover:text-primary-dark"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>

                        <div className="max-h-72 overflow-y-auto py-1 space-y-0.5">
                            {/* "All" Option */}
                            <button
                                type="button"
                                onClick={() => onChange([])}
                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors hover:bg-slate-50 ${!isActive ? 'text-primary font-bold' : 'text-slate-700'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${!isActive ? 'bg-primary border-primary text-white' : 'border-slate-300 bg-white'}`}>
                                        {!isActive && <Check className="w-3 h-3 stroke-[3]" />}
                                    </div>
                                    <span>All</span>
                                </div>
                            </button>

                            {statusItems.length > 0 && (
                                <>
                                    <div className="my-1 border-t border-slate-100" />
                                    <div className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</div>
                                    {statusItems.map(opt => {
                                        const isChecked = selectedValues.includes(opt.value);
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => toggleValue(opt.value)}
                                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors hover:bg-slate-50 ${isChecked ? 'text-primary font-bold' : 'text-slate-700'}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${isChecked ? 'bg-primary border-primary text-white' : 'border-slate-300 bg-white'}`}>
                                                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                                                    </div>
                                                    <span>{opt.label}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </>
                            )}

                            {flagItems.length > 0 && (
                                <>
                                    <div className="my-1 border-t border-slate-100" />
                                    <div className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Conditions & Flags</div>
                                    {flagItems.map(opt => {
                                        const isChecked = selectedValues.includes(opt.value);
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => toggleValue(opt.value)}
                                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors hover:bg-slate-50 ${isChecked ? 'text-primary font-bold' : 'text-slate-700'}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${isChecked ? 'bg-primary border-primary text-white' : 'border-slate-300 bg-white'}`}>
                                                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                                                    </div>
                                                    <span>{opt.label}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </>
                            )}
                        </div>

                        <div className="pt-1.5 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="w-full py-1.5 text-center text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
// Owner 2026-11-15: rows and pills for the phone Filters sheet. Each row is a real <select> laid over the row, so the
// phone's own picker opens; the row shows the chosen value.
function SheetSelectRow({ label, value, onChange, options, disabledText, last }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    /** When set, the row is shown greyed out with this text and cannot be changed. */
    disabledText?: string;
    last?: boolean;
}) {
    const selected = options.find(o => o.value === value)?.label ?? options[0]?.label;
    return (
        <div className={`relative flex h-[52px] items-center gap-[8px] pl-4 pr-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-600 ${last ? '' : 'border-b border-slate-100'} ${disabledText ? 'opacity-60' : ''}`}>
            <span className="flex-1 text-[15px] font-semibold text-gray-900">{label}</span>
            <span className="max-w-[55%] truncate text-[15px] text-gray-600">{disabledText ?? selected}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-gray-500" aria-hidden="true" />
            <select
                aria-label={label}
                value={value}
                disabled={Boolean(disabledText)}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            >
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        </div>
    );
}

function SheetPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={`h-10 rounded-full border px-3.5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ${active ? 'border-blue-700 bg-blue-700 text-white' : 'border-gray-300 bg-white text-gray-900'}`}
        >
            {children}
        </button>
    );
}

const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'priority_high', label: 'Priority: high to low' },
    { value: 'priority_low', label: 'Priority: low to high' },
];

const TEAM_OPTIONS = [
    { value: 'all', label: 'All teams' },
    { value: 'technical', label: 'Technical' },
    { value: 'soft_services', label: 'Soft services' },
    { value: 'plumbing', label: 'Plumbing' },
];

const floorLabel = (f: string | number) => f === 0 ? 'Ground floor' : f === -1 ? 'Basement 1' : f === -2 ? 'Basement 2' : `Floor ${f}`;

import { createClient } from '@/frontend/utils/supabase/client';
import TicketCard, { TICKET_GRID_CLASS } from '@/frontend/components/shared/TicketCard';
import { BottomSheet } from '@/frontend/components/task-manager/assign/Sheet';
import { useDataCache } from '@/frontend/context/DataCacheContext';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { useAuth } from '@/frontend/context/AuthContext';

interface Ticket {
    id: string;
    title: string;
    description: string;
    category: string;
    status: string;
    priority: string;
    ticket_number: string;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    raised_by?: string;
    assigned_to?: string;
    organization: { id: string; name: string; code: string };
    property: { id: string; name: string; code: string } | null;
    floor_number?: number | string | null;
    property_id?: string;
    creator: { id: string; full_name: string; email: string; property_memberships?: { role: string; property_id: string }[] };
    assignee: { id: string; full_name: string; email: string; user_photo_url?: string | null } | null;
    ticket_comments: { count: number }[];
    photo_before_url?: string;
    photo_after_url?: string;
    sla_deadline?: string | null;
    sla_paused?: boolean;
    sla_pause_reason?: string | null;
    internal?: boolean;
    ticket_escalation_logs?: { from_level: number; to_level: number | null; escalated_at: string; from_employee?: { full_name: string; user_photo_url?: string | null } | null; to_employee?: { full_name: string; user_photo_url?: string | null } | null }[];
}

interface Comment {
    id: string;
    comment: string;
    is_internal: boolean;
    created_at: string;
    user: { id: string; full_name: string; email: string };
}

interface TicketsViewProps {
    propertyId?: string;
    organizationId?: string;
    canDelete?: boolean;
    onNewRequest?: () => void;
    initialStatusFilter?: string;
    /**
     * Owner 2026-11-02, IT console ONLY: show only the tickets assigned to this user. The "Assigned To" filter and the
     * Flow Map button are hidden, and Edit shows only on tickets this user raised. Every other console omits it, so
     * their behaviour is unchanged.
     */
    lockedAssigneeId?: string;
    /**
     * Owner 2026-11-15: false on the Requests tab (RequestsWorkspace), whose page header already shows "Requests" and,
     * on phones, the New button. Every other screen keeps the "Support Tickets" heading.
     */
    showHeading?: boolean;
    /** The List / Board switch the Requests tab shows next to the ticket count below `lg`. */
    viewSwitcher?: React.ReactNode;
}

const TicketsView: React.FC<TicketsViewProps> = ({ propertyId, organizationId, canDelete, onNewRequest, initialStatusFilter = 'all', lockedAssigneeId, showHeading = true, viewSwitcher }) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    
    const { getCachedData, setCachedData, invalidateCache } = useDataCache();
    const { membership } = useAuth();

    const [selectedStatuses, setSelectedStatuses] = useState<string[]>(() => parseInitialStatuses(searchParams, initialStatusFilter));
    const statusKey = useMemo(() => selectedStatuses.length > 0 ? selectedStatuses.slice().sort().join('+') : 'all', [selectedStatuses]);
    const [categoryFilter, setCategoryFilter] = useState<string>(searchParams.get('category') || 'all');
    const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
    const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'priority_high' | 'priority_low'>((searchParams.get('sortBy') as any) || 'newest');
    const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') || '');
    const [dateTo, setDateTo] = useState(searchParams.get('dateTo') || '');
    const [raisedByFilter, setRaisedByFilter] = useState(searchParams.get('raisedBy') || 'all');
    const [resolvedByFilter, setResolvedByFilter] = useState(searchParams.get('resolvedBy') || 'all');
    const [assignedToFilter, setAssignedToFilter] = useState(searchParams.get('assignedTo') || 'all');
    const [floorFilter, setFloorFilter] = useState(searchParams.get('floor') || 'all');
    const [allAssignees, setAllAssignees] = useState<{ id: string; name: string }[]>([]);
    const [allFloors, setAllFloors] = useState<(string | number)[]>([]);
    const [hasUnspecified, setHasUnspecified] = useState(false);

    // Owner 2026-11-03: + 'tech' (the Tech console shows this list exactly as the Super Admin console does)
    const isHighAdmin = membership?.org_role === 'org_super_admin' || 
                        membership?.org_role === 'owner' ||
                        membership?.org_role === 'tech' ||
                        membership?.properties.some(p => p.role === 'property_admin');
    
    // Note: The cacheKey logic heavily depends on the filter values so changes will cleanly bypass legacy state cache instances
    const cacheKey = `tickets-${lockedAssigneeId ? `mine-${lockedAssigneeId}-` : ''}${propertyId ?? organizationId ?? 'all'}-${statusKey}-${categoryFilter}-${raisedByFilter}-${resolvedByFilter}-${assignedToFilter}-${floorFilter}-${sortBy}-${searchQuery}-${dateFrom}-${dateTo}`;

    // SWR (Stale-While-Revalidate): Show cached data INSTANTLY, revalidate silently in background
    const cachedTickets = getCachedData(cacheKey);
    const isReturningFromDetail = typeof window !== 'undefined' && !!sessionStorage.getItem('lastTicketId');
    const hasCacheHit = !!cachedTickets && cachedTickets.length > 0;

    const [tickets, setTickets] = useState<Ticket[]>(() => cachedTickets || []);
    const [isLoading, setIsLoading] = useState(!hasCacheHit);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [allCreators, setAllCreators] = useState<{ id: string; name: string }[]>([]);

    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    // Edit Modal State
    const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    const supabase = createClient();

    // Instant Scroll Restoration — runs once on mount when cache data is available
    const scrollRestoredRef = useRef(false);
    useEffect(() => {
        if (scrollRestoredRef.current) return;
        if (tickets.length === 0) return;

        const ticketId = sessionStorage.getItem('lastTicketId');
        const savedScrollY = sessionStorage.getItem('scrollY');
        if (!ticketId && !savedScrollY) return;

        // Data is already rendered from cache — restore immediately
        scrollRestoredRef.current = true;
        const scrollContainer = document.getElementById('main-scroll-container');
        const container = scrollContainer || window;

        // Disable smooth scrolling temporarily
        if (container instanceof HTMLElement) {
            container.style.setProperty('scroll-behavior', 'auto', 'important');
        }

        let retryCount = 0;
        const maxRetries = 8;

        const attemptRestore = () => {
            // Priority 1: Scroll to the exact ticket card
            if (ticketId) {
                const el = document.getElementById(`ticket-${ticketId}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'auto', block: 'center' });
                    sessionStorage.removeItem('lastTicketId');
                    sessionStorage.removeItem('scrollY');
                    sessionStorage.removeItem('ticketsLoadedCount');
                    if (container instanceof HTMLElement) {
                        setTimeout(() => { container.style.scrollBehavior = ''; }, 50);
                    }
                    return;
                }
            }

            // Priority 2: Pixel offset fallback
            if (savedScrollY) {
                const targetY = parseInt(savedScrollY, 10);
                container.scrollTo({ top: targetY, behavior: 'auto' });
                sessionStorage.removeItem('scrollY');
                sessionStorage.removeItem('lastTicketId');
                sessionStorage.removeItem('ticketsLoadedCount');
                if (container instanceof HTMLElement) {
                    setTimeout(() => { container.style.scrollBehavior = ''; }, 50);
                }
                return;
            }

            if (retryCount < maxRetries) {
                retryCount++;
                requestAnimationFrame(attemptRestore);
            }
        };

        // Use rAF for first frame, then retry if needed
        requestAnimationFrame(attemptRestore);
    }, [tickets]); // Fires when tickets are populated (instantly from cache)

    // Sync filters to URL params
    useEffect(() => {
        const currentParams = new URLSearchParams(Array.from(searchParams.entries()));
        let changed = false;

        const setOrDelete = (key: string, val: string, defaultVal: string) => {
            if (val && val !== defaultVal) {
                if (currentParams.get(key) !== val) {
                    currentParams.set(key, val);
                    changed = true;
                }
            } else {
                if (currentParams.has(key)) {
                    currentParams.delete(key);
                    changed = true;
                }
            }
        };

        // Status & Special flags URL syncing
        setOrDelete('slaBreached', selectedStatuses.includes('sla_breached') ? 'true' : '', '');
        setOrDelete('vendorTagged', selectedStatuses.includes('vendor_tagged') ? 'true' : '', '');
        setOrDelete('isInternal', selectedStatuses.includes('internal') ? 'true' : '', '');
        setOrDelete('raisedByRole', selectedStatuses.includes('tenant_raised') ? 'tenant' : '', '');
        setOrDelete('materialsRequired', selectedStatuses.includes('materials_required') ? 'true' : '', '');

        const statusVals: string[] = [];
        for (const s of selectedStatuses) {
            if (!['sla_breached', 'vendor_tagged', 'materials_required', 'tenant_raised', 'internal', 'all'].includes(s)) {
                statusVals.push(...s.split(',').map(x => x.trim()));
            }
        }
        const uniqueStatuses = Array.from(new Set(statusVals));
        setOrDelete('status', uniqueStatuses.join(','), initialStatusFilter === 'all' ? '' : initialStatusFilter);

        setOrDelete('category', categoryFilter, 'all');
        setOrDelete('search', searchQuery, '');
        setOrDelete('sortBy', sortBy, 'newest');
        setOrDelete('dateFrom', dateFrom, '');
        setOrDelete('dateTo', dateTo, '');
        setOrDelete('raisedBy', raisedByFilter, 'all');
        setOrDelete('resolvedBy', resolvedByFilter, 'all');
        setOrDelete('assignedTo', assignedToFilter, 'all');
        setOrDelete('floor', floorFilter, 'all');

        if (changed) {
            const newUrl = `${pathname}?${currentParams.toString()}`;
            // Use router.replace to ensure Next.js router state (including useSearchParams) is kept in sync
            // shallow: true is implicit in Next.js 13+ App Router for the same page
            router.replace(newUrl, { scroll: false });
        }
    }, [selectedStatuses, categoryFilter, searchQuery, sortBy, dateFrom, dateTo, raisedByFilter, resolvedByFilter, assignedToFilter, searchParams, initialStatusFilter, pathname, router]);

    useEffect(() => {
        // If initialStatusFilter prop changes (e.g. user toggles tabs outside), reset it
        if (!searchParams.has('status') && !searchParams.has('slaBreached') && !searchParams.has('isInternal') && !searchParams.has('raisedByRole') && !searchParams.has('materialsRequired')) {
            setSelectedStatuses(parseInitialStatuses(searchParams, initialStatusFilter));
        }
    }, [initialStatusFilter, searchParams]);

    useEffect(() => {
        // Get current user
        const getCurrentUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setCurrentUserId(user.id);
            }
        };
        getCurrentUser();
    }, []);

    const PAGE_SIZE = 100;

    // Pre-seed the ref when we have cache to prevent redundant initial fetch on back-navigation
    const currentParamsSnapshot = JSON.stringify({
        statusKey, propertyId, organizationId,
        raisedByFilter, assignedToFilter, categoryFilter,
        searchQuery, dateFrom, dateTo
    });
    const lastFetchedRef = useRef<string>(hasCacheHit ? currentParamsSnapshot : '');

    // Re-fetch only when filters actually change (SWR: skip initial if cache exists)
    useEffect(() => {
        const currentParams = JSON.stringify({
            statusKey, propertyId, organizationId,
            raisedByFilter, assignedToFilter, floorFilter, categoryFilter,
            searchQuery, dateFrom, dateTo
        });

        if (lastFetchedRef.current === currentParams) {
            // Cache hit on mount — do a SILENT background revalidation after scroll restoration
            if (hasCacheHit && !scrollRestoredRef.current) {
                // Wait for scroll restore, then silently revalidate
                const bgTimer = setTimeout(() => {
                    fetchTickets(0);
                    fetchFilterOptions();
                }, 800); // Delay background fetch so scroll restores first
                return () => clearTimeout(bgTimer);
            }
            return;
        }

        const timer = setTimeout(() => {
            lastFetchedRef.current = currentParams;
            fetchTickets(0);
            fetchFilterOptions();
        }, searchQuery ? 300 : 0); // Only debounce for text search

        return () => clearTimeout(timer);
    }, [statusKey, propertyId, organizationId, raisedByFilter, resolvedByFilter, assignedToFilter, floorFilter, sortBy, categoryFilter, searchQuery, dateFrom, dateTo]);

    const buildUrl = (offset: number, limitOverride?: number) => {
        const params = new URLSearchParams();

        if (selectedStatuses.includes('sla_breached')) params.set('slaBreached', 'true');
        if (selectedStatuses.includes('vendor_tagged')) params.set('vendorTagged', 'true');
        if (selectedStatuses.includes('materials_required')) params.set('materialsRequired', 'true');
        if (selectedStatuses.includes('tenant_raised')) params.set('raisedByRole', 'tenant');
        if (selectedStatuses.includes('internal')) params.set('isInternal', 'true');

        const statusValues: string[] = [];
        for (const s of selectedStatuses) {
            if (!['sla_breached', 'vendor_tagged', 'materials_required', 'tenant_raised', 'internal', 'all'].includes(s)) {
                statusValues.push(...s.split(',').map(x => x.trim()));
            }
        }
        const uniqueStatuses = Array.from(new Set(statusValues));
        if (uniqueStatuses.length > 0) {
            params.set('status', uniqueStatuses.join(','));
        }

        if (propertyId) params.set('propertyId', propertyId);
        else if (organizationId) params.set('organizationId', organizationId);

        if (raisedByFilter !== 'all') params.set('raisedBy', raisedByFilter);
        if (lockedAssigneeId) params.set('assignedTo', lockedAssigneeId);
        else if (assignedToFilter !== 'all') params.set('assignedTo', assignedToFilter);
        if (categoryFilter !== 'all') params.set('skillGroup', categoryFilter);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        if (searchQuery.trim()) params.set('search', searchQuery.trim());
        if (floorFilter !== 'all') params.set('floorNumber', floorFilter);

        params.set('limit', String(limitOverride || PAGE_SIZE));
        params.set('offset', String(offset));

        return `/api/tickets?${params.toString()}`;
    };

    const fetchTickets = async (offset: number) => {
        const isInitial = offset === 0;
        const hasCachedTickets = tickets.length > 0;

        // Check if we need to restore a larger set of tickets (pagination restoration)
        let limitOverride: number | undefined;
        if (isInitial) {
            const savedCount = sessionStorage.getItem('ticketsLoadedCount');
            if (savedCount) {
                limitOverride = Math.max(PAGE_SIZE, parseInt(savedCount, 10));
            }
        }

        if (isInitial) {
            // Only show full-page loading skeleton if we don't have cached data yet
            if (!hasCachedTickets) {
                setIsLoading(true);
                setTotalCount(null);
            }
        } else {
            setIsLoadingMore(true);
        }
        try {
            const res = await fetch(buildUrl(offset, limitOverride));
            if (!res.ok) {
                console.error('[TicketsView] API error:', res.status, res.statusText);
                if (isInitial) {
                    setTickets([]);
                    setTotalCount(0);
                }
                return;
            }
            const data = await res.json();
            const fetched: Ticket[] = data.tickets || [];
            const total: number = data.total ?? fetched.length;

            if (isInitial) {
                setTickets(fetched);
                setCachedData(cacheKey, fetched);
            } else {
                setTickets(prev => [...prev, ...fetched]);
            }
            setTotalCount(total);
            setHasMore(fetched.length === PAGE_SIZE && offset + fetched.length < total);
        } catch (error) {
            console.error('Error fetching tickets:', error);
            if (isInitial) setTickets([]);
        } finally {
            if (isInitial) setIsLoading(false);
            else setIsLoadingMore(false);
        }
    };

    // Fetch distinct creator/assignee users for filter dropdowns
    const fetchFilterOptions = async () => {
        const params = new URLSearchParams();
        if (propertyId) params.set('propertyId', propertyId);
        else if (organizationId) params.set('organizationId', organizationId);
        try {
            const res = await fetch(`/api/tickets/filter-options?${params.toString()}`);
            if (!res.ok) return;
            const data = await res.json();
            setAllCreators((data.creators || []).map((u: any) => ({ id: u.id, name: u.full_name })));
            setAllAssignees((data.assignees || []).map((u: any) => ({ id: u.id, name: u.full_name })));
            setAllFloors(data.floors || []);
            setHasUnspecified(data.hasUnspecified || false);
        } catch (error) {
            console.error('Error fetching filter options:', error);
        }
    };

    const loadMoreTickets = () => fetchTickets(tickets.length);

    // Owner 2026-11-15: load the next page by itself when the end of the list scrolls into view. It calls the same
    // loadMoreTickets; the guard stops a second call while one page is still loading. The observer is rebuilt after
    // every page, so a short page that leaves the end still in view loads the next one too.
    const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
    const loadMoreGuardRef = useRef(false);
    const loadMoreFnRef = useRef(loadMoreTickets);
    useEffect(() => { loadMoreFnRef.current = loadMoreTickets; });
    useEffect(() => { if (!isLoadingMore) loadMoreGuardRef.current = false; }, [isLoadingMore]);
    const canAutoLoad = typeof window === 'undefined' || 'IntersectionObserver' in window;
    useEffect(() => {
        if (!hasMore || isLoading || isLoadingMore || !canAutoLoad) return;
        const el = loadMoreSentinelRef.current;
        if (!el) return;
        const scroller = document.getElementById('main-scroll-container');
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some(en => en.isIntersecting) || loadMoreGuardRef.current) return;
            loadMoreGuardRef.current = true;
            loadMoreFnRef.current();
        }, { root: scroller && scroller.contains(el) ? scroller : null, rootMargin: '0px 0px 600px 0px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, isLoading, isLoadingMore, canAutoLoad, tickets.length]);
    const loadMoreByButton = () => {
        if (loadMoreGuardRef.current || isLoadingMore) return;
        loadMoreGuardRef.current = true;
        loadMoreTickets();
    };

    // Owner 2026-11-15: phone Filters sheet. It drives the same filter state as the desktop bar.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filtersButtonRef = useRef<HTMLButtonElement>(null);
    const filtersBodyRef = useRef<HTMLDivElement>(null);
    const closeFilters = useCallback(() => {
        setFiltersOpen(false);
        filtersButtonRef.current?.focus();
    }, []);
    useEffect(() => {
        if (!filtersOpen) return;
        const raf = requestAnimationFrame(() => filtersBodyRef.current?.querySelector<HTMLElement>('button, select, input')?.focus());
        return () => cancelAnimationFrame(raf);
    }, [filtersOpen]);

    // Listen for globally raised tickets to instantly display without page reload
    useEffect(() => {
        const handleCreated = (e: any) => {
            const newTicket = e?.detail?.ticket;
            const tempId = e?.detail?.tempId;
            if (newTicket && newTicket.id) {
                setTickets(prev => {
                    if (tempId && prev.some(t => t.id === tempId)) {
                        return prev.map(t => t.id === tempId ? { ...t, ...newTicket } : t);
                    }
                    return [newTicket, ...prev.filter(t => t.id !== newTicket.id)];
                });
                if (!tempId) {
                    setTotalCount(prev => (prev !== null ? prev + 1 : null));
                }
            }
            invalidateCache('tickets-');
            fetchTickets(0);
            fetchFilterOptions();
        };

        window.addEventListener('ticket-created', handleCreated);
        window.addEventListener('request-created', handleCreated);
        return () => {
            window.removeEventListener('ticket-created', handleCreated);
            window.removeEventListener('request-created', handleCreated);
        };
    }, [invalidateCache]);

    const handleUpdateStatus = async (ticketId: string, newStatus: string) => {
        try {
            const response = await fetch(`/api/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            if (response.ok) {
                fetchTickets(0);
            }
        } catch (error) {
            console.error('Error updating ticket:', error);
        }
    };

    const handleDelete = async (e: React.MouseEvent, ticketId: string) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this ticket?')) return;

        try {
            const response = await fetch(`/api/tickets/${ticketId}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                fetchTickets(0);
            }
        } catch (error) {
            console.error('Error deleting ticket:', error);
        }
    };

    const handleEditClick = (e: React.MouseEvent, ticket: Ticket) => {
        e.stopPropagation();
        setEditingTicket(ticket);
        setEditTitle(ticket.title || '');
        setEditDescription(ticket.description || '');
    };

    const handleEditSubmit = async () => {
        if (!editingTicket || !editTitle.trim()) return;

        setIsUpdating(true);
        try {
            const response = await fetch(`/api/tickets/${editingTicket.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editTitle.trim(),
                    description: (editDescription || '').trim()
                })
            });

            if (response.ok) {
                setEditingTicket(null);
                invalidateCache('tickets-');
                fetchTickets(0);
            } else {
                const data = await response.json();
                alert(data.error || 'Failed to update ticket');
            }
        } catch (error) {
            console.error('Error updating ticket:', error);
            alert('Failed to update ticket');
        } finally {
            setIsUpdating(false);
        }
    };

    // Check if current user can edit this ticket
    const canEditTicket = (ticket: Ticket): boolean => {
        if (!currentUserId) return false;
        // IT console (assignee-only view): the API lets a non-admin edit only the tickets they raised
        if (lockedAssigneeId) return (ticket as { raised_by?: string }).raised_by === currentUserId;
        // In this view (mostly used by admins/staff), we rely on the backend for strict checks,
        // but for UI purposes, we'll show the edit button for now.
        return true;
    };

    const handleTicketClick = (ticketId: string) => {
        // Save exact scroll position and ticket ID immediately before navigating out
        const scrollContainer = document.getElementById('main-scroll-container');
        const scrollPos = scrollContainer ? scrollContainer.scrollTop : window.scrollY;
        
        sessionStorage.setItem('scrollY', scrollPos.toString());
        sessionStorage.setItem('lastTicketId', ticketId);
        sessionStorage.setItem('ticketsLoadedCount', tickets.length.toString());
        
        router.push(`/tickets/${ticketId}?from=requests`);
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'critical': return 'text-error bg-error/10 border-error/20';
            case 'high': return 'text-warning bg-warning/10 border-warning/20';
            case 'medium': return 'text-secondary bg-secondary/10 border-secondary/20';
            case 'low': return 'text-text-tertiary bg-surface-elevated border-border';
            default: return 'text-text-tertiary bg-surface-elevated border-border';
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'resolved':
            case 'closed':
                return 'text-success bg-success/10 border-success/20';
            case 'in_progress':
            case 'assigned':
                return 'text-info bg-info/10 border-info/20';
            case 'open': return 'text-warning bg-warning/10 border-warning/20';
            case 'waitlist': return 'text-slate-500 bg-slate-100 border-slate-200';
            default: return 'text-text-tertiary bg-surface-elevated border-border';
        }
    };

    const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4 };

    const raisedByUsers = allCreators;

    const hasActiveFilters = dateFrom !== '' || dateTo !== '' || raisedByFilter !== 'all' || resolvedByFilter !== 'all' || assignedToFilter !== 'all' || floorFilter !== 'all' || sortBy !== 'newest';

    const filteredTickets = useMemo(() => {
        // dateFrom, dateTo, raisedByFilter, assignedToFilter, categoryFilter, searchQuery
        // are all applied server-side — only sort client-side within the fetched page.
        let result = [...tickets];

        result = result.sort((a, b) => {
            if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            if (sortBy === 'priority_high') return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
            if (sortBy === 'priority_low') return (priorityOrder[b.priority] ?? 3) - (priorityOrder[a.priority] ?? 3);
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        return result;
    }, [tickets, sortBy]);

    // Same number the old "N Results" badge showed.
    const resultCount = hasActiveFilters || categoryFilter !== 'all' || searchQuery.trim() ? filteredTickets.length : (totalCount ?? filteredTickets.length);
    const resultText = `${resultCount.toLocaleString('en-IN')} ticket${resultCount !== 1 ? 's' : ''}`;

    const statusOptions: StatusOption[] = [
        { value: 'all', label: 'All' },
        { value: 'open,assigned,in_progress,blocked,waitlist', label: 'Open', group: 'status' },
        { value: 'pending_validation', label: 'Pending validation', group: 'status' },
        { value: 'waitlist', label: 'Waitlist', group: 'status' },
        { value: 'resolved,closed,pending_validation', label: 'Completed', group: 'status' },
        { value: 'sla_breached', label: 'SLA breached', group: 'flag' },
        { value: 'vendor_tagged', label: 'Vendor tagged', group: 'flag' },
        { value: 'materials_required', label: isHighAdmin ? 'Material requested' : 'Material assigned', group: 'flag' },
        { value: 'tenant_raised', label: 'Client raised', group: 'flag' },
        { value: 'internal', label: 'Internal', group: 'flag' },
    ];
    const floorOptions = [
        { value: 'all', label: 'All floors' },
        ...(hasUnspecified ? [{ value: 'unspecified', label: 'Unspecified' }] : []),
        ...allFloors.map(f => ({ value: String(f), label: floorLabel(f) })),
    ];

    // How many filters are on (the badge on the phone Filters button).
    const activeFilterCount = [
        selectedStatuses.length > 0, categoryFilter !== 'all', sortBy !== 'newest', dateFrom !== '', dateTo !== '',
        raisedByFilter !== 'all', assignedToFilter !== 'all', floorFilter !== 'all',
    ].filter(Boolean).length;

    // The desktop "Clear filters" button: unchanged.
    const clearFilters = () => { setDateFrom(''); setDateTo(''); setRaisedByFilter('all'); setResolvedByFilter('all'); setAssignedToFilter('all'); setFloorFilter('all'); setSortBy('newest'); };
    // The phone sheet's "Clear all" also resets status and team, which live in the same sheet.
    const clearAllFilters = () => { clearFilters(); setSelectedStatuses([]); setCategoryFilter('all'); };

    const showFlowMap = Boolean(propertyId && !lockedAssigneeId && !['org_super_admin', 'master_admin', 'owner', 'tech'].includes(membership?.org_role || ''));
    const flowMapButton = showFlowMap && (
        <button
            onClick={() => router.push(`/property/${propertyId}/flow-map?from=requests`)}
            className="flex h-10 shrink-0 items-center justify-center gap-[8px] rounded-full border border-secondary/20 bg-secondary/10 px-3.5 text-sm font-bold text-secondary transition-colors hover:bg-secondary/20"
            title="View Operational Flow Map"
        >
            <Activity className="h-4 w-4" /> <span className="whitespace-nowrap">Live Flow Map</span>
        </button>
    );
    // #56737a: a darker shade of the brand teal (owner-approved) so the white text is easy to read.
    const newRequestButton = onNewRequest && (
        <button
            onClick={onNewRequest}
            className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#56737a] px-4 text-sm font-bold text-white transition-colors hover:bg-[#4a646a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#56737a] focus-visible:ring-offset-2"
        >
            <Plus className="h-4 w-4" strokeWidth={2.5} /> <span className="whitespace-nowrap">New request</span>
        </button>
    );

    const raisedByDisabled = !propertyId;
    const showRaisedBy = raisedByDisabled || raisedByUsers.length > 0;
    const showAssignedTo = !lockedAssigneeId && (!propertyId || allAssignees.length > 0);

    return (
        <div className="space-y-3 md:space-y-5">
            {/* "Support Tickets" heading (every screen except the Requests tab, whose page header has the title) */}
            {showHeading && (
                <div className="flex flex-wrap items-center gap-[12px]">
                    <h3 className="flex-1 whitespace-nowrap text-xl font-display font-bold text-text-primary">Support Tickets</h3>
                    {flowMapButton}
                    {newRequestButton}
                </div>
            )}

            {/* Phone (below md): search + Filters button, then the view switch and the count */}
            <div className="space-y-2.5 md:hidden">
                <div className="flex gap-[8px]">
                    <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search by ticket ID"
                            aria-label="Search by ticket ID"
                            className="h-11 w-full rounded-full border border-gray-300 bg-white pl-10 pr-10 text-base text-gray-900 placeholder:text-gray-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                        />
                        {searchQuery && (
                            <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 hover:text-gray-900">
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <button
                        ref={filtersButtonRef}
                        type="button"
                        onClick={() => setFiltersOpen(true)}
                        aria-haspopup="dialog"
                        aria-expanded={filtersOpen}
                        className="flex h-11 shrink-0 items-center gap-[8px] rounded-full border border-gray-300 bg-white px-3.5 text-[15px] font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                        <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
                        Filters
                        {activeFilterCount > 0 && (
                            <>
                                <span aria-hidden="true" className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-700 px-1.5 text-xs font-bold tabular-nums text-white">{activeFilterCount}</span>
                                <span className="sr-only">({activeFilterCount} on)</span>
                            </>
                        )}
                    </button>
                </div>
                {(viewSwitcher || !isLoading) && (
                    <div className="flex items-center justify-between gap-[8px]">
                        {viewSwitcher}
                        {!isLoading && <span className="ml-auto text-[13px] tabular-nums text-gray-600">{resultText}</span>}
                    </div>
                )}
            </div>

            {/* md and up: search, count and New on top; the filters below, wrapping cleanly */}
            <div className="hidden flex-col gap-[10px] md:flex">
                <div className="flex flex-wrap items-center gap-[8px]">
                    {viewSwitcher}
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search by ticket ID"
                            aria-label="Search by ticket ID"
                            className="h-10 w-56 rounded-full border border-slate-300 bg-white pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-500 transition-colors hover:border-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {searchQuery && (
                            <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="ml-auto flex items-center gap-[8px]">
                        {!isLoading && <span className="whitespace-nowrap text-sm tabular-nums text-slate-600">{resultText}</span>}
                        {!showHeading && flowMapButton}
                        {!showHeading && newRequestButton}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-[8px]">
                    <MultiSelectStatusDropdown
                        selectedValues={selectedStatuses}
                        onChange={setSelectedStatuses}
                        options={statusOptions}
                        placeholder="Status"
                    />

                    <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        aria-label="Team"
                        className="h-10 rounded-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        {TEAM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>

                    <FilterDropdown
                        value={sortBy}
                        onChange={(v) => setSortBy(v as typeof sortBy)}
                        options={SORT_OPTIONS}
                        placeholder="Sort"
                    />

                    {/* Date From */}
                    <div className={`flex h-10 items-center gap-[8px] rounded-full border bg-white px-3 transition-colors hover:border-slate-400 ${dateFrom ? 'border-primary/50' : 'border-slate-300'}`}>
                        <Calendar className={`h-4 w-4 shrink-0 ${dateFrom ? 'text-primary' : 'text-slate-500'}`} aria-hidden="true" />
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            aria-label="From date"
                            className="w-[118px] cursor-pointer bg-transparent text-sm font-semibold text-slate-700 focus:outline-none"
                        />
                    </div>

                    {/* Date To */}
                    <div className={`flex h-10 items-center gap-[8px] rounded-full border bg-white px-3 transition-colors hover:border-slate-400 ${dateTo ? 'border-primary/50' : 'border-slate-300'}`}>
                        <Calendar className={`h-4 w-4 shrink-0 ${dateTo ? 'text-primary' : 'text-slate-500'}`} aria-hidden="true" />
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            aria-label="To date"
                            className="w-[118px] cursor-pointer bg-transparent text-sm font-semibold text-slate-700 focus:outline-none"
                        />
                    </div>

                    {/* Raised By User Filter */}
                    {!propertyId ? (
                        <div className="flex h-10 select-none items-center gap-[8px] rounded-full border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500" title="Select a property to filter by user">
                            <User className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span>Raised by: pick a property</span>
                        </div>
                    ) : raisedByUsers.length > 0 && (
                        <FilterDropdown
                            value={raisedByFilter}
                            onChange={setRaisedByFilter}
                            options={[
                                { value: 'all', label: 'Raised by: All' },
                                ...raisedByUsers.map(u => ({ value: u.id, label: u.name }))
                            ]}
                            icon={<User className="h-4 w-4" />}
                        />
                    )}

                    {/* Assigned To Filter (hidden in the IT console's assignee-only view) */}
                    {lockedAssigneeId ? null : !propertyId ? (
                        <div className="flex h-10 select-none items-center gap-[8px] rounded-full border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500" title="Select a property to filter by user">
                            <User className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span>Assigned to: pick a property</span>
                        </div>
                    ) : allAssignees.length > 0 && (
                        <FilterDropdown
                            value={assignedToFilter}
                            onChange={setAssignedToFilter}
                            options={[
                                { value: 'all', label: 'Assigned to: All' },
                                ...allAssignees.map(u => ({ value: u.id, label: u.name }))
                            ]}
                            icon={<User className="h-4 w-4" />}
                        />
                    )}

                    {/* Floor Filter */}
                    {allFloors.length > 0 && (
                        <FilterDropdown
                            value={floorFilter}
                            onChange={setFloorFilter}
                            options={floorOptions}
                            icon={<Building2 className="h-4 w-4" />}
                        />
                    )}

                    {/* Clear Filters */}
                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="h-10 rounded-full border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-50"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {/* Phone Filters sheet: the same filter state as the bar above */}
            <BottomSheet
                open={filtersOpen}
                onClose={closeFilters}
                title="Filters"
                headerAction={
                    <button type="button" onClick={clearAllFilters} className="rounded-[8px] px-2 py-3 text-[15px] font-bold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
                        Clear all
                    </button>
                }
                footer={
                    <button type="button" onClick={closeFilters} className="h-[52px] w-full rounded-[14px] bg-blue-700 text-[17px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
                        {isLoading ? 'Show tickets' : `Show ${resultText}`}
                    </button>
                }
            >
                <div ref={filtersBodyRef} className="flex flex-col gap-[18px] pt-2" style={{ fontFamily: 'var(--font-body)' }}>
                    <div role="group" aria-labelledby="tickets-filter-status">
                        <p id="tickets-filter-status" className="mb-2 text-[13px] font-bold uppercase tracking-[0.04em] text-gray-600">Status</p>
                        <div className="flex flex-wrap gap-[8px]">
                            <SheetPill
                                active={selectedStatuses.length === 0}
                                onClick={() => setSelectedStatuses([])}
                            >
                                All
                            </SheetPill>
                            {statusOptions.filter(o => o.value !== 'all').map(o => (
                                <SheetPill
                                    key={o.value}
                                    active={selectedStatuses.includes(o.value)}
                                    onClick={() => {
                                        setSelectedStatuses(prev =>
                                            prev.includes(o.value)
                                                ? prev.filter(v => v !== o.value)
                                                : [...prev, o.value]
                                        );
                                    }}
                                >
                                    {o.label}
                                </SheetPill>
                            ))}
                        </div>
                    </div>

                    <div role="group" aria-labelledby="tickets-filter-team">
                        <p id="tickets-filter-team" className="mb-2 text-[13px] font-bold uppercase tracking-[0.04em] text-gray-600">Team</p>
                        <div className="flex flex-wrap gap-[8px]">
                            {TEAM_OPTIONS.map(o => (
                                <SheetPill key={o.value} active={categoryFilter === o.value} onClick={() => setCategoryFilter(o.value)}>{o.value === 'all' ? 'All' : o.label}</SheetPill>
                            ))}
                        </div>
                    </div>

                    <div role="group" aria-labelledby="tickets-filter-dates">
                        <p id="tickets-filter-dates" className="mb-2 text-[13px] font-bold uppercase tracking-[0.04em] text-gray-600">Dates</p>
                        <div className="flex gap-[8px]">
                            {([['From', dateFrom, setDateFrom], ['To', dateTo, setDateTo]] as const).map(([label, val, set]) => (
                                <div key={label} className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-gray-300 px-2.5 focus-within:ring-2 focus-within:ring-blue-600">
                                    <span className="shrink-0 text-sm text-gray-600">{label}</span>
                                    <input
                                        type="date"
                                        value={val}
                                        onChange={(e) => set(e.target.value)}
                                        aria-label={`${label} date`}
                                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col overflow-hidden rounded-[14px] border border-gray-200">
                        <SheetSelectRow label="Sort" value={sortBy} onChange={(v) => setSortBy(v as typeof sortBy)} options={SORT_OPTIONS} last={!showRaisedBy && !showAssignedTo && allFloors.length === 0} />
                        {showRaisedBy && (
                            <SheetSelectRow
                                label="Raised by"
                                value={raisedByFilter}
                                onChange={setRaisedByFilter}
                                options={[{ value: 'all', label: 'Anyone' }, ...raisedByUsers.map(u => ({ value: u.id, label: u.name }))]}
                                disabledText={raisedByDisabled ? 'Pick a property' : undefined}
                                last={!showAssignedTo && allFloors.length === 0}
                            />
                        )}
                        {showAssignedTo && (
                            <SheetSelectRow
                                label="Assigned to"
                                value={assignedToFilter}
                                onChange={setAssignedToFilter}
                                options={[{ value: 'all', label: 'Anyone' }, ...allAssignees.map(u => ({ value: u.id, label: u.name }))]}
                                disabledText={!propertyId ? 'Pick a property' : undefined}
                                last={allFloors.length === 0}
                            />
                        )}
                        {allFloors.length > 0 && (
                            <SheetSelectRow label="Floor" value={floorFilter} onChange={setFloorFilter} options={floorOptions} last />
                        )}
                    </div>
                </div>
            </BottomSheet>

            {/* Tickets List: one column on phones, as many 360px+ columns as fit from sm up */}
            <div>
                {isLoading ? (
                    <div className={`${TICKET_GRID_CLASS} gap-[12px] md:gap-[16px]`}>
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div key={i} className="w-full h-[220px] bg-white rounded-2xl border border-gray-100 p-5 flex flex-col gap-4">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1 flex gap-3">
                                        <Skeleton className="w-16 h-16 rounded-xl flex-shrink-0" />
                                        <div className="flex-1 space-y-2">
                                            <Skeleton className="h-4 w-3/4 rounded" />
                                            <Skeleton className="h-4 w-1/2 rounded" />
                                        </div>
                                    </div>
                                    <Skeleton className="w-16 h-8 rounded-lg" />
                                </div>
                                <div className="flex gap-2">
                                    <Skeleton className="h-6 w-16 rounded-full" />
                                    <Skeleton className="h-6 w-20 rounded-full" />
                                </div>
                                <div className="mt-auto pt-4 border-t border-gray-50 flex justify-between items-center">
                                    <Skeleton className="h-4 w-24 rounded" />
                                    <Skeleton className="h-8 w-24 rounded-lg" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : filteredTickets.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-text-tertiary font-body">
                        {searchQuery ? `No tickets found matching "${searchQuery}"` : 'No tickets found'}
                    </div>
                ) : (
                    <div className={`${TICKET_GRID_CLASS} gap-[12px] md:gap-[16px]`}>
                        {filteredTickets.map((ticket: any) => (
                            <div key={ticket.id} id={`ticket-${ticket.id}`}>
                                <TicketCard
                                    id={ticket.id}
                                    title={ticket.title}
                                    description={ticket.description}
                                    priority={ticket.priority?.toUpperCase() as any || 'MEDIUM'}
                                    status={
                                        ['closed', 'resolved'].includes(ticket.status) ? 'COMPLETED' :
                                            ticket.status === 'in_progress' ? 'IN_PROGRESS' :
                                                ticket.status === 'pending_validation' ? 'PENDING_VALIDATION' :
                                                    ticket.status === 'waitlist' ? 'WAITLISTED' :
                                                        ticket.assigned_to ? 'ASSIGNED' : 'OPEN'
                                    }
                                    ticketNumber={ticket.ticket_number}
                                    createdAt={ticket.created_at}
                                    raisedBy={ticket.creator?.full_name}
                                    raisedByPhotoUrl={ticket.creator?.user_photo_url}
                                    resolvedAt={(ticket as any).resolved_at}
                                    updatedAt={(ticket as any).updated_at}
                                    assignedTo={ticket.assignee?.full_name}
                                    assigneePhotoUrl={ticket.assignee?.user_photo_url}
                                    photoUrl={ticket.photo_before_url}
                                    // Owner 2026-11-20: one property chosen, so its name on every card adds nothing.
                                    propertyName={propertyId ? undefined : ticket.property?.name}
                                    workPaused={['paused', 'blocked'].includes(ticket.status)}
                                    slaDeadline={ticket.sla_deadline}
                                    slaBreached={ticket.sla_breached}
                                    slaPaused={ticket.sla_paused}
                                    slaPauseReason={ticket.sla_pause_reason}
                                    escalationChain={(() => {

                                        const logs = ticket.ticket_escalation_logs;
                                        if (!logs || logs.length === 0) return undefined;
                                        const sorted = [...logs].sort((a, b) => new Date(a.escalated_at).getTime() - new Date(b.escalated_at).getTime());
                                        const chain: { name: string; avatar?: string | null }[] = [];
                                        sorted.forEach((log, i) => {
                                            if (i === 0 && log.from_employee?.full_name) chain.push({ name: log.from_employee.full_name, avatar: log.from_employee.user_photo_url });
                                            if (log.to_employee?.full_name) chain.push({ name: log.to_employee.full_name, avatar: log.to_employee.user_photo_url });
                                        });
                                        return chain.length > 0 ? chain : undefined;
                                    })()}
                                    raisedByTenant={(ticket.creator?.property_memberships || []).some((m: any) => m.property_id === (ticket.property_id || ticket.property?.id) && ['tenant', 'super_tenant'].includes((m.role || '').toLowerCase()))}
                                    isInternal={Boolean(ticket.internal ?? ticket.is_internal)}
                                    onClick={() => handleTicketClick(ticket.id)}
                                    onEdit={canEditTicket(ticket) ? (e) => handleEditClick(e, ticket) : undefined}
                                    onDelete={canDelete ? (e) => handleDelete(e, ticket.id) : undefined}
                                    hasMaterialRequest={Boolean((ticket.material_requests?.length ?? 0) > 0)}
                                    isVendorTagged={Boolean(ticket.needs_vendor_procurement)}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* End of the list. Scrolling here loads the next page (see loadMoreSentinelRef); the button is only
                    shown where the browser cannot do that. */}
                {!isLoading && filteredTickets.length > 0 && (
                    <div ref={loadMoreSentinelRef} className="flex flex-col items-center gap-[8px] pt-5 pb-20 text-sm text-gray-600 md:pb-6" aria-live="polite">
                        {isLoadingMore ? (
                            <span className="flex items-center gap-[8px]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading more tickets…</span>
                        ) : hasMore ? (
                            <>
                                <span>More tickets load as you scroll</span>
                                {!canAutoLoad && (
                                    <button type="button" onClick={loadMoreByButton} className="h-10 rounded-[12px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                                        Load more
                                    </button>
                                )}
                            </>
                        ) : (
                            <span>That&apos;s all</span>
                        )}
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            <AnimatePresence>
                {editingTicket && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => setEditingTicket(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between p-6 border-b border-slate-200">
                                <h2 className="text-xl font-bold text-slate-900">Edit Request</h2>
                                <button
                                    onClick={() => setEditingTicket(null)}
                                    className="text-slate-400 hover:text-slate-700 transition-colors p-1 hover:bg-slate-100 rounded-lg"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Modal Content */}
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="text-sm font-bold text-slate-700 mb-2 block">Title</label>
                                    <input
                                        type="text"
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                                        placeholder="Request title"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-slate-700 mb-2 block">Description</label>
                                    <textarea
                                        value={editDescription}
                                        onChange={(e) => setEditDescription(e.target.value)}
                                        className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                                        placeholder="Describe the issue in your own words...&#10;Example: Leaking tap in kitchenette, 2nd floor"
                                    />
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200">
                                <button
                                    onClick={() => setEditingTicket(null)}
                                    className="px-4 py-2 text-slate-600 font-semibold rounded-xl hover:bg-slate-100 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleEditSubmit}
                                    disabled={isUpdating || !editTitle.trim()}
                                    className="flex items-center gap-2 px-5 py-2 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-colors disabled:opacity-50"
                                >
                                    {isUpdating ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <CheckCircle2 className="w-4 h-4" />
                                    )}
                                    Save Changes
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
};

export default TicketsView;

