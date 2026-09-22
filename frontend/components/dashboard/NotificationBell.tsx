'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Bell, CheckCircle2, AlertCircle, Clock, Info, X, ShieldAlert,
    ArrowRight, CheckCircle, FileText, Check, Zap, CreditCard,
    ClipboardList, MessageSquareReply, XCircle, RefreshCw, ChevronRight,
    Sparkles, ExternalLink, ShieldCheck, AlertTriangle, Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';

interface Notification {
    id: string;
    notification_type: string;
    title: string;
    message: string;
    deep_link?: string;
    ticket_id?: string;
    is_read: boolean;
    created_at: string;
}

interface PendingActionItem {
    id: string;
    source: 'hr_ticket' | 'system_action';
    title: string;
    subtitle?: string;
    description?: string;
    badgeLabel: string;
    badgeVariant: 'amber' | 'purple' | 'blue' | 'rose' | 'emerald';
    level?: number;
    ticketNumber?: string;
    ticketType?: string;
    isAnonymous?: boolean;
    created_at: string;
    deepLink: string;
    actions: {
        label: string;
        actionKey: string;
        variant: 'primary' | 'success' | 'danger' | 'outline';
        isQuickAction?: boolean;
    }[];
    rawTicket?: any;
    rawAction?: any;
}

interface NotificationBellProps {
    align?: 'left' | 'right';
}

export default function NotificationBell({ align = 'right' }: NotificationBellProps) {
    const [activeTab, setActiveTab] = useState<'notifications' | 'pending_actions'>('notifications');
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [pendingActions, setPendingActions] = useState<PendingActionItem[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [actingItemId, setActingItemId] = useState<string | null>(null);

    // Inline close ticket state
    const [closingTicketId, setClosingTicketId] = useState<string | null>(null);
    const [closingResolutionNote, setClosingResolutionNote] = useState<string>('');

    const dropdownRef = useRef<HTMLDivElement>(null);
    const channelsRef = useRef<any[]>([]);
    const supabase = useMemo(() => createClient(), []);
    const router = useRouter();
    const params = useParams();
    const { user, membership } = useAuth();

    // Resolve current orgId for deep links
    const currentOrgId = useMemo(() => {
        return (params?.orgId as string) || membership?.org_id || '';
    }, [params, membership]);

    const fetchNotificationsAndActions = useCallback(async () => {
        setIsLoading(true);
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const activeUserId = authUser?.id || user?.id;
        if (!activeUserId) {
            setIsLoading(false);
            return;
        }

        try {
            // 1. Fetch general notifications from notifications table
            const { data: notifData } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', activeUserId)
                .order('created_at', { ascending: false })
                .limit(30);

            let allNotifications: Notification[] = notifData || [];

            // 1b. Fetch recent comments and internal notes on HR tickets
            try {
                const { data: recentComments } = await supabase
                    .from('hr_ticket_comments')
                    .select(`
                        id, ticket_id, sender_user_id, sender_name, content, is_internal, created_at,
                        ticket:hr_tickets(id, ticket_number, subject, organization_id, raised_by_user_id, assigned_to_user_id, current_level)
                    `)
                    .neq('sender_user_id', activeUserId)
                    .order('created_at', { ascending: false })
                    .limit(25);

                if (recentComments && recentComments.length > 0) {
                    const rawRole = (user?.user_metadata?.role || membership?.org_role || '').toLowerCase();
                    const isHrUser = ['hr', 'hr_head', 'hr_manager', 'org_admin', 'org_super_admin', 'director'].includes(rawRole);

                    const commentNotifs: Notification[] = [];
                    recentComments.forEach(c => {
                        const ticket = c.ticket as any;
                        if (!ticket) return;

                        // Internal notes: only visible to HR or the assigned handler
                        if (c.is_internal) {
                            const canSeeInternal = isHrUser || ticket.assigned_to_user_id === activeUserId;
                            if (!canSeeInternal) return;
                        } else {
                            // Public comments: visible to submitter, assignee, and HR
                            const canSeePublic = isHrUser || ticket.assigned_to_user_id === activeUserId || ticket.raised_by_user_id === activeUserId;
                            if (!canSeePublic) return;
                        }

                        // Avoid duplicate if notification already exists for this ticket comment
                        const isAlreadyInNotifs = allNotifications.some(n =>
                            n.ticket_id === c.ticket_id &&
                            Math.abs(new Date(n.created_at).getTime() - new Date(c.created_at).getTime()) < 3000
                        );

                        if (!isAlreadyInNotifs) {
                            const isInternal = Boolean(c.is_internal);
                            const tNum = ticket.ticket_number || '';
                            const snippet = c.content.length > 70 ? c.content.substring(0, 70) + '...' : c.content;
                            const targetOrgId = ticket.organization_id || currentOrgId;
                            const deepLink = targetOrgId
                                ? `/${targetOrgId}/hr-tickets?ticketId=${c.ticket_id}`
                                : `/hr-tickets?ticketId=${c.ticket_id}`;

                            commentNotifs.push({
                                id: `comment-${c.id}`,
                                notification_type: isInternal ? 'HR_TICKET_INTERNAL_NOTE' : 'HR_TICKET_COMMENT_ADDED',
                                title: isInternal ? `🔒 Internal Note: #${tNum}` : `💬 Reply on #${tNum}`,
                                message: `${c.sender_name || 'Staff'}: "${snippet}"`,
                                deep_link: deepLink,
                                ticket_id: c.ticket_id,
                                is_read: false,
                                created_at: c.created_at
                            });
                        }
                    });

                    // Merge and sort newest first
                    allNotifications = [...allNotifications, ...commentNotifs].sort(
                        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    );
                }
            } catch (err) {
                console.warn('Error fetching recent comments for notifications:', err);
            }

            setNotifications(allNotifications);
            setUnreadCount(allNotifications.filter(n => !n.is_read).length);
        } catch (e) {
            console.warn('Error fetching notifications:', e);
        }

        const consolidatedActions: PendingActionItem[] = [];

        // 2. Fetch HR Tickets requiring user attention
        try {
            const { data: actionTickets } = await supabase
                .from('hr_tickets')
                .select(`
                    id, ticket_number, ticket_type, subject, status, current_level, priority, created_at,
                    raised_by_user_id, assigned_to_user_id, is_anonymous, employee_snapshot
                `)
                .or(`assigned_to_user_id.eq.${activeUserId},and(raised_by_user_id.eq.${activeUserId},status.eq.pending_acknowledgement)`)
                .not('status', 'in', '("closed","resolved")')
                .order('created_at', { ascending: false })
                .limit(25);

            if (actionTickets) {
                actionTickets.forEach((t) => {
                    const isSubmitterWaitingAck = Boolean(activeUserId && t.raised_by_user_id === activeUserId && t.status === 'pending_acknowledgement');
                    const isAssignedToUser = Boolean(activeUserId && t.assigned_to_user_id === activeUserId);

                    let badgeVariant: 'amber' | 'purple' | 'blue' | 'rose' | 'emerald' = 'blue';
                    let statusLabel = t.status ? t.status.replace(/_/g, ' ') : 'Pending';

                    if (isSubmitterWaitingAck) {
                        badgeVariant = 'amber';
                        statusLabel = 'Awaiting Your Ack';
                    } else if (t.status === 'escalated') {
                        badgeVariant = 'purple';
                        statusLabel = `Escalated (L${t.current_level || 2})`;
                    } else if (t.priority === 'urgent' || t.priority === 'high') {
                        badgeVariant = 'rose';
                        statusLabel = `${t.priority?.toUpperCase()} • L${t.current_level || 1}`;
                    } else {
                        statusLabel = `L${t.current_level || 1} • ${statusLabel}`;
                    }

                    const submitterName = t.is_anonymous
                        ? '🔒 Confidential / Anonymous'
                        : (t.employee_snapshot?.name || 'Employee');

                    const actionButtons: PendingActionItem['actions'] = [];

                    // Submitter acknowledgement button
                    if (isSubmitterWaitingAck) {
                        actionButtons.push({
                            label: 'Acknowledge Resolution',
                            actionKey: 'acknowledge_resolution',
                            variant: 'success',
                            isQuickAction: true
                        });
                    }

                    // STRICT PERMISSION: ONLY if ticket is strictly assigned to this user and active, show "Close Ticket"
                    const canCloseTicket = isAssignedToUser && t.status !== 'closed' && t.status !== 'resolved' && t.status !== 'pending_acknowledgement';

                    if (canCloseTicket) {
                        actionButtons.push({
                            label: 'Close Ticket',
                            actionKey: 'open_close_form',
                            variant: 'success',
                            isQuickAction: true
                        });
                    }

                    // Direct View Ticket button (always available)
                    actionButtons.push({
                        label: 'View Ticket',
                        actionKey: 'view_ticket',
                        variant: 'primary',
                        isQuickAction: false
                    });

                    const hrTicketsUrl = currentOrgId
                        ? `/${currentOrgId}/hr-tickets?ticketId=${t.id}`
                        : `/hr-tickets?ticketId=${t.id}`;

                    consolidatedActions.push({
                        id: `hr-${t.id}`,
                        source: 'hr_ticket',
                        title: t.subject || 'HR Request / Grievance',
                        subtitle: `Submitter: ${submitterName}`,
                        badgeLabel: statusLabel,
                        badgeVariant,
                        level: t.current_level || 1,
                        ticketNumber: t.ticket_number,
                        ticketType: t.ticket_type,
                        isAnonymous: Boolean(t.is_anonymous),
                        created_at: t.created_at,
                        deepLink: hrTicketsUrl,
                        actions: actionButtons,
                        rawTicket: t
                    });
                });
            }
        } catch (e) {
            console.warn('Error fetching action tickets:', e);
        }

        // 3. Fetch System-wide Pending Actions (e.g. disputes, approvals)
        try {
            const res = await fetch('/api/pending-actions');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.actions)) {
                    data.actions.forEach((act: any) => {
                        const actionButtons: PendingActionItem['actions'] = (act.actions || ['view']).map((a: string) => {
                            if (a === 'approve') return { label: 'Approve', actionKey: 'approve', variant: 'success', isQuickAction: true };
                            if (a === 'reject') return { label: 'Reject', actionKey: 'reject', variant: 'danger', isQuickAction: true };
                            if (a === 'respond') return { label: 'Respond', actionKey: 'respond', variant: 'primary', isQuickAction: false };
                            return { label: 'View', actionKey: 'view', variant: 'primary', isQuickAction: false };
                        });

                        consolidatedActions.push({
                            id: `sys-${act.id}`,
                            source: 'system_action',
                            title: act.title || 'Action Required',
                            description: act.description,
                            badgeLabel: act.domain ? act.domain.replace(/_/g, ' ') : 'System Action',
                            badgeVariant: 'amber',
                            created_at: act.created_at,
                            deepLink: act.deep_link || '',
                            actions: actionButtons,
                            rawAction: act
                        });
                    });
                }
            }
        } catch (err) {
            console.warn('Failed to load system pending actions:', err);
        }

        // Sort pending actions newest first
        consolidatedActions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setPendingActions(consolidatedActions);

        setIsLoading(false);
    }, [supabase, currentOrgId, user?.id, membership?.org_role]);

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            await fetchNotificationsAndActions();

            const { data: { user: authUser } } = await supabase.auth.getUser();
            const activeUserId = authUser?.id || user?.id;
            if (!isMounted || !activeUserId) return;

            // Clear previous channels
            channelsRef.current.forEach(c => supabase.removeChannel(c));
            channelsRef.current = [];

            // 1. Subscribe to real-time notification inserts
            const notifChannel = supabase
                .channel(`notif-bell-${activeUserId}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'notifications',
                        filter: `user_id=eq.${activeUserId}`
                    },
                    (payload) => {
                        setNotifications((prev) => [payload.new as Notification, ...prev]);
                        setUnreadCount((count) => count + 1);
                    }
                )
                .subscribe();
            channelsRef.current.push(notifChannel);

            // 2. Subscribe to HR tickets changes
            const ticketsChannel = supabase
                .channel(`notif-tickets-${activeUserId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'hr_tickets'
                    },
                    () => {
                        fetchNotificationsAndActions();
                    }
                )
                .subscribe();
            channelsRef.current.push(ticketsChannel);

            // 3. Subscribe to pending actions changes
            const pendingChannel = supabase
                .channel(`notif-pending-${activeUserId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'pending_actions',
                        filter: `recipient_id=eq.${activeUserId}`
                    },
                    () => {
                        fetchNotificationsAndActions();
                    }
                )
                .subscribe();
            channelsRef.current.push(pendingChannel);

            // 4. Subscribe to HR ticket comments (public & internal notes)
            const commentsChannel = supabase
                .channel(`notif-comments-${activeUserId}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'hr_ticket_comments'
                    },
                    () => {
                        fetchNotificationsAndActions();
                    }
                )
                .subscribe();
            channelsRef.current.push(commentsChannel);
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
            channelsRef.current.forEach(c => supabase.removeChannel(c));
            channelsRef.current = [];
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [fetchNotificationsAndActions, supabase, user?.id]);

    const markAsRead = async (id: string) => {
        if (!id.startsWith('comment-')) {
            try {
                await supabase
                    .from('notifications')
                    .update({ is_read: true })
                    .eq('id', id);
            } catch (err) {
                console.warn('Error marking notification read in DB:', err);
            }
        }
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        setUnreadCount(count => Math.max(0, count - 1));
    };

    const markAllAsRead = async () => {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const activeUserId = authUser?.id || user?.id;
        if (activeUserId) {
            try {
                await supabase
                    .from('notifications')
                    .update({ is_read: true })
                    .eq('user_id', activeUserId)
                    .neq('is_read', true);
            } catch (err) {
                console.warn('Error marking all notifications read in DB:', err);
            }
        }
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
    };

    const handleNotificationClick = (notif: Notification) => {
        setIsOpen(false);
        if (!notif.is_read) {
            markAsRead(notif.id).catch(err => console.error('Failed to mark read:', err));
        }

        if (notif.ticket_id) {
            const ticketUrl = currentOrgId
                ? `/${currentOrgId}/hr-tickets?ticketId=${notif.ticket_id}`
                : `/hr-tickets?ticketId=${notif.ticket_id}`;
            router.push(ticketUrl);
        } else if (notif.deep_link) {
            router.push(notif.deep_link);
        }
    };

    const handleExecuteAction = async (item: PendingActionItem, actionKey: string) => {
        if (actionKey === 'view_ticket' || actionKey === 'view' || actionKey === 'respond') {
            setIsOpen(false);
            if (item.deepLink) {
                router.push(item.deepLink);
            }
            return;
        }

        // Toggle inline close form for assigned tickets
        if (item.source === 'hr_ticket' && actionKey === 'open_close_form') {
            setClosingTicketId(closingTicketId === item.id ? null : item.id);
            setClosingResolutionNote('');
            return;
        }

        setActingItemId(item.id);

        if (item.source === 'hr_ticket' && actionKey === 'acknowledge_resolution') {
            try {
                const ticketId = item.rawTicket?.id;
                const { data: { user: authUser } } = await supabase.auth.getUser();
                const activeUserId = authUser?.id || user?.id;

                const res = await fetch(`/api/hr/tickets/${ticketId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'acknowledge',
                        status: 'closed',
                        actor_user_id: activeUserId,
                        acknowledged_by_user_id: activeUserId,
                        acknowledgement_note: 'Resolution acknowledged by submitter via Action Center.'
                    })
                });

                if (res.ok) {
                    setPendingActions(prev => prev.filter(a => a.id !== item.id));
                }
            } catch (err) {
                console.error('Failed to acknowledge ticket:', err);
            } finally {
                setActingItemId(null);
            }
            return;
        }

        if (item.source === 'system_action') {
            try {
                const actionId = item.rawAction?.id;
                const res = await fetch('/api/pending-actions', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: actionId,
                        status: 'done',
                        action: actionKey
                    })
                });

                if (res.ok) {
                    setPendingActions(prev => prev.filter(a => a.id !== item.id));
                }
            } catch (err) {
                console.error('Failed to act on system pending action:', err);
            } finally {
                setActingItemId(null);
            }
            if (item.deepLink && actionKey !== 'reject') {
                setIsOpen(false);
                router.push(item.deepLink);
            }
        }
    };

    // Confirm close ticket action directly from inline drawer
    const handleConfirmCloseTicket = async (item: PendingActionItem, note: string) => {
        setActingItemId(item.id);
        try {
            const ticketId = item.rawTicket?.id;
            const { data: { user: authUser } } = await supabase.auth.getUser();
            const activeUserId = authUser?.id || user?.id;

            const res = await fetch(`/api/hr/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'closed',
                    action: 'close',
                    actor_user_id: activeUserId,
                    resolved_by_user_id: activeUserId,
                    resolution_note: note.trim() || 'Resolved and closed by assignee via Action Center'
                })
            });

            if (res.ok) {
                setPendingActions(prev => prev.filter(a => a.id !== item.id));
                setClosingTicketId(null);
                setClosingResolutionNote('');
            }
        } catch (err) {
            console.error('Failed to close ticket:', err);
        } finally {
            setActingItemId(null);
        }
    };

    const parseUTCDate = (dateStr: string): Date => {
        if (!dateStr) return new Date();
        if (!dateStr.endsWith('Z') && !dateStr.includes('+')) {
            return new Date(dateStr + 'Z');
        }
        return new Date(dateStr);
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'HR_TICKET_INTERNAL_NOTE':
                return <Lock className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
            case 'HR_TICKET_COMMENT_ADDED':
                return <MessageSquareReply className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
            case 'TICKET_CREATED':
                return <AlertCircle className="w-4 h-4 text-[#587e85]" />;
            case 'TICKET_ASSIGNED':
                return <Clock className="w-4 h-4 text-amber-500" />;
            case 'TICKET_COMPLETED':
            case 'TICKET_RESOLVED':
                return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
            case 'TICKET_ESCALATED':
                return <ShieldAlert className="w-4 h-4 text-purple-500" />;
            case 'STATUS_UPDATE':
                return <RefreshCw className="w-4 h-4 text-blue-500" />;
            default:
                return <Info className="w-4 h-4 text-slate-400" />;
        }
    };

    const totalBadgeCount = unreadCount + pendingActions.length;
    const hasPendingActions = pendingActions.length > 0;

    return (
        <div className="relative inline-flex items-center" ref={dropdownRef}>
            {/* Header Bell Trigger Button - RED Icon */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer group ${
                    isOpen
                        ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400 ring-2 ring-red-500/20'
                        : 'text-red-500 hover:text-red-600 hover:bg-red-50/80 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30'
                }`}
                title={
                    hasPendingActions
                        ? `${pendingActions.length} Pending Action${pendingActions.length > 1 ? 's' : ''}, ${unreadCount} Unread Notification${unreadCount !== 1 ? 's' : ''}`
                        : `${unreadCount} Unread Notification${unreadCount !== 1 ? 's' : ''}`
                }
                aria-label="Notifications & Pending Actions"
            >
                {/* Bell Icon in Red */}
                <Bell
                    className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-red-500 hover:text-red-600 dark:text-red-400 transition-transform group-hover:scale-110 group-hover:rotate-12"
                />

                {/* Bell Badge */}
                {totalBadgeCount > 0 && (
                    <span
                        className="absolute -top-1 -right-1 flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-black shadow-sm ring-2 ring-white dark:ring-slate-900 bg-red-600 text-white animate-pulse shadow-red-500/30"
                    >
                        {totalBadgeCount > 99 ? '99+' : totalBadgeCount}
                    </span>
                )}
            </button>

            {/* Dropdown Panel */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        className={`fixed top-16 left-3 right-3 sm:absolute sm:top-full sm:mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-[100] overflow-hidden backdrop-blur-md ring-1 ring-black/5 
                        ${align === 'left' ? 'sm:left-0 sm:right-auto origin-top-left' : 'sm:right-0 sm:left-auto origin-top-right'} sm:w-[440px]`}
                    >
                        {/* Header & Tab Selector */}
                        <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/80 sticky top-0 z-10 space-y-2.5">
                            <div className="flex justify-between items-center px-0.5">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center">
                                        <Bell className="w-3.5 h-3.5" />
                                    </div>
                                    <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                        Activity & Action Center
                                    </h3>
                                </div>

                                {activeTab === 'notifications' && unreadCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={markAllAsRead}
                                        className="text-[10.5px] font-bold text-[#587e85] hover:text-[#45656b] dark:text-[#7bb5bd] transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                        <Check className="w-3 h-3" />
                                        <span>Mark all read</span>
                                    </button>
                                )}
                            </div>

                            {/* 2-Section Switcher Tabs */}
                            <div className="grid grid-cols-2 p-1 bg-slate-200/70 dark:bg-slate-950/70 rounded-xl text-xs font-bold gap-1">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('notifications')}
                                    className={`py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                        activeTab === 'notifications'
                                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <span className="text-[11.5px] font-bold">Notifications</span>
                                    {unreadCount > 0 && (
                                        <span className="px-1.5 py-0.2 bg-red-500 text-white text-[9px] font-black rounded-full shadow-2xs">
                                            {unreadCount}
                                        </span>
                                    )}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveTab('pending_actions')}
                                    className={`py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                        activeTab === 'pending_actions'
                                            ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <span className="text-[11.5px] font-bold">Pending Actions</span>
                                    {pendingActions.length > 0 && (
                                        <span className="px-1.5 py-0.2 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center gap-1 shadow-2xs">
                                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                                            {pendingActions.length}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Content Scroll Area */}
                        <div className="max-h-[60vh] sm:max-h-[460px] overflow-y-auto overscroll-contain bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800/80">
                            {isLoading ? (
                                <div className="p-8 text-center flex flex-col items-center gap-2">
                                    <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
                                    <p className="text-xs font-medium text-slate-400">Loading center updates...</p>
                                </div>
                            ) : activeTab === 'notifications' ? (
                                /* SECTION 1: NOTIFICATIONS */
                                notifications.length === 0 ? (
                                    <div className="p-10 text-center flex flex-col items-center gap-2.5">
                                        <div className="w-11 h-11 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400">
                                            <Bell className="w-5 h-5" />
                                        </div>
                                        <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">No new notifications</h4>
                                        <p className="text-[11px] text-slate-400 max-w-xs">
                                            You are up to date with all status updates and alerts.
                                        </p>
                                    </div>
                                ) : (
                                    notifications.map((notif) => (
                                        <div
                                            key={notif.id}
                                            onClick={() => handleNotificationClick(notif)}
                                            className={`p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all relative group flex gap-3 items-start ${
                                                notif.is_read ? 'opacity-85' : 'bg-teal-50/30 dark:bg-teal-950/20'
                                            }`}
                                        >
                                            <div
                                                className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                                                    notif.is_read
                                                        ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                                                        : notif.notification_type === 'HR_TICKET_INTERNAL_NOTE'
                                                        ? 'bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400'
                                                        : notif.notification_type === 'HR_TICKET_COMMENT_ADDED'
                                                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
                                                        : 'bg-[#587e85]/10 border-[#587e85]/20 text-[#587e85]'
                                                }`}
                                            >
                                                {getNotificationIcon(notif.notification_type)}
                                            </div>

                                            <div className="min-w-0 flex-1 pr-4">
                                                <div className="flex items-center justify-between gap-1.5">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <h4
                                                            className={`text-xs font-extrabold leading-snug truncate ${
                                                                notif.is_read
                                                                    ? 'text-slate-700 dark:text-slate-300'
                                                                    : 'text-slate-900 dark:text-white'
                                                            }`}
                                                        >
                                                            {notif.title}
                                                        </h4>
                                                        {notif.notification_type === 'HR_TICKET_INTERNAL_NOTE' && (
                                                            <span className="px-1.5 py-0.2 text-[8.5px] font-black uppercase rounded bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 shrink-0">
                                                                Internal Note
                                                            </span>
                                                        )}
                                                        {notif.notification_type === 'HR_TICKET_COMMENT_ADDED' && (
                                                            <span className="px-1.5 py-0.2 text-[8.5px] font-black uppercase rounded bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 shrink-0">
                                                                Reply
                                                            </span>
                                                        )}
                                                    </div>
                                                    {!notif.is_read && (
                                                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                                    )}
                                                </div>

                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed mt-0.5">
                                                    {notif.message}
                                                </p>

                                                <div className="flex items-center justify-between mt-1.5">
                                                    <span className="text-[10px] font-mono text-slate-400">
                                                        {formatDistanceToNow(parseUTCDate(notif.created_at), { addSuffix: true })}
                                                    </span>
                                                    {!notif.is_read && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                markAsRead(notif.id);
                                                            }}
                                                            className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                                                        >
                                                            Mark read
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )
                            ) : (
                                /* SECTION 2: PENDING ACTIONS */
                                pendingActions.length === 0 ? (
                                    <div className="p-10 text-center flex flex-col items-center gap-2.5">
                                        <div className="w-11 h-11 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl flex items-center justify-center text-emerald-600">
                                            <CheckCircle2 className="w-5 h-5" />
                                        </div>
                                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                            All caught up!
                                        </h4>
                                        <p className="text-[11px] text-slate-400 max-w-xs">
                                            No pending tickets, approvals, or actions require your attention.
                                        </p>
                                    </div>
                                ) : (
                                    pendingActions.map((item) => (
                                        <div
                                            key={item.id}
                                            className="p-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-all space-y-2"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 truncate">
                                                    {item.ticketNumber ? (
                                                        <span className="px-2 py-0.5 bg-[#587e85]/10 text-[#587e85] dark:text-[#7cb3bc] border border-[#587e85]/20 text-[10px] font-mono font-black rounded-md">
                                                            #{item.ticketNumber}
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-bold rounded-md">
                                                            {item.badgeLabel}
                                                        </span>
                                                    )}
                                                </div>

                                                <span
                                                    className={`px-2 py-0.5 text-[9px] font-black rounded-md uppercase tracking-wider shrink-0 ${
                                                        item.badgeVariant === 'amber'
                                                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                                            : item.badgeVariant === 'purple'
                                                            ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                                                            : item.badgeVariant === 'rose'
                                                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                                                    }`}
                                                >
                                                    {item.badgeLabel}
                                                </span>
                                            </div>

                                            <div>
                                                <h4 className="text-xs font-extrabold text-slate-900 dark:text-white line-clamp-1">
                                                    {item.title}
                                                </h4>
                                                {item.subtitle && (
                                                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                        {item.subtitle}
                                                    </p>
                                                )}
                                                {item.description && (
                                                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                                                        {item.description}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Footer Actions */}
                                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800/80 mt-1">
                                                <span className="text-[10px] font-mono text-slate-400">
                                                    {formatDistanceToNow(parseUTCDate(item.created_at), { addSuffix: true })}
                                                </span>

                                                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                                    {item.actions.map((act) => {
                                                        const isActing = actingItemId === item.id;

                                                        if (act.variant === 'success') {
                                                            const isCloseFormOpen = closingTicketId === item.id && act.actionKey === 'open_close_form';

                                                            return (
                                                                <button
                                                                    key={act.actionKey}
                                                                    type="button"
                                                                    disabled={isActing}
                                                                    onClick={() => handleExecuteAction(item, act.actionKey)}
                                                                    className={`px-2.5 py-1 text-white rounded-lg text-[10.5px] font-black shadow-2xs flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50 cursor-pointer ${
                                                                        isCloseFormOpen
                                                                            ? 'bg-slate-700 hover:bg-slate-800'
                                                                            : 'bg-emerald-600 hover:bg-emerald-700'
                                                                    }`}
                                                                >
                                                                    {isActing ? (
                                                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                                                    ) : (
                                                                        <CheckCircle className="w-3 h-3" />
                                                                    )}
                                                                    <span>{isCloseFormOpen ? 'Cancel' : act.label}</span>
                                                                </button>
                                                            );
                                                        }

                                                        if (act.variant === 'danger') {
                                                            return (
                                                                <button
                                                                    key={act.actionKey}
                                                                    type="button"
                                                                    disabled={isActing}
                                                                    onClick={() => handleExecuteAction(item, act.actionKey)}
                                                                    className="px-2.5 py-1 bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 rounded-lg text-[10.5px] font-black transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                    <span>{act.label}</span>
                                                                </button>
                                                            );
                                                        }

                                                        return (
                                                            <button
                                                                key={act.actionKey}
                                                                type="button"
                                                                disabled={isActing}
                                                                onClick={() => handleExecuteAction(item, act.actionKey)}
                                                                className="px-2.5 py-1 bg-[#587e85] hover:bg-[#46666c] text-white rounded-lg text-[10.5px] font-black shadow-2xs flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                                                            >
                                                                <span>{act.label}</span>
                                                                <ArrowRight className="w-3 h-3" />
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Inline Close Ticket Drawer (Shown strictly when user is assignee and initiates Close Ticket) */}
                                            {closingTicketId === item.id && (
                                                <div className="p-2.5 bg-emerald-50/90 dark:bg-emerald-950/60 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-2 mt-2 animate-in fade-in">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10.5px] font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-1">
                                                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                                            Close & Resolve Ticket #{item.ticketNumber}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setClosingTicketId(null)}
                                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={closingResolutionNote}
                                                        onChange={(e) => setClosingResolutionNote(e.target.value)}
                                                        placeholder="Resolution note (optional: e.g. Resolved with employee)..."
                                                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
                                                        autoFocus
                                                    />
                                                    <div className="flex items-center gap-2 justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => setClosingTicketId(null)}
                                                            className="px-2 py-1 text-[10.5px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-md cursor-pointer"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={actingItemId === item.id}
                                                            onClick={() => handleConfirmCloseTicket(item, closingResolutionNote)}
                                                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10.5px] font-black shadow-xs flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer"
                                                        >
                                                            {actingItemId === item.id ? (
                                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                                <Check className="w-3 h-3" />
                                                            )}
                                                            <span>Confirm & Close</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
