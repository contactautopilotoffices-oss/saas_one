'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Loader2 } from 'lucide-react';
import TicketCard from '@/frontend/components/shared/TicketCard';

/**
 * "Tickets" tab of the IT console (owner 2026-11-02): only the tickets assigned to the signed-in user, across every
 * property of the organisation (or the one picked in the console's property pill). Reads the existing
 * GET /api/tickets list and renders each ticket with the shared TicketCard; opening one goes to the usual
 * /tickets/[id] screen, where the assignee starts, pauses and completes the work.
 */

interface AssignedTicket {
    id: string;
    ticket_number: string;
    title: string;
    status: string;
    priority: string;
    created_at: string;
    resolved_at?: string | null;
    assigned_to: string | null;
    sla_deadline?: string | null;
    sla_breached?: boolean;
    photo_before_url?: string | null;
    creator?: { full_name: string; user_photo_url?: string | null } | null;
    assignee?: { full_name: string; user_photo_url?: string | null } | null;
    property?: { name: string } | null;
}

type View = 'active' | 'completed';

// Every ticket status that still needs work, and every status where the work is done.
const STATUSES: Record<View, string> = {
    active: 'open,waitlist,assigned,in_progress,paused,blocked',
    completed: 'pending_validation,resolved,closed',
};

// Same status mapping the MST dashboard uses for TicketCard.
const cardStatus = (t: AssignedTicket) =>
    ['closed', 'resolved'].includes(t.status) ? 'COMPLETED'
        : t.status === 'in_progress' ? 'IN_PROGRESS'
            : t.status === 'pending_validation' ? 'PENDING_VALIDATION'
                : t.assigned_to ? 'ASSIGNED' : 'OPEN';

interface AssignedTicketsTabProps {
    organizationId: string;
    userId: string;
    propertyId?: string; // undefined = all properties
}

export default function AssignedTicketsTab({ organizationId, userId, propertyId }: AssignedTicketsTabProps) {
    const router = useRouter();
    const [view, setView] = useState<View>('active');
    const [tickets, setTickets] = useState<AssignedTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            const params = new URLSearchParams({ organizationId, assignedTo: userId, status: STATUSES[view], limit: '200' });
            if (propertyId) params.set('propertyId', propertyId);
            try {
                const res = await fetch(`/api/tickets?${params.toString()}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load your tickets.');
                if (!cancelled) setTickets(data.tickets || []);
            } catch (err) {
                if (!cancelled) { setTickets([]); setError(err instanceof Error ? err.message : 'Could not load your tickets.'); }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [organizationId, userId, propertyId, view]);

    // Back from the ticket returns to this tab (the detail page honours an absolute `from` path).
    const openTicket = (id: string) => {
        const back = `${window.location.pathname}${window.location.search}`;
        router.push(`/tickets/${id}?from=${encodeURIComponent(back)}`);
    };

    return (
        <div className="space-y-4">
            <div role="tablist" aria-label="Ticket status" className="inline-flex rounded-xl border border-border bg-surface-elevated p-1">
                {(['active', 'completed'] as const).map(v => (
                    <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                        className={`rounded-lg px-4 py-1.5 text-xs font-bold capitalize transition-colors ${view === v ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:text-text-primary'}`}>
                        {v}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-text-tertiary" /></div>
            ) : error ? (
                <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>
            ) : tickets.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center text-text-tertiary">
                    <CheckCircle className="mb-3 h-10 w-10 opacity-50" />
                    <p className="text-sm font-medium">{view === 'active' ? 'No open tickets assigned to you.' : 'No completed tickets yet.'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {tickets.map(t => (
                        <TicketCard
                            key={t.id}
                            id={t.id}
                            title={t.title}
                            priority={(t.priority?.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') || 'MEDIUM'}
                            status={cardStatus(t)}
                            ticketNumber={t.ticket_number}
                            createdAt={t.created_at}
                            resolvedAt={t.resolved_at}
                            raisedBy={t.creator?.full_name}
                            raisedByPhotoUrl={t.creator?.user_photo_url}
                            assignedTo={t.assignee?.full_name}
                            assigneePhotoUrl={t.assignee?.user_photo_url}
                            photoUrl={t.photo_before_url || undefined}
                            propertyName={t.property?.name}
                            slaDeadline={t.sla_deadline}
                            slaBreached={t.sla_breached}
                            onClick={() => openTicket(t.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
