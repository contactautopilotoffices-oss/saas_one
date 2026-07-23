import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';

export const EventProcessor = {
    async processEvent(event: any) {
        const { event_type, payload } = event;

        if (event_type === 'MEETING_ROOM_BOOKED' || event_type === 'MEETING_ROOM_CANCELLED') {
            await this.handleMeetingRoomEvent(event_type, payload);
        } else if (event_type === 'MATERIAL_REQUEST_CREATED') {
            await this.handleMaterialRequestEvent(payload);
        } else {
            console.warn(`[EventProcessor] Unknown event type: ${event_type}`);
        }
    },

    async handleMeetingRoomEvent(eventType: string, payload: any) {
        const propertyId = payload.property_id;
        const meetingRoomId = payload.meeting_room_id;
        const userId = payload.user_id;

        const { data: property } = await supabaseAdmin
            .from('properties')
            .select('organization_id, name')
            .eq('id', propertyId)
            .single();

        if (!property?.organization_id) throw new Error('Property or org_id not found');

        const { data: orgData } = await supabaseAdmin
            .from('organization_settings')
            .select('email_preferences, email_templates')
            .eq('organization_id', property.organization_id)
            .maybeSingle();

        const emailPrefs = orgData?.email_preferences || {};
        if (emailPrefs.meeting_rooms === false) {
            console.log(`[EventProcessor] Meeting rooms email disabled for org ${property.organization_id}`);
            return;
        }

        const customHtml = (orgData as any)?.email_templates?.meeting_rooms?.html || null;

        const { data: admins } = await supabaseAdmin
            .from('property_memberships')
            .select('user:users!user_id(email)')
            .eq('property_id', propertyId)
            .eq('role', 'property_admin')
            .eq('is_active', true);

        if (!admins || admins.length === 0) {
            console.warn(`[EventProcessor] No property admins found for property ${propertyId}`);
            return;
        }

        const { data: roomData } = await supabaseAdmin
            .from('meeting_rooms')
            .select('name')
            .eq('id', meetingRoomId)
            .single();

        const { data: userData } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', userId)
            .single();

        const isCancellation = eventType === 'MEETING_ROOM_CANCELLED';

        for (const admin of admins) {
            // @ts-ignore
            const emailTo = admin.user?.email || admin.user?.[0]?.email;
            if (emailTo) {
                await EmailService.sendMeetingRoomEmail({
                    emailTo: emailTo,
                    roomName: roomData?.name || 'Meeting Room',
                    date: payload.booking_date,
                    startTime: payload.start_time,
                    endTime: payload.end_time,
                    propertyName: property.name || 'Your Property',
                    requesterName: userData?.full_name || 'Tenant User',
                    requesterEmail: userData?.email || 'N/A',
                    isCancellation,
                    comment: payload.comment || null,
                    customHtml
                });
            }
        }
    },

    async handleMaterialRequestEvent(payload: any) {
        const assigneeUid = payload.assignee_uid;
        if (!assigneeUid) {
            console.log(`[EventProcessor] Material request has no assignee. Skipping email.`);
            return;
        }

        const ticketId = payload.ticket_id;
        const requestId = payload.id;
        const userId = payload.requested_by;

        const orgId = payload.organization_id;
        if (orgId) {
            const { data: orgData } = await supabaseAdmin
                .from('organization_settings')
                .select('email_preferences')
                .eq('organization_id', orgId)
                .maybeSingle();
            
            if (orgData?.email_preferences?.procurement === false) {
                 console.log(`[EventProcessor] Procurement emails disabled for org ${orgId}`);
                 return;
            }
        }

        const { data: assignee } = await supabaseAdmin.from('users').select('email').eq('id', assigneeUid).single();
        const { data: ticket } = await supabaseAdmin.from('tickets').select('*, property:properties(name)').eq('id', ticketId).single();
        const { data: requester } = await supabaseAdmin.from('users').select('id, full_name, email').eq('id', userId).single();
        const { data: items } = await supabaseAdmin.from('material_request_items').select('*').eq('request_id', requestId);

        if (assignee?.email && ticket) {
            await EmailService.sendMaterialRequestEmail({
                emailTo: assignee.email,
                ticket,
                property: ticket.property,
                requestedBy: requester,
                items: items || []
            });
        }
    }
};
