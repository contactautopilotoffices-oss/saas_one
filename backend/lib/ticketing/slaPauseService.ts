import { SupabaseClient } from '@supabase/supabase-js';

export interface PauseSLAResult {
    success: boolean;
    ticketId: string;
    action: 'paused' | 'resumed' | 'no_change';
    reason?: string;
    pausedMinutes?: number;
    newDeadline?: string | null;
}

/**
 * Pauses SLA on a ticket if not already paused.
 */
export async function pauseTicketSLA(
    supabase: SupabaseClient,
    ticketId: string,
    reason: string,
    userId?: string
): Promise<PauseSLAResult> {
    const { data: ticket, error } = await supabase
        .from('tickets')
        .select('id, ticket_number, status, sla_paused, sla_paused_at, sla_pause_reason, total_paused_minutes, sla_deadline')
        .eq('id', ticketId)
        .single();

    if (error || !ticket) {
        console.error('[pauseTicketSLA] Ticket not found:', ticketId, error);
        return { success: false, ticketId, action: 'no_change' };
    }

    // Do not pause already closed or resolved tickets
    if (['resolved', 'closed'].includes(ticket.status)) {
        return { success: true, ticketId, action: 'no_change' };
    }

    // Already paused: update reason if changed
    if (ticket.sla_paused) {
        if (reason && ticket.sla_pause_reason !== reason) {
            await supabase
                .from('tickets')
                .update({ sla_pause_reason: reason, updated_at: new Date().toISOString() })
                .eq('id', ticketId);
        }
        return { success: true, ticketId, action: 'no_change', reason: ticket.sla_pause_reason };
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
        .from('tickets')
        .update({
            sla_paused: true,
            sla_paused_at: now,
            sla_pause_reason: reason,
            updated_at: now,
        })
        .eq('id', ticketId);

    if (updateError) {
        console.error('[pauseTicketSLA] Failed to pause SLA:', updateError);
        return { success: false, ticketId, action: 'no_change' };
    }

    // Activity log
    try {
        await supabase.from('ticket_activity_log').insert({
            ticket_id: ticketId,
            user_id: userId || null,
            action: 'sla_paused',
            new_value: reason,
            notes: `SLA paused: ${reason}`
        });
    } catch (logErr) {
        console.warn('[pauseTicketSLA] Log failed (non-blocking):', logErr);
    }

    return { success: true, ticketId, action: 'paused', reason };
}

/**
 * Resumes SLA on a ticket if currently paused, extending the sla_deadline by the paused duration.
 */
export async function resumeTicketSLA(
    supabase: SupabaseClient,
    ticketId: string,
    reason?: string,
    userId?: string
): Promise<PauseSLAResult> {
    const { data: ticket, error } = await supabase
        .from('tickets')
        .select('id, ticket_number, status, sla_paused, sla_paused_at, sla_pause_reason, total_paused_minutes, sla_deadline')
        .eq('id', ticketId)
        .single();

    if (error || !ticket) {
        console.error('[resumeTicketSLA] Ticket not found:', ticketId, error);
        return { success: false, ticketId, action: 'no_change' };
    }

    if (!ticket.sla_paused) {
        return { success: true, ticketId, action: 'no_change' };
    }

    const pausedAt = ticket.sla_paused_at ? new Date(ticket.sla_paused_at) : new Date();
    const pausedMinutes = Math.max(1, Math.floor((Date.now() - pausedAt.getTime()) / 60000));
    const totalPaused = (ticket.total_paused_minutes || 0) + pausedMinutes;

    let newDeadline = ticket.sla_deadline;
    if (ticket.sla_deadline) {
        const d = new Date(ticket.sla_deadline);
        d.setMinutes(d.getMinutes() + pausedMinutes);
        newDeadline = d.toISOString();
    }

    const now = new Date().toISOString();
    const updates: Record<string, any> = {
        sla_paused: false,
        sla_paused_at: null,
        sla_pause_reason: null,
        total_paused_minutes: totalPaused,
        updated_at: now,
    };
    if (newDeadline) {
        updates.sla_deadline = newDeadline;
    }

    const { error: updateError } = await supabase
        .from('tickets')
        .update(updates)
        .eq('id', ticketId);

    if (updateError) {
        console.error('[resumeTicketSLA] Failed to resume SLA:', updateError);
        return { success: false, ticketId, action: 'no_change' };
    }

    const resumeNote = reason || `SLA resumed after ${pausedMinutes} mins pause. Deadline extended.`;
    try {
        await supabase.from('ticket_activity_log').insert({
            ticket_id: ticketId,
            user_id: userId || null,
            action: 'sla_resumed',
            new_value: resumeNote,
            notes: `SLA resumed. Total paused: ${totalPaused} mins. New deadline: ${newDeadline || 'N/A'}`
        });
    } catch (logErr) {
        console.warn('[resumeTicketSLA] Log failed (non-blocking):', logErr);
    }

    return {
        success: true,
        ticketId,
        action: 'resumed',
        pausedMinutes,
        newDeadline
    };
}

/**
 * Checks whether both vendor procurement and material requests are completed.
 * If neither is pending, automatically resumes SLA!
 * If one is still pending, keeps SLA paused and updates the reason.
 */
export async function checkAndResumeTicketSLA(
    supabase: SupabaseClient,
    ticketId: string,
    userId?: string
): Promise<PauseSLAResult> {
    const { data: ticket, error } = await supabase
        .from('tickets')
        .select(`
            id, status, sla_paused, needs_vendor_procurement, vendor_procurement_status,
            material_requests(id, status)
        `)
        .eq('id', ticketId)
        .single();

    if (error || !ticket) {
        return { success: false, ticketId, action: 'no_change' };
    }

    if (!ticket.sla_paused) {
        return { success: true, ticketId, action: 'no_change' };
    }

    // Check if vendor procurement is still pending
    const isVendorPending = Boolean(
        ticket.needs_vendor_procurement &&
        ticket.vendor_procurement_status !== 'vendor_arranged'
    );

    // Check if any material request is still active/pending
    const pendingMRs = (ticket.material_requests || []).filter(
        (mr: any) => !['delivered', 'rejected', 'cancelled'].includes(mr.status)
    );
    const isMaterialPending = pendingMRs.length > 0;

    if (isVendorPending && isMaterialPending) {
        return { success: true, ticketId, action: 'no_change', reason: 'Waiting for Vendor & Materials' };
    } else if (isVendorPending) {
        return { success: true, ticketId, action: 'no_change', reason: 'Waiting for Vendor' };
    } else if (isMaterialPending) {
        return { success: true, ticketId, action: 'no_change', reason: 'Waiting for Materials' };
    }

    // Neither is pending -> Resume SLA!
    return resumeTicketSLA(supabase, ticketId, 'Vendor arranged & materials delivered', userId);
}
