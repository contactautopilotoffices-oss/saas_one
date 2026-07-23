'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { motion, AnimatePresence } from 'framer-motion';
import { useDataCache } from '@/frontend/context/DataCacheContext';
import { History, User, Calendar, CheckCircle2, Clock, Trash2, Play, Eye, AlertTriangle, Square, LayoutGrid, Timer, XCircle, ChevronDown, ChevronUp, Download, FileText, ChevronRight, Search, X } from 'lucide-react';

interface SOPCompletionHistoryProps {
    propertyId?: string;
    propertyIds?: string[];
    onSelectTemplate: (id: string, propertyId: string, completionId?: string, completionDate?: string) => void;
    onViewDetail: (id: string, templateId: string, propertyId: string) => void;
    isAdmin?: boolean;
    userRole?: string;
    activeView?: 'list' | 'history' | 'reports';
    onViewChange?: (v: 'list' | 'history' | 'reports') => void;
    initialFilter?: 'all' | 'due' | 'missed' | 'completed';
    onFilterChange?: (filter: 'all' | 'due' | 'missed' | 'completed') => void;
}

/** Parse every_N_hour(s) frequency → interval in hours, or null */
function parseHourlyInterval(frequency: string): number | null {
    const m = frequency.match(/^every_(\d+)_hours?$/);
    return m ? parseInt(m[1]) : null;
}

/** Human-readable label for any frequency value */
export function frequencyLabel(frequency: string): string {
    const hourly = parseHourlyInterval(frequency);
    if (hourly) return hourly === 1 ? 'Every 1 hr' : `Every ${hourly} hrs`;
    const map: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', on_demand: 'On Demand' };
    return map[frequency] ?? frequency;
}

/** Format milliseconds → "Xh Ym Zs" countdown string */
function fmtRemaining(ms: number): string {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/** Format HH:MM (24h) → "H:MM AM/PM" */
export function fmt12h(hhmm: string): string {
    if (!hhmm) return 'N/A';
    const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Helper: Get date parts forced to Asia/Kolkata (IST) */
function getISTDateParts(date: Date) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map: any = {};
    parts.forEach(p => map[p.type] = p.value);
    
    const year = parseInt(map.year);
    const month = parseInt(map.month);
    const day = parseInt(map.day);
    const hour = parseInt(map.hour);
    const minute = parseInt(map.minute);
    
    // Construct ISO date string (YYYY-MM-DD)
    const isoDate = `${map.year}-${map.month.padStart(2, '0')}-${map.day.padStart(2, '0')}`;
    
    return {
        year, month, day, hour, minute,
        isoDate,
        totalMins: hour * 60 + minute,
        todayStart: new Date(`${isoDate}T00:00:00+05:30`)
    };
}

/** Compute the slot window a completion belongs to, e.g. "09:00 – 12:00" */
function getCompletionSlot(
    timestampStr: string | null,
    frequency: string,
    startTime?: string | null,
    explicitSlotTime?: string | null
): string | null {
    const intervalHours = parseHourlyInterval(frequency);
    if (!intervalHours || !startTime) return null;

    if (explicitSlotTime) {
        const [h, m] = explicitSlotTime.slice(0, 5).split(':').map(Number);
        const start = h * 60 + m;
        const end = start + intervalHours * 60;
        const fmt = (mins: number) => {
            const hh = Math.floor(mins / 60) % 24;
            const mm = mins % 60;
            return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        };
        return `${fmt(start)} – ${fmt(end)}`;
    }

    if (!timestampStr) return null;

    // Use India local time for slot calculation
    const ist = getISTDateParts(new Date(timestampStr));
    const dtMins = ist.totalMins;
    const [sH, sM] = startTime.slice(0, 5).split(':').map(Number);
    const startMins = sH * 60 + sM;
    
    let elapsed = dtMins - startMins;
    if (elapsed < 0) elapsed += 1440; 

    const slotIndex = Math.floor(elapsed / (intervalHours * 60));
    const slotStartMins = startMins + slotIndex * intervalHours * 60;
    const slotEndMins = slotStartMins + intervalHours * 60;

    const fmt = (mins: number) => {
        const h = Math.floor(mins / 60) % 24;
        const m = mins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    return `${fmt(slotStartMins)} – ${fmt(slotEndMins)}`;
}

/** Returns the slot start as "HH:MM" for the current moment, or null for non-hourly templates.
 *  Respects endTime — if we're past the last valid slot, returns null. */
function computeCurrentSlotStart(frequency: string, startTime: string | null, now: Date, endTime?: string | null): string | null {
    const intervalH = parseHourlyInterval(frequency);
    if (!intervalH || !startTime) return null;
    
    const ist = getISTDateParts(now);
    const nowMins = ist.totalMins;
    
    const [sH, sM] = startTime.slice(0, 5).split(':').map(Number);
    const startMins = sH * 60 + sM;
    const elapsed = nowMins - startMins;
    
    // If it's before start time, it might still be in the previous day's overnight shift
    if (elapsed < 0 && !isWithinTimeWindow(nowMins, startTime, endTime || '23:59')) return null;

    // Compute the raw slot start
    const elapsedActual = elapsed < 0 ? elapsed + 1440 : elapsed;
    let slotStartMins = startMins + Math.floor(elapsedActual / (intervalH * 60)) * intervalH * 60;

    // Clamp to the last valid slot: a slot is valid only if its END fits within endTime
    if (endTime) {
        const [eH, eM] = endTime.slice(0, 5).split(':').map(Number);
        const endMins = eH * 60 + eM;
        const isOvernight = endMins <= startMins;
        
        const windowDuration = isOvernight ? (1440 - startMins + endMins) : (endMins - startMins);
        const elapsedSinceStart = isOvernight && nowMins < endMins ? (nowMins + 1440 - startMins) : (nowMins - startMins);

        if (elapsedSinceStart < 0 || elapsedSinceStart >= windowDuration) return null;
        
        const lastValidSlotStartOffset = Math.floor((windowDuration - intervalH * 60) / (intervalH * 60)) * intervalH * 60;
        const currentSlotOffset = Math.floor(elapsedSinceStart / (intervalH * 60)) * intervalH * 60;
        
        if (currentSlotOffset > lastValidSlotStartOffset) return null;

        slotStartMins = startMins + currentSlotOffset;
    }

    const h = Math.floor(slotStartMins / 60) % 24;
    const mn = slotStartMins % 60;
    return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}

/** Helper: determine if now is within a time window, correctly handling overnight ranges. */
function isWithinTimeWindow(nm: number, st: string, et: string): boolean {
    const [sh, sm] = st.slice(0, 5).split(':').map(Number);
    const [eh, em] = et.slice(0, 5).split(':').map(Number);
    const smins = sh * 60 + sm;
    const emins = eh * 60 + em;
    if (emins <= smins) {
        // Overnight window (e.g., 22:00 → 07:00): open past start OR before end
        return nm >= smins || nm < emins;
    }
    // Normal window: between start and end
    return nm >= smins && nm <= emins;
}

// Helper: check if a template is due based on frequency, time window, and last completion
export function isDue(
    frequency: string,
    lastCompletionDate: string | null,
    startTime?: string | null,
    endTime?: string | null,
    lastCompletedAt?: string | null,
    startedAt?: string | null,
    baseDate?: Date
): { due: boolean; label: string; status: 'due' | 'missed' | 'completed' | 'upcoming' | '' } {
    if (frequency === 'on_demand') return { due: false, label: '', status: '' };

    const now = baseDate || new Date();
    const ist = getISTDateParts(now);
    const nowMins = ist.totalMins;
    const todayStr = ist.isoDate;
    const intervalHours = parseHourlyInterval(frequency);

    // ── Hourly + time window → daily-reset schedule logic ───────────────────
    if (intervalHours !== null && startTime && endTime) {
        const [sH, sM] = startTime.slice(0, 5).split(':').map(Number);
        const [eH, eM] = endTime.slice(0, 5).split(':').map(Number);
        const startMins = sH * 60 + sM;
        const endMins = eH * 60 + eM;

        const isOvernight = endMins <= startMins;
        let baselineDateStr = todayStr;
        
        if (isOvernight && nowMins < endMins) {
            // We are in the morning part of an overnight window, baseline is yesterday
            const yesterday = new Date(now.getTime() - 86400000);
            baselineDateStr = getISTDateParts(yesterday).isoDate;
        }

        const baselineStart = new Date(`${baselineDateStr}T${startTime.slice(0,5)}:00+05:30`);
        const windowDurationMins = isOvernight ? (1440 - startMins + endMins) : (endMins - startMins);
        
        const todaySlots: Date[] = [];
        let t = 0;
        while (t + intervalHours * 60 <= windowDurationMins) {
            const slotTime = new Date(baselineStart.getTime() + t * 60 * 1000);
            todaySlots.push(slotTime);
            t += intervalHours * 60;
        }

        const passedSlots = todaySlots.filter(s => s <= now);
        const currentSlot = passedSlots.length > 0 ? passedSlots[passedSlots.length - 1] : null;

        if (!currentSlot) {
            return { due: false, label: `Starts at ${fmt12h(startTime)}`, status: 'upcoming' };
        }

        const lastDone = lastCompletedAt ? new Date(lastCompletedAt) : null;
        const isDone = lastDone && lastDone >= currentSlot;

        if (isDone) {
            const nextSlot = todaySlots.find(s => s > now);
            if (!nextSlot) return { due: false, label: 'All done today', status: 'completed' };
            return { due: false, label: `Next in ${fmtRemaining(nextSlot.getTime() - now.getTime())}`, status: 'completed' };
        }

        // Within time window?
        if (isWithinTimeWindow(nowMins, startTime, endTime)) {
            const overdueMins = Math.floor((now.getTime() - currentSlot.getTime()) / 60000);
            if (overdueMins < 2) return { due: true, label: 'Due now', status: 'due' };
            const oh = Math.floor(overdueMins / 60), om = overdueMins % 60;
            const label = oh > 0 ? (om > 0 ? `Overdue ${oh}h ${om}m` : `Overdue ${oh}h`) : `Overdue ${overdueMins}m`;
            return { due: true, label, status: 'due' };
        }

        return { due: false, label: 'Missed slot', status: 'missed' };
    }

    // ── Hourly without time window ───────────────────────────────────────────
    if (intervalHours !== null) {
        const lastTs = lastCompletedAt ? new Date(lastCompletedAt) : lastCompletionDate ? new Date(lastCompletionDate) : null;
        if (!lastTs) return { due: true, label: 'Not started', status: 'due' };

        const diffMs = now.getTime() - lastTs.getTime();
        const intervalMs = intervalHours * 60 * 60 * 1000;
        const remainingMs = intervalMs - diffMs;
        if (remainingMs > 0) return { due: false, label: `Next in ${fmtRemaining(remainingMs)}`, status: 'upcoming' };
        const overdueMins = Math.floor((diffMs - intervalMs) / 60000);
        const oh = Math.floor(overdueMins / 60), om = overdueMins % 60;
        const label = oh > 0 ? (om > 0 ? `Overdue ${oh}h ${om}m` : `Overdue ${oh}h`) : `Overdue ${overdueMins}m`;
        return { due: true, label, status: 'due' };
    }

    // ── Daily / weekly / monthly ─────────────────────────────────────────────
    if (!lastCompletionDate) {
        if (frequency === 'daily' && startTime && endTime) {
            if (isWithinTimeWindow(nowMins, startTime, endTime)) return { due: true, label: 'Due now', status: 'due' };
            const [sh] = startTime.slice(0, 5).split(':').map(Number);
            if (nowMins < sh * 60) return { due: false, label: `Starts at ${fmt12h(startTime)}`, status: 'upcoming' };
            return { due: true, label: 'Missed', status: 'missed' };
        }
        return { due: true, label: 'Not started', status: 'due' };
    }

    if (frequency === 'daily') {
        const last = lastCompletedAt ? new Date(lastCompletedAt) : new Date(lastCompletionDate);
        if (startTime && endTime) {
            const [sh, sm] = startTime.slice(0, 5).split(':').map(Number);
            const [eh, em] = endTime.slice(0, 5).split(':').map(Number);
            const smins = sh * 60 + sm;
            const emins = eh * 60 + em;
            const isOvernight = emins <= smins;

            let currentWindowStartStr = todayStr;
            if (isOvernight && nowMins < emins) {
                const yesterday = new Date(now.getTime() - 86400000);
                currentWindowStartStr = getISTDateParts(yesterday).isoDate;
            }
            
            const currentWindowStart = new Date(`${currentWindowStartStr}T${startTime.slice(0,5)}:00+05:30`);
            const logicalDate = currentWindowStartStr;
            const isDoneInCurrentWindow = lastCompletionDate === logicalDate && (last.getTime() >= currentWindowStart.getTime() || lastCompletedAt);
            
            if (isDoneInCurrentWindow && lastCompletedAt) return { due: false, label: 'Done today', status: 'completed' };
            if (isWithinTimeWindow(nowMins, startTime, endTime)) return { due: true, label: 'Due now', status: 'due' };
            if (nowMins < smins) return { due: false, label: `Starts at ${fmt12h(startTime)}`, status: 'upcoming' };

            const isPastWindow = isOvernight ? (nowMins >= emins && nowMins < smins) : (nowMins >= emins);
            if (isPastWindow) return { due: true, label: 'Missed', status: 'missed' };
            return { due: false, label: `Starts at ${fmt12h(startTime)}`, status: 'upcoming' };
        }

        const isSameDay = lastCompletionDate === todayStr;
        if (isSameDay) return { due: false, label: 'Done today', status: 'completed' };
        return { due: true, label: 'Due today', status: 'due' };
    }

    const last = new Date(lastCompletionDate);
    const diffMs = now.getTime() - last.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (frequency === 'weekly') {
        if (diffDays < 7) return { due: false, label: `Due in ${7 - diffDays}d`, status: 'upcoming' };
        return { due: true, label: diffDays === 7 ? 'Due today' : `Overdue by ${diffDays - 7}d`, status: 'due' };
    }
    if (frequency === 'monthly') {
        if (diffDays < 30) return { due: false, label: `Due in ${30 - diffDays}d`, status: 'upcoming' };
        return { due: true, label: diffDays === 30 ? 'Due today' : `Overdue by ${diffDays - 30}d`, status: 'due' };
    }

    return { due: false, label: '', status: '' };
}

const SOPCompletionHistory: React.FC<SOPCompletionHistoryProps> = ({ propertyId, propertyIds, onSelectTemplate, onViewDetail, isAdmin = false, userRole, activeView = 'history', onViewChange, initialFilter = 'all', onFilterChange }) => {
    const isMultiProperty = !!propertyIds && propertyIds.length > 0;
    const [completions, setCompletions] = useState<any[]>([]);
    const [rawTemplateData, setRawTemplateData] = useState<Array<{ template: any; latestCompletion: any; lastDate: string | null }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [liveNow, setLiveNow] = useState(() => new Date());
    const supabase = React.useMemo(() => createClient(), []);
    const { getCachedData, setCachedData, invalidateCache } = useDataCache();
    const [activeFilter, setActiveFilter] = useState<'all' | 'due' | 'missed' | 'completed'>(initialFilter);
    const [isAllTime, setIsAllTime] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    // Search filter helper
    const filterBySearch = (items: any[]) => {
        if (!searchQuery.trim()) return items;
        const query = searchQuery.toLowerCase().trim();
        return items.filter(item => {
            const template = item.template || item;
            return (template.title || '').toLowerCase().includes(query) ||
                   (template.description || '').toLowerCase().includes(query);
        });
    };

    // Always use IST for current date selection
    const todayIST = getISTDateParts(liveNow).isoDate;
    const [selectedDate, setSelectedDate] = useState(todayIST);
    const isToday = selectedDate === todayIST;

    useEffect(() => {
        const id = setInterval(() => setLiveNow(new Date()), 5000);
        return () => clearInterval(id);
    }, []);

    const fetchData = useMemo(() => async () => {
        const cacheKey = `sop-history-${propertyId || (propertyIds?.join(','))}-${isAdmin}`;
        const cached = getCachedData(cacheKey);

        if (cached) {
            setCompletions(cached.completions);
            setRawTemplateData(cached.rawTemplateData);
            setIsLoading(false);
        } else {
            setIsLoading(true);
        }

        try {
                // Fetch completions
                let completionQuery = supabase
                    .from('sop_completions')
                    .select(`
                        *,
                        template:sop_templates(title, frequency, category, start_time, end_time),
                        user:completed_by(full_name),
                        items:sop_completion_items(is_checked, value)
                    `)
                    .order('completion_date', { ascending: false })
                    .order('completed_at', { ascending: false });

                if (isMultiProperty) {
                    completionQuery = (completionQuery as any).in('property_id', propertyIds);
                } else if (propertyId) {
                    completionQuery = (completionQuery as any).eq('property_id', propertyId);
                }

                const { data: completionData, error: completionError } = await completionQuery;
                if (completionError) throw completionError;
                const results = completionData || [];
                setCompletions(results);

                // Fetch all active + running templates to determine due SOPs
                let templateQuery = supabase
                    .from('sop_templates')
                    .select('id, title, frequency, category, assigned_to, start_time, end_time, started_at, property_id, is_running')
                    .eq('is_active', true)
                    .neq('frequency', 'on_demand');

                if (isMultiProperty) {
                    templateQuery = (templateQuery as any).in('property_id', propertyIds);
                } else if (propertyId) {
                    templateQuery = (templateQuery as any).eq('property_id', propertyId);
                }

                const { data: templates, error: templateError } = await templateQuery;
                if (templateError) throw templateError;

                let applicableTemplates = templates || [];
                if (!isAdmin) {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                        applicableTemplates = applicableTemplates.filter(t =>
                            !t.assigned_to || t.assigned_to.length === 0 || t.assigned_to.includes(user.id)
                        );
                    } else {
                        applicableTemplates = [];
                    }
                }

                const rows = applicableTemplates.map(template => {
                    const templateCompletions = results.filter(
                        (c: any) => c.template_id === template.id && c.status === 'completed'
                    );
                    const sorted = [...templateCompletions].sort((a, b) => {
                        const tA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
                        const tB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
                        return tB - tA;
                    });
                    const latestCompletion = sorted[0] ?? null;
                    return { template, latestCompletion, lastDate: latestCompletion?.completion_date ?? null };
                });
                setRawTemplateData(rows);
                setCachedData(cacheKey, { completions: results, rawTemplateData: rows });
            } catch (err: any) {
                console.error('Error loading data:', err);
            } finally {
                setIsLoading(false);
            }
    }, [propertyId, propertyIds, supabase, isAdmin, userRole]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60_000);
        const onVisible = () => { if (document.visibilityState === 'visible') fetchData(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [fetchData]);

    const handleCancelSession = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure?')) return;
        try {
            const { error } = await supabase.from('sop_completions').delete().eq('id', id);
            if (error) throw error;
            setCompletions(prev => prev.filter(c => c.id !== id));
        } catch (err) { alert('Failed.'); }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Delete record?')) return;
        try {
            const { error } = await supabase.from('sop_completions').delete().eq('id', id);
            if (error) throw error;
            setCompletions(prev => prev.filter(c => c.id !== id));
        } catch (err) { alert('Failed.'); }
    };

    const { dueTemplates, upcomingTemplates, missedTemplates, completedToday, doneList, stats } = useMemo(() => {
        const due: any[] = [];
        const upcoming: any[] = [];
        const missed: any[] = [];
        const completed: any[] = [];

        const istRef = isToday ? getISTDateParts(liveNow) : getISTDateParts(new Date(`${selectedDate}T23:59:59+05:30`));
        const refDate = isToday ? liveNow : new Date(`${selectedDate}T23:59:59+05:30`);

        for (const { template, latestCompletion, lastDate } of rawTemplateData) {
            const dueStatus = isDue(
                template.frequency, lastDate,
                template.start_time, template.end_time,
                latestCompletion?.completed_at,
                template.started_at,
                refDate
            );

            const nowMins = istRef.totalMins;
            const [sh, sm] = (template.start_time || '00:00').slice(0, 5).split(':').map(Number);
            const [eh, em] = (template.end_time || '23:59').slice(0, 5).split(':').map(Number);
            const isOvernight = (eh * 60 + em) <= (sh * 60 + sm);

            let currentShiftStart = new Date(`${istRef.isoDate}T${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00+05:30`);
            if (isOvernight && nowMins < (eh * 60 + em)) {
                currentShiftStart = new Date(currentShiftStart.getTime() - 24 * 3600000);
            }
            const actualLogicalDate = getISTDateParts(currentShiftStart).isoDate;

            const isHourly = /^every_\d+_hours?$/.test(template.frequency);
            const currentSlot = computeCurrentSlotStart(template.frequency, template.start_time, refDate, template.end_time);
            
            const slotMatch = (c: any, targetDate: string, targetSlot?: string | null) => {
                if (c.template_id !== template.id) return false;
                if (!isHourly) return c.completion_date === targetDate;
                return c.completion_date === targetDate && (c.slot_time || '').startsWith(targetSlot || '00:00');
            };

            const slotCompleted = completions.find((c: any) => c.status === 'completed' && slotMatch(c, actualLogicalDate, currentSlot));
            const inProgress = isToday ? completions.find((c: any) => c.status === 'in_progress' && slotMatch(c, actualLogicalDate, currentSlot)) : null;

            const templateWithMeta = { 
                ...template, 
                dueLabel: dueStatus.label, 
                inProgressId: inProgress?.id || null, 
                slotCompletedId: slotCompleted?.id || null,
                currentSlot: currentSlot
            };

            if (slotCompleted) {
                completed.push({ 
                    ...templateWithMeta, 
                    dueStatus: (slotCompleted.is_late) ? 'late' : 'on-time',
                    completedAt: slotCompleted.completed_at,
                    is_late: slotCompleted.is_late
                });
            } else if (isToday && (inProgress || (template.is_running && dueStatus.status === 'due'))) {
                due.push(templateWithMeta);
            } else if (isToday && template.is_running && dueStatus.status === 'upcoming') {
                upcoming.push({ ...templateWithMeta, upcomingLabel: dueStatus.label, progressPct: 0 });
            } else if (actualLogicalDate === selectedDate) {
                if (!isHourly && (template.is_running || inProgress)) {
                    missed.push({ ...templateWithMeta, historicalDate: actualLogicalDate });
                }
            }
        }

        const historicalMissed: any[] = [];
        if (isToday) {
            for (const { template } of rawTemplateData) {
                // Include daily, weekly, AND hourly templates
                const isHourlyTemplate = /^every_\d+_hours?$/.test(template.frequency);
                const isWeeklyTemplate = template.frequency === 'weekly';
                if (!isHourlyTemplate && !isWeeklyTemplate && template.frequency !== 'daily') continue;

                // For weekly, check past 4 weeks; for hourly check 3 days; for daily check 7 days
                const daysToCheck = isHourlyTemplate ? 3 : (isWeeklyTemplate ? 28 : 7);
                if (!template.start_time || !template.end_time || !template.is_running) continue;

                const [sh, sm] = template.start_time.split(':').map(Number);
                const [eh, em] = template.end_time.split(':').map(Number);
                const isOvernight = (eh * 60 + em) <= (sh * 60 + sm);

                // For hourly templates, check each slot in each past day
                const intervalHours = parseHourlyInterval(template.frequency);

                let currentShiftStart = new Date(`${istRef.isoDate}T${template.start_time.slice(0, 5)}:00+05:30`);
                if (isOvernight && istRef.totalMins < (eh * 60 + em)) {
                    currentShiftStart = new Date(currentShiftStart.getTime() - 24 * 3600000);
                }
                
                const templateStartedAt = template.started_at ? new Date(template.started_at) : null;

                for (let i = 0; i <= daysToCheck; i++) {
                    // For weekly, only check the same day of week
                    if (isWeeklyTemplate) {
                        const pastDayOfWeek = new Date(new Date(currentShiftStart).getTime() - i * 24 * 3600000).getDay();
                        const currentDayOfWeek = new Date(currentShiftStart).getDay();
                        // Only check if we're looking at the same day of week
                        if (pastDayOfWeek !== currentDayOfWeek) continue;
                    }

                    const pastShiftStart = new Date(currentShiftStart.getTime() - i * 24 * 3600000);
                    const pastIst = getISTDateParts(pastShiftStart);
                    const pastLogicalDate = pastIst.isoDate;

                    let pastShiftEnd = new Date(`${pastLogicalDate}T${template.end_time.slice(0,5)}:00+05:30`);
                    if (isOvernight) pastShiftEnd.setDate(pastShiftEnd.getDate() + 1);
                    if (liveNow < pastShiftEnd) continue;

                    // For hourly templates, check each slot in the shift
                    if (isHourlyTemplate && intervalHours) {
                        const windowDurationMins = isOvernight ? (1440 - sh * 60 - sm + eh * 60 + em) : ((eh * 60 + em) - (sh * 60 + sm));
                        const numSlots = Math.floor(windowDurationMins / (intervalHours * 60));

                        for (let slot = 0; slot < numSlots; slot++) {
                            const slotStart = new Date(pastShiftStart.getTime() + slot * intervalHours * 60 * 60 * 1000);
                            const slotEnd = new Date(slotStart.getTime() + intervalHours * 60 * 60 * 1000);

                            // Skip future slots or slots before the template started
                            if (slotEnd > liveNow) continue;
                            if (templateStartedAt && slotStart < templateStartedAt) continue;

                            const slotTime = slotStart.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
                            const slotDate = pastIst.isoDate;

                            const anyRecord = completions.find(c =>
                                c.template_id === template.id &&
                                c.completion_date === slotDate &&
                                c.status === 'completed'
                            );

                            // Also check for partial completion (in_progress)
                            const partialRecord = completions.find(c =>
                                c.template_id === template.id &&
                                c.completion_date === slotDate &&
                                c.slot_time === slotTime
                            );

                            const isMissed = !anyRecord && (!partialRecord || partialRecord.status !== 'completed');

                            if (isMissed) {
                                historicalMissed.push({
                                    ...template,
                                    dueLabel: `Missed`,
                                    historicalDate: slotDate,
                                    slotTime: slotTime,
                                    isHistorical: true
                                });
                            }
                        }
                    } else {
                        // Daily/weekly template logic
                        if (templateStartedAt && pastShiftStart < templateStartedAt) continue;

                        const anyRecord = completions.find(c => c.template_id === template.id && c.completion_date === pastLogicalDate);
                        const isMissed = !anyRecord || anyRecord.status === 'missed' || anyRecord.status === 'pending';

                        if (isMissed) {
                            const timeAgo = i === 1 ? 'Yesterday' : i === 0 ? 'Today' : `${i}d ago`;
                            historicalMissed.push({
                                ...template,
                                dueLabel: `Missed (${timeAgo})`,
                                historicalDate: pastLogicalDate,
                                isHistorical: true
                            });
                        }
                    }
                }
            }
        }

        // Sort arrays
        missed.sort((a, b) => (b.historicalDate || '').localeCompare(a.historicalDate || ''));
        due.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

        const doneList = completions.filter(c => {
            if (c.status !== 'completed') return false;
            if (isAllTime) return true;
            return c.completion_date === selectedDate;
        });
        
        let allMissed = [...missed, ...historicalMissed];
        if (!isAllTime) {
            allMissed = allMissed.filter(m => m.historicalDate === selectedDate);
        }

        const totalForDay = completed.length + due.length + allMissed.length;
        const totalAllTime = completed.length + due.length + missed.length + historicalMissed.length;

        return {
            dueTemplates: due,
            upcomingTemplates: upcoming,
            missedTemplates: allMissed,
            completedToday: completed,
            doneList,
            stats: {
                total: isAllTime ? totalAllTime : totalForDay,
                completed: doneList.length,
                pending: due.length,
                due: due.length,
                missed: allMissed.length,
                historicalMissed: historicalMissed.length
            }
        };
    }, [rawTemplateData, completions, liveNow, selectedDate, isAllTime, searchQuery]);

    if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-3xl" />)}</div>;

    return (
        <div className="space-y-4">

            <div className="flex items-center gap-3 px-1 mb-2">
                <div className="flex-1 bg-slate-50 p-1 rounded-2xl border border-slate-200 flex items-center gap-2 px-3">
                    <Calendar size={14} className="text-slate-400" />
                    <input
                        type="date"
                        disabled={isAllTime}
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className={`bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-slate-600 focus:outline-none w-full ${isAllTime ? 'opacity-30' : ''}`}
                    />
                </div>
                <div 
                    onClick={() => setIsAllTime(!isAllTime)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border transition-all cursor-pointer select-none
                        ${isAllTime ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                >
                    <div className={`w-3 h-3 rounded-full ${isAllTime ? 'bg-emerald-400' : 'bg-slate-200'} transition-all`} />
                    <span className="text-[10px] font-black uppercase tracking-widest">All Time</span>
                </div>
                {!isToday && !isAllTime && (
                    <button onClick={() => setSelectedDate(todayIST)} className="p-2 bg-slate-900 text-white rounded-xl"><History size={14} /></button>
                )}
            </div>

            {/* Search Bar */}
            <div className="px-4 pb-3">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search checklists..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-8 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-center py-2">
                <div className="bg-slate-50 p-0.5 rounded-xl border border-slate-200 flex items-center gap-0.5 w-full">
                    <button onClick={() => { setActiveFilter('all'); onFilterChange?.('all'); }} className={`flex-1 py-2 rounded-lg font-black text-[9px] uppercase ${activeFilter === 'all' ? 'bg-white text-slate-900' : 'text-slate-400'}`}>All</button>
                    <button onClick={() => { setActiveFilter('due'); onFilterChange?.('due'); }} className={`flex-1 py-2 rounded-lg font-black text-[9px] uppercase ${activeFilter === 'due' ? 'bg-amber-500 text-white' : 'text-slate-400'}`}>Due {dueTemplates.length > 0 && `(${dueTemplates.length})`}</button>
                    <button onClick={() => { setActiveFilter('missed'); onFilterChange?.('missed'); }} className={`flex-1 py-2 rounded-lg font-black text-[9px] uppercase ${activeFilter === 'missed' ? 'bg-rose-500 text-white' : 'text-slate-400'}`}>Missed {stats.missed > 0 && `(${stats.missed})`}</button>
                    <button onClick={() => { setActiveFilter('completed'); onFilterChange?.('completed'); }} className={`flex-1 py-2 rounded-lg font-black text-[9px] uppercase ${activeFilter === 'completed' ? 'bg-emerald-500 text-white' : 'text-slate-400'}`}>Done {stats.completed > 0 && `(${stats.completed})`}</button>
                </div>
            </div>

            <AnimatePresence mode="wait">
                <motion.div
                    key={activeFilter}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                >
                    {(activeFilter === 'all' || activeFilter === 'due') && filterBySearch(dueTemplates).length > 0 && (
                        <div className="space-y-2 mb-6">
                            <h3 className="text-[9px] font-black text-rose-500 uppercase tracking-widest">Due Checklists</h3>
                    {filterBySearch(dueTemplates).map(t => (
                        <div key={`due-${t.id}`} onClick={() => onSelectTemplate(t.id, t.property_id, t.inProgressId || undefined, t.historicalDate)} className="bg-white border border-rose-100 rounded-[2rem] p-4 flex items-center gap-4">
                            <div className="w-11 h-11 rounded-2xl bg-rose-50 flex items-center justify-center"><AlertTriangle size={18} className="text-rose-500" /></div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-black text-[15px] line-clamp-2" title={t.title}>{t.title}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="px-2 py-0.5 bg-rose-500 text-white text-[8px] font-black rounded-full">{t.dueLabel}</span>
                                    {t.currentSlot && (
                                        <span className="px-2 py-0.5 bg-rose-50 text-rose-400 text-[8px] font-bold rounded-full border border-rose-100 flex items-center gap-1">
                                            <Clock size={8} /> 
                                            {(() => {
                                                if (t.frequency?.includes('every_')) {
                                                    const slotStr = getCompletionSlot(null, t.frequency, t.start_time, t.currentSlot);
                                                    if (slotStr) {
                                                        const [start, end] = slotStr.split(' – ');
                                                        return `${fmt12h(start)} - ${fmt12h(end)}`;
                                                    }
                                                }
                                                return fmt12h(t.currentSlot);
                                            })()}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="bg-slate-900 text-white p-2.5 rounded-xl"><Play size={14} fill="currentColor" /></div>
                        </div>
                    ))}
                </div>
            )}

            {(activeFilter === 'all' || activeFilter === 'missed') && filterBySearch(missedTemplates).length > 0 && (
                <div className="space-y-6">
                    <h3 className="text-[9px] font-black text-rose-500 uppercase tracking-widest px-1">Missed Shifts</h3>
                    {(() => {
                        const groups: Record<string, any[]> = {};
                        filterBySearch(missedTemplates).forEach(t => {
                            const d = t.historicalDate || 'Today';
                            if (!groups[d]) groups[d] = [];
                            groups[d].push(t);
                        });
                        const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
                        
                        return sortedDates.map(date => (
                            <div key={`missed-group-${date}`} className="space-y-3">
                                <div className="flex items-center gap-2 px-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{date === todayIST ? 'Today' : date}</span>
                                    <div className="h-px flex-1 bg-slate-100" />
                                </div>
                                {groups[date].map(t => (
                                    <div 
                                        key={`missed-${t.id}-${t.historicalDate}`} 
                                        onClick={() => onSelectTemplate(t.id, t.property_id, t.inProgressId || undefined, t.historicalDate)} 
                                        className="bg-white border border-rose-100 rounded-[2rem] p-4 flex items-center gap-4 hover:shadow-md transition-all cursor-pointer group"
                                    >
                                        <div className="w-11 h-11 rounded-2xl bg-rose-50 flex items-center justify-center group-hover:bg-rose-100 transition-colors">
                                            <XCircle size={18} className="text-rose-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-black text-[15px] line-clamp-2 text-slate-900 group-hover:text-rose-600 transition-colors" title={t.title}>{t.title}</h4>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <span className="px-2 py-0.5 bg-rose-100 text-rose-600 text-[8px] font-black rounded-full uppercase tracking-tight">
                                                    {t.dueLabel || 'Missed'}
                                                </span>
                                                {t.slotTime && (
                                                    <span className="px-2 py-0.5 bg-rose-50 text-rose-400 text-[8px] font-bold rounded-full border border-rose-100 flex items-center gap-1">
                                                        <Clock size={8} /> 
                                                        {(() => {
                                                            if (t.frequency?.includes('every_')) {
                                                                const slotStr = getCompletionSlot(null, t.frequency, t.start_time, t.slotTime);
                                                                if (slotStr) {
                                                                    const [start, end] = slotStr.split(' – ');
                                                                    return `${fmt12h(start)} - ${fmt12h(end)}`;
                                                                }
                                                            }
                                                            return fmt12h(t.slotTime);
                                                        })()}
                                                    </span>
                                                )}
                                                {!t.slotTime && t.start_time && (
                                                    <>
                                                        <div className="w-1 h-1 rounded-full bg-slate-200" />
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">
                                                            {fmt12h(t.start_time)}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="bg-rose-500 text-white p-2.5 rounded-xl group-hover:bg-rose-600 transition-colors shadow-lg shadow-rose-200">
                                            <Play size={14} fill="currentColor" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ));
                    })()}
                </div>
            )}

            {(activeFilter === 'all' || activeFilter === 'completed') && filterBySearch(activeFilter === 'all' ? completedToday : doneList).length > 0 && (
                <div className="space-y-6">
                    <h3 className="text-[9px] font-black text-emerald-500 uppercase tracking-widest px-1">
                        {activeFilter === 'all' ? 'Completed Today' : 'Completed Checklists'}
                    </h3>
                    {(() => {
                        const items = activeFilter === 'all' 
                            ? completedToday.map(t => ({
                                id: t.slotCompletedId || t.id,
                                template_id: t.id,
                                property_id: t.property_id,
                                is_late: t.is_late,
                                completed_at: t.completedAt,
                                completion_date: todayIST,
                                slot_time: t.currentSlot,
                                template: t,
                                user: null
                            }))
                            : doneList;
                            
                        const itemsToRender = filterBySearch(items);
                        const groups: Record<string, any[]> = {};
                        itemsToRender.forEach(c => {
                            const d = c.completion_date || 'Unknown';
                            if (!groups[d]) groups[d] = [];
                            groups[d].push(c);
                        });
                        const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

                        return sortedDates.map(date => (
                            <div key={`done-group-${date}`} className="space-y-3">
                                <div className="flex items-center gap-2 px-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{date === todayIST ? 'Today' : date}</span>
                                    <div className="h-px flex-1 bg-slate-100" />
                                </div>
                                {groups[date].map(c => {
                                    const template = c.template || {};
                                    const time = c.completed_at ? new Date(c.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                    
                                    return (
                                        <div 
                                            key={`completed-${c.id}`} 
                                            onClick={() => onViewDetail(c.id, c.template_id, c.property_id)}
                                            className={`bg-white border rounded-2xl p-4 flex items-center gap-4 hover:shadow-md transition-all cursor-pointer group ${c.is_late ? 'border-amber-100' : 'border-emerald-100'}`}
                                        >
                                            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${c.is_late ? 'bg-amber-50 group-hover:bg-amber-100' : 'bg-emerald-50 group-hover:bg-emerald-100'}`}>
                                                <CheckCircle2 size={18} className={c.is_late ? 'text-amber-500' : 'text-emerald-500'} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className={`font-black text-[15px] line-clamp-2 transition-colors flex items-center gap-2 ${c.is_late ? 'text-slate-900 group-hover:text-amber-600' : 'text-slate-900 group-hover:text-emerald-600'}`} title={template.title || 'Untitled Checklist'}>
                                                    {template.title || 'Untitled Checklist'}
                                                    {c.is_late && (
                                                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[8px] font-black rounded-full uppercase tracking-tight">Late</span>
                                                    )}
                                                </h4>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {c.slot_time && (
                                                        <>
                                                            <div className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-tight ${c.is_late ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100'}`}>
                                                                {(() => {
                                                                    if (template.frequency?.includes('every_')) {
                                                                        const slotStr = getCompletionSlot(null, template.frequency, template.start_time, c.slot_time);
                                                                        if (slotStr) {
                                                                            const [start, end] = slotStr.split(' – ');
                                                                            return `${fmt12h(start)} - ${fmt12h(end)}`;
                                                                        }
                                                                    }
                                                                    return fmt12h(c.slot_time);
                                                                })()}
                                                            </div>
                                                            <div className="w-1 h-1 rounded-full bg-slate-200" />
                                                        </>
                                                    )}
                                                    <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-tight" title="Completed At">
                                                        <Clock size={10} />
                                                        {time}
                                                    </div>
                                                    <div className="w-1 h-1 rounded-full bg-slate-200" />
                                                    <div className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-tight ${c.is_late ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                        <User size={10} />
                                                        {(() => {
                                                            const userData = Array.isArray(c.user) ? c.user[0] : c.user;
                                                            return userData?.full_name?.split(' ')[0] || 'Staff';
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={`text-slate-300 transition-all transform translate-x-0 group-hover:translate-x-1 ${c.is_late ? 'group-hover:text-amber-500' : 'group-hover:text-emerald-500'}`}>
                                                <ChevronRight size={18} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ));
                    })()}
                </div>
            )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
};

export default SOPCompletionHistory;
