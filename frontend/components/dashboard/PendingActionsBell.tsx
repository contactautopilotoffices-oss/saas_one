'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ClipboardList, CheckCircle2, XCircle, Eye, MessageSquareReply, Zap, CreditCard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';

interface PendingAction {
    id: string;
    domain: string;
    entity_type: string;
    entity_id: string;
    title: string;
    description: string;
    actions: string[];
    deep_link: string;
    created_at: string;
}

interface PendingActionsBellProps {
    align?: 'left' | 'right';
}

const ACTION_LABELS: Record<string, string> = {
    respond: 'Respond',
    view: 'View',
    approve: 'Approve',
    reject: 'Reject',
};

export default function PendingActionsBell({ align = 'right' }: PendingActionsBellProps) {
    const [actions, setActions] = useState<PendingAction[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [actingId, setActingId] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const supabase = useMemo(() => createClient(), []);
    const router = useRouter();

    const fetchActions = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/pending-actions');
            if (res.ok) {
                const data = await res.json();
                setActions(data.actions || []);
            }
        } catch (err) {
            console.error('Failed to load pending actions:', err);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            await fetchActions();

            const { data: { user } } = await supabase.auth.getUser();
            if (!isMounted || !user) return;

            // Realtime on the pending_actions table (RLS: recipient_id = auth.uid()).
            const channel = supabase
                .channel(`pending-actions-bell-${user.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'pending_actions',
                        filter: `recipient_id=eq.${user.id}`
                    },
                    () => {
                        // Simplest correct behaviour: refetch the open set on any change.
                        fetchActions();
                    }
                )
                .subscribe();

            channelRef.current = channel;
        };

        init();

        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            isMounted = false;
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [fetchActions, supabase]);

    const removeAction = (id: string) => {
        setActions(prev => prev.filter(a => a.id !== id));
    };

    const handleAction = async (item: PendingAction, action: string) => {
        setIsOpen(false);

        // 'view' just navigates — the row stays open until acted on at the destination.
        if (action === 'view') {
            if (item.deep_link) router.push(item.deep_link);
            return;
        }

        setActingId(item.id);
        try {
            await fetch('/api/pending-actions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, status: 'done', action }),
            });
            removeAction(item.id);
        } catch (err) {
            console.error('Failed to act on pending action:', err);
        } finally {
            setActingId(null);
        }
        if (item.deep_link) router.push(item.deep_link);
    };

    const handleDismiss = async (item: PendingAction) => {
        setActingId(item.id);
        try {
            await fetch('/api/pending-actions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, status: 'dismissed' }),
            });
            removeAction(item.id);
        } catch (err) {
            console.error('Failed to dismiss pending action:', err);
        } finally {
            setActingId(null);
        }
    };

    const parseUTCDate = (dateStr: string): Date => {
        if (dateStr && !dateStr.endsWith('Z') && !dateStr.includes('+')) {
            return new Date(dateStr + 'Z');
        }
        return new Date(dateStr);
    };

    const getDomainIcon = (domain: string) => {
        switch (domain) {
            case 'electricity_dispute': return <Zap className="w-4 h-4" />;
            case 'electricity_payment': return <CreditCard className="w-4 h-4" />;
            default: return <ClipboardList className="w-4 h-4" />;
        }
    };

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'approve': return <CheckCircle2 className="w-3.5 h-3.5" />;
            case 'reject': return <XCircle className="w-3.5 h-3.5" />;
            case 'respond': return <MessageSquareReply className="w-3.5 h-3.5" />;
            default: return <Eye className="w-3.5 h-3.5" />;
        }
    };

    const getActionClasses = (action: string) => {
        switch (action) {
            case 'approve': return 'bg-emerald-600 text-white hover:bg-emerald-700';
            case 'reject': return 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100';
            default: return 'bg-slate-900 text-white hover:bg-slate-800';
        }
    };

    const openCount = actions.length;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 text-slate-600 hover:text-primary transition-all group flex items-center justify-center min-w-[44px] min-h-[44px]"
                title="Pending actions"
            >
                <ClipboardList className="w-5 h-5" />
                {openCount > 0 && (
                    <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 border-2 border-white shadow-sm text-[9px] font-black text-white">
                        {openCount > 99 ? '99+' : openCount}
                    </span>
                )}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className={`fixed top-20 left-4 right-4 sm:absolute sm:top-full sm:mt-2 bg-white border border-gray-100 rounded-2xl shadow-2xl z-[100] overflow-hidden bg-white/95 backdrop-blur-sm ring-1 ring-black/5 
                        ${align === 'left' ? 'sm:left-0 sm:right-auto origin-top-left' : 'sm:right-0 sm:left-auto origin-top-right'} sm:w-96`}
                    >
                        <div className="p-5 border-b border-gray-100 bg-white/95 backdrop-blur-sm sticky top-0 z-10 flex justify-between items-center">
                            <h3 className="text-[15px] font-semibold text-gray-900 tracking-tight">Pending Actions</h3>
                            {openCount > 0 && (
                                <span className="text-[12px] font-bold text-gray-400">{openCount} open</span>
                            )}
                        </div>

                        <div className="max-h-[60vh] sm:max-h-[500px] overflow-y-auto overscroll-contain bg-white">
                            {isLoading && actions.length === 0 ? (
                                <div className="p-8 text-center text-[11px] font-medium text-text-tertiary">Loading pending actions...</div>
                            ) : actions.length === 0 ? (
                                <div className="p-12 text-center flex flex-col items-center gap-3">
                                    <div className="w-12 h-12 bg-surface-elevated rounded-full flex items-center justify-center text-text-tertiary/20">
                                        <ClipboardList className="w-6 h-6" />
                                    </div>
                                    <p className="text-[11px] font-medium text-text-tertiary">Nothing needs your attention</p>
                                </div>
                            ) : (
                                actions.map((item) => (
                                    <div
                                        key={item.id}
                                        className="p-5 border-b border-gray-50 hover:bg-gray-50 transition-all relative"
                                    >
                                        <div className="flex gap-4 items-start">
                                            <div className="mt-0.5 w-9 h-9 rounded-full flex items-center justify-center shrink-0 border bg-primary/10 border-primary/10 text-primary">
                                                {getDomainIcon(item.domain)}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h4 className="text-[15px] font-semibold leading-snug mb-1 text-gray-900">
                                                    {item.title}
                                                </h4>
                                                {item.description && (
                                                    <p className="text-[13px] text-gray-500 line-clamp-2 leading-relaxed">
                                                        {item.description}
                                                    </p>
                                                )}
                                                <p className="text-[12px] font-medium text-gray-400 mt-2">
                                                    {formatDistanceToNow(parseUTCDate(item.created_at), { addSuffix: true })}
                                                </p>

                                                <div className="flex flex-wrap items-center gap-2 mt-3">
                                                    {(item.actions || []).map((action) => (
                                                        <button
                                                            key={action}
                                                            disabled={actingId === item.id}
                                                            onClick={() => handleAction(item, action)}
                                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors disabled:opacity-50 ${getActionClasses(action)}`}
                                                        >
                                                            {getActionIcon(action)}
                                                            {ACTION_LABELS[action] || action}
                                                        </button>
                                                    ))}
                                                    <button
                                                        disabled={actingId === item.id}
                                                        onClick={() => handleDismiss(item)}
                                                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
