import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { guardProperty, resolveCaller, isCallerError } from '@/backend/lib/auth/callerAccess';

/**
 * Move a client support request (QR guest request) between PENDING / IN_PROGRESS / RESOLVED and
 * record who did it on the request's timeline.
 *
 * Why this route exists: the dashboard used to update `guest_requests` and insert into
 * `guest_request_events` straight from the browser. Production has no INSERT policy on
 * `guest_request_events` (only "guest_events_select_clean"), so every timeline write was rejected
 * by RLS, and because a PostgREST UPDATE that matches no row reports no error, a blocked status
 * change looked like it had worked until the page was reloaded. Doing both writes here, behind
 * guardProperty and with the service role, makes the change actually land and makes a genuine
 * failure a real error message instead of a silent no-op.
 */

const VALID_STATUSES = ['PENDING', 'IN_PROGRESS', 'RESOLVED'] as const;
type GuestRequestStatus = (typeof VALID_STATUSES)[number];

function isValidStatus(value: unknown): value is GuestRequestStatus {
    return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; requestId: string }> },
) {
    try {
        const { propertyId, requestId } = await params;

        const denied = await guardProperty(request, propertyId);
        if (denied) return denied;

        const caller = await resolveCaller(request);
        if (isCallerError(caller)) return caller;

        const body = await request.json().catch(() => null);
        const rawStatus = (body as { status?: unknown } | null)?.status;
        const nextStatus = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : rawStatus;
        if (!isValidStatus(nextStatus)) {
            return NextResponse.json(
                { error: `status must be one of ${VALID_STATUSES.join(', ')}` },
                { status: 400 },
            );
        }

        const supabase = createAdminClient();

        // The request must exist and belong to the property the caller was guarded against, so a
        // member of one property cannot move another property's ticket.
        const { data: existing, error: loadError } = await supabase
            .from('guest_requests')
            .select('id, status, property_id')
            .eq('id', requestId)
            .maybeSingle();

        if (loadError) {
            console.error('guest-request status load error:', loadError);
            return NextResponse.json({ error: 'Failed to load the request' }, { status: 500 });
        }
        if (!existing || existing.property_id !== propertyId) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        const previousStatus = existing.status as GuestRequestStatus | null;

        if (previousStatus === nextStatus) {
            return NextResponse.json({
                success: true,
                unchanged: true,
                status: nextStatus,
                event: null,
            });
        }

        const { data: updated, error: updateError } = await supabase
            .from('guest_requests')
            .update({ status: nextStatus })
            .eq('id', requestId)
            .select('id, status')
            .single();

        if (updateError || !updated) {
            console.error('guest-request status update error:', updateError);
            return NextResponse.json(
                { error: updateError?.message || 'Failed to update the status' },
                { status: 500 },
            );
        }

        // Timeline entry. A failure here must not hide the fact that the status did change, so it is
        // reported alongside the new status rather than as an outright failure.
        const { data: event, error: eventError } = await supabase
            .from('guest_request_events')
            .insert({
                guest_request_id: requestId,
                user_id: caller.userId,
                action: 'STATUS_UPDATE',
                from_status: previousStatus,
                to_status: nextStatus,
            })
            .select('id, action, from_status, to_status, created_at, users ( full_name, user_photo_url, email )')
            .single();

        if (eventError) {
            console.error('guest-request timeline insert error:', eventError);
        }

        return NextResponse.json({
            success: true,
            status: updated.status,
            previousStatus,
            event: event ?? null,
            timelineWarning: eventError ? 'Status updated, but the timeline entry could not be saved.' : null,
        });
    } catch (err) {
        console.error('guest-request status PATCH error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
