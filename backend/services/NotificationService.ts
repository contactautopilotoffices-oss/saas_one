import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { firebaseAdmin } from '@/backend/lib/firebase';
import { WhatsAppService } from './WhatsAppService';
import { WhatsAppQueueService } from './WhatsAppQueueService';

export interface NotificationPayload {
    userId: string;
    ticketId?: string;
    bookingId?: string;
    propertyId: string;
    organizationId?: string;
    type: string;
    title: string;
    message: string;
    deepLink: string;
    priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
    /** Pre-built WhatsApp payload — skips ticket DB fetch inside send() entirely */
    whatsapp?: {
        message: string;
        mediaUrl?: string;
        mediaType?: 'image' | 'video';
    };
}

export interface Recipient {
    user_id: string;
    role: string;
}

export class NotificationService {
    static async afterTicketCreated(ticketId: string) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('*, properties(name), creator:users!raised_by(id, full_name), assignee:users!assigned_to(full_name)')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket) {
                console.error('[NotificationService] Error fetching ticket:', ticketError);
                return;
            }

            const assigneeId = ticket.assigned_to ? String(ticket.assigned_to) : null;
            const assigneeName = ticket.assignee?.full_name || 'a team member';
            const creatorId = ticket.raised_by ? String(ticket.raised_by) : null;

            // Determine if the creator is a tenant
            const { data: creatorMembership } = await supabaseAdmin
                .from('property_memberships')
                .select('role')
                .eq('property_id', ticket.property_id)
                .eq('user_id', creatorId)
                .single();

            const isCreatorTenant = creatorMembership?.role?.toUpperCase() === 'TENANT';


            // 1. Resolve recipients with roles
            const prospectiveRecipients = await this.getRelevantRecipientsWithRoles(ticket.property_id);

            // Filter recipients based on user requirements:
            // "Tenant only receive the notification about the ticket created by himself and other tenant, not created by others"
            // If ticket is internal, tenants are excluded entirely
            const isInternal = !!ticket.is_internal;
            const recipients = prospectiveRecipients.filter((r: { userId: string; role: string }) => {
                const isRecipientTenant = r.role.toUpperCase() === 'TENANT';
                if (isRecipientTenant) {
                    // Internal tickets: never notify tenants
                    if (isInternal) {
                        return false;
                    }
                    // "Tenant only receive the notification about the ticket created by himself"
                    const shouldNotify = r.userId === creatorId;
                    return shouldNotify;
                }
                return true; // Staff/Admin/MST see everything
            }).map((r: { userId: string; role: string }) => r.userId);

            // 1b. Also include org_super_admin users for this organization
            if (ticket.organization_id) {
                const { data: orgAdmins } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('user_id')
                    .eq('organization_id', ticket.organization_id)
                    .eq('role', 'org_super_admin');
                (orgAdmins || []).forEach((m: { user_id: string }) => {
                    if (!recipients.includes(String(m.user_id))) {
                        recipients.push(String(m.user_id));
                    }
                });
            }

            const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

            // 2. Pre-build WhatsApp payload ONCE — poll for media up to 3x (ticket creation
            //    triggers media upload in background so photo may not exist yet)
            let waTicket: any = { ...ticket, raiser: (ticket.creator as any) };
            if (!ticket.photo_before_url && !ticket.photo_after_url && !ticket.video_before_url && !ticket.video_after_url) {
                for (let i = 0; i < 3; i++) {
                    await new Promise(r => setTimeout(r, 3_000));
                    const { data: polled } = await supabaseAdmin
                        .from('tickets')
                        .select('photo_before_url, photo_after_url, video_before_url, video_after_url')
                        .eq('id', ticketId)
                        .single();
                    if (polled?.photo_before_url || polled?.photo_after_url || polled?.video_before_url || polled?.video_after_url) {
                        waTicket = { ...waTicket, ...polled };
                        break;
                    }
                }
            }
            await this.injectAssigneePhone(waTicket);
            const waBody = this.buildWhatsAppBody(waTicket);
            const { mediaUrl: waMediaUrl, mediaType: waMediaType } = this.extractMedia(waTicket);

            // 3. Broadcast Logic
            if (assigneeId) {
                await this.send({
                    userId: assigneeId,
                    ticketId: ticket.id,
                    propertyId: ticket.property_id,
                    organizationId: ticket.organization_id,
                    type: 'TICKET_ASSIGNED',
                    title: 'New Ticket Created & Assigned',
                    message: `A new ticket "${ticket.title}" has been created and assigned to you.`,
                    deepLink: `/tickets/${ticket.id}?from=requests`,
                    whatsapp: { 
                        message: `*New Ticket Created & Assigned*\n\n${waBody}${APP_URL ? `\n\n🔗 ${APP_URL}/tickets/${ticket.id}?from=requests` : ''}`, 
                        mediaUrl: waMediaUrl, 
                        mediaType: waMediaType 
                    },
                });

                const others = recipients.filter((id: string) => id !== assigneeId);
                for (const userId of others) {
                    const isWhatsAppTicket = ticket.classification_source === 'whatsapp';
                    const isCreator = userId === creatorId;
                    
                    await this.send({
                        userId,
                        ticketId: ticket.id,
                        propertyId: ticket.property_id,
                        organizationId: ticket.organization_id,
                        type: 'TICKET_CREATED',
                        title: 'New Ticket Created & Assigned',
                        message: `A new ticket "${ticket.title}" has been created and assigned to ${assigneeName}.`,
                        deepLink: `/tickets/${ticket.id}?from=requests`,
                        whatsapp: (isWhatsAppTicket && isCreator) ? undefined : { 
                            message: `*New Ticket Created & Assigned*\n\n${waBody}${APP_URL ? `\n\n🔗 ${APP_URL}/tickets/${ticket.id}?from=requests` : ''}`, 
                            mediaUrl: waMediaUrl, 
                            mediaType: waMediaType 
                        },
                    });
                }
            } else {
                for (const userId of recipients) {
                    const isWhatsAppTicket = ticket.classification_source === 'whatsapp';
                    const isCreator = userId === creatorId;

                    await this.send({
                        userId,
                        ticketId: ticket.id,
                        propertyId: ticket.property_id,
                        organizationId: ticket.organization_id,
                        type: 'TICKET_CREATED',
                        title: 'New Ticket Created',
                        message: `A new ticket "${ticket.title}" has been raised at ${ticket.properties?.name}.`,
                        deepLink: `/tickets/${ticket.id}?from=requests`,
                        whatsapp: (isWhatsAppTicket && isCreator) ? undefined : { 
                            message: `*New Ticket Created*\n\n${waBody}${APP_URL ? `\n\n🔗 ${APP_URL}/tickets/${ticket.id}?from=requests` : ''}`, 
                            mediaUrl: waMediaUrl, 
                            mediaType: waMediaType 
                        },
                    });
                }
            }
        } catch (error) {
            console.error('[NotificationService] afterTicketCreated CRASH:', error);
        }
    }

    /**
     * Triggered after a before-photo is uploaded to a ticket.
     * Sends WhatsApp messages to all recipients with the photo attached (no push/DB).
     */
    static async afterTicketPhotoUploaded(ticketId: string) {
        try {
            const { data: ticket, error } = await supabaseAdmin
                .from('tickets')
                .select('id, title, status, priority, ticket_number, photo_before_url, photo_after_url, video_before_url, video_after_url, property_id, organization_id, raised_by, assigned_to, properties(name), assignee:users!assigned_to(full_name)')
                .eq('id', ticketId)
                .single();

            if (error || !ticket) {
                console.error('[NotificationService] afterTicketPhotoUploaded: ticket not found', error);
                return;
            }

            const photo = ticket.photo_before_url || ticket.photo_after_url;
            const video = ticket.video_before_url || ticket.video_after_url;
            if (!photo && !video) {
                return;
            }

            const creatorId = ticket.raised_by ? String(ticket.raised_by) : null;

            const prospectiveRecipients = await this.getRelevantRecipientsWithRoles(ticket.property_id);
            const recipients = prospectiveRecipients
                .filter((r: { userId: string; role: string }) => {
                    if (r.role.toUpperCase() === 'TENANT') return r.userId === creatorId;
                    return true;
                })
                .map((r: { userId: string; role: string }) => r.userId);

            const priorityEmoji: Record<string, string> = {
                critical: '🔴', high: '🟠', medium: '🟡', low: '🟢'
            };
            const statusEmoji: Record<string, string> = {
                open: '📬', assigned: '👷', in_progress: '⚙️',
                resolved: '✅', closed: '🔒', waitlist: '⏳', blocked: '🚫'
            };
            const pEmoji = priorityEmoji[(ticket as any).priority] || '⚪';
            const sEmoji = statusEmoji[(ticket as any).status] || '📋';
            const propName = (ticket.properties as any)?.name || '';
            const assigneeName = (ticket.assignee as any)?.full_name || '';

            const message = [
                `*New Ticket*`,
                ``,
                `📋 *${ticket.title}*`,
                propName ? `🏢 ${propName}` : '',
                ticket.ticket_number ? `🎫 ${ticket.ticket_number}` : '',
                `${pEmoji} Priority: *${(ticket as any).priority?.toUpperCase()}*`,
                `${sEmoji} Status: *${(ticket as any).status?.replace(/_/g, ' ').toUpperCase()}*`,
                assigneeName ? `👷 Assigned to: *${assigneeName}*` : '',
            ].filter(Boolean).join('\n');


            await WhatsAppService.sendToUsers(recipients, {
                message,
                deepLink: `/tickets/${ticket.id}?from=requests`,
                mediaUrl: photo || video || undefined,
                mediaType: photo ? 'image' : 'video',
            });
        } catch (err) {
            console.error('[NotificationService] afterTicketPhotoUploaded error:', err);
        }
    }

    /**
     * Triggered after a ticket is added to waitlist.
     */
    static async afterTicketWaitlisted(ticketId: string) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('*, properties(name), assignee:users!assigned_to(full_name, phone), raiser:users!raised_by(full_name)')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket) return;

            const creatorId = ticket.raised_by ? String(ticket.raised_by) : null;
            const prospectiveRecipients = await this.getRelevantRecipientsWithRoles(ticket.property_id);

            const recipients = prospectiveRecipients.filter((r: { userId: string; role: string }) => {
                if (r.role.toUpperCase() === 'TENANT') return r.userId === creatorId;
                return true;
            }).map((r: { userId: string; role: string }) => r.userId);

            await this.injectAssigneePhone(ticket);
            const waBody = this.buildWhatsAppBody(ticket);
            const { mediaUrl: waMediaUrl, mediaType: waMediaType } = this.extractMedia(ticket);

            for (const userId of recipients) {
                await this.send({
                    userId,
                    ticketId: ticket.id,
                    propertyId: ticket.property_id,
                    organizationId: ticket.organization_id,
                    type: 'TICKET_WAITLISTED',
                    title: 'Ticket Waitlisted ⏳',
                    message: `Ticket "${ticket.title}" has been added to the waitlist at ${ticket.properties?.name}.`,
                    deepLink: `/tickets/${ticket.id}?from=requests`,
                    whatsapp: { message: `*Ticket Waitlisted ⏳*\n\n${waBody}`, mediaUrl: waMediaUrl, mediaType: waMediaType },
                });
            }
        } catch (error) {
            console.error('[NotificationService] afterTicketWaitlisted error:', error);
        }
    }

    /**
     * Triggered when a ticket is manually reassigned to a different person.
     * Sends WhatsApp + push only to the new assignee.
     */
    static async afterTicketReassigned(ticketId: string) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('*, properties(name), assignee:users!assigned_to(full_name, phone), raiser:users!raised_by(full_name)')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket || !ticket.assigned_to) {
                console.error('[NotificationService] afterTicketReassigned: ticket not found or no assignee', ticketError);
                return;
            }

            const assigneeId = String(ticket.assigned_to);
            await this.injectAssigneePhone(ticket);
            const waBody = this.buildWhatsAppBody(ticket);
            const { mediaUrl: waMediaUrl, mediaType: waMediaType } = this.extractMedia(ticket);

            await this.send({
                userId: assigneeId,
                ticketId: ticket.id,
                propertyId: ticket.property_id,
                organizationId: ticket.organization_id,
                type: 'TICKET_ASSIGNED',
                title: 'Ticket Reassigned to You',
                message: `Ticket "${ticket.title}" has been reassigned to you.`,
                deepLink: `/tickets/${ticket.id}?from=requests`,
                whatsapp: { message: `*Ticket Reassigned to You*\n\n${waBody}`, mediaUrl: waMediaUrl, mediaType: waMediaType },
            });
        } catch (error) {
            console.error('[NotificationService] afterTicketReassigned error:', error);
        }
    }

    static async afterTicketAssigned(ticketId: string, isAutoAssigned: boolean = false) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('*, properties(name), assignee:users!assigned_to(full_name, phone), raiser:users!raised_by(full_name)')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket || !ticket.assigned_to) {
                console.error('[NotificationService] Ticket not found or not assigned:', ticketError);
                return;
            }

            const assigneeId = String(ticket.assigned_to);
            const assigneeName = ticket.assignee?.full_name || 'a team member';
            const creatorId = ticket.raised_by ? String(ticket.raised_by) : null;

            const prospectiveRecipients = await this.getRelevantRecipientsWithRoles(ticket.property_id);
            const filteredRecipients = prospectiveRecipients.filter((r: { userId: string; role: string }) => {
                if (r.role.toUpperCase() === 'TENANT') return r.userId === creatorId;
                return true;
            }).map((r: { userId: string; role: string }) => r.userId);

            await this.injectAssigneePhone(ticket);
            const waBody = this.buildWhatsAppBody(ticket);
            const { mediaUrl: waMediaUrl, mediaType: waMediaType } = this.extractMedia(ticket);

            // 1. Notify Assignee
            await this.send({
                userId: assigneeId,
                ticketId: ticket.id,
                propertyId: ticket.property_id,
                organizationId: ticket.organization_id,
                type: 'TICKET_ASSIGNED',
                title: 'Ticket Assigned to You',
                message: isAutoAssigned
                    ? `A new ticket "${ticket.title}" has been created and auto-assigned to you.`
                    : `Ticket "${ticket.title}" has been assigned to you.`,
                deepLink: `/tickets/${ticket.id}?from=requests`,
                whatsapp: { message: `*Ticket Assigned to You*\n\n${waBody}`, mediaUrl: waMediaUrl, mediaType: waMediaType },
            });

            // 2. Notify Others
            const others = filteredRecipients.filter(id => id !== assigneeId);
            for (const userId of others) {
                await this.send({
                    userId,
                    ticketId: ticket.id,
                    propertyId: ticket.property_id,
                    organizationId: ticket.organization_id,
                    type: 'TICKET_ASSIGNED',
                    title: 'Ticket Assigned',
                    message: `Ticket "${ticket.title}" has been assigned to ${assigneeName}.`,
                    deepLink: `/tickets/${ticket.id}?from=requests`,
                    whatsapp: { message: `*Ticket Assigned*\n\n${waBody}`, mediaUrl: waMediaUrl, mediaType: waMediaType },
                });
            }
        } catch (error) {
            console.error('[NotificationService] afterTicketAssigned error:', error);
        }
    }

    static async afterTicketCompleted(ticketId: string) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('*, properties(name), assignee:users!assigned_to(full_name, phone), raiser:users!raised_by(full_name)')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket) return;

            const creatorId = ticket.raised_by ? String(ticket.raised_by) : null;

            const prospectiveRecipients = await this.getRelevantRecipientsWithRoles(ticket.property_id);
            const recipients = prospectiveRecipients
                .filter((r: { userId: string; role: string }) => {
                    if (r.role.toUpperCase() === 'TENANT') return r.userId === creatorId;
                    return true;
                })
                .map((r: { userId: string; role: string }) => r.userId);

            await this.injectAssigneePhone(ticket);
            const waBody = this.buildWhatsAppBody(ticket);

            // For completion, send after media (proof of work done) — prefer after over before
            const afterPhoto = ticket.photo_after_url || null;
            const afterVideo = ticket.video_after_url || null;
            const waMediaUrl: string | undefined = afterPhoto || afterVideo || undefined;
            const waMediaType: 'image' | 'video' | undefined = afterPhoto ? 'image' : afterVideo ? 'video' : undefined;

            for (const userId of recipients) {
                await this.send({
                    userId,
                    ticketId: ticket.id,
                    propertyId: ticket.property_id,
                    organizationId: ticket.organization_id,
                    type: 'TICKET_COMPLETED',
                    title: 'Ticket Completed ✅',
                    message: `Ticket "${ticket.title}" has been marked as completed.`,
                    deepLink: `/tickets/${ticket.id}?from=requests`,
                    whatsapp: { message: `*Ticket Completed ✅*\n\n${waBody}`, mediaUrl: waMediaUrl, mediaType: waMediaType },
                });
            }
        } catch (error) {
            console.error('[NotificationService] afterTicketCompleted error:', error);
        }
    }

    /**
     * Triggered when MST completes a ticket — notifies the tenant to validate.
     */
    static async afterTicketPendingValidation(ticketId: string) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('id, title, property_id, organization_id, raised_by')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket) return;

            // Only notify the tenant who raised the ticket
            if (!ticket.raised_by) return;

            const { data: creatorMembership } = await supabaseAdmin
                .from('property_memberships')
                .select('role')
                .eq('property_id', ticket.property_id)
                .eq('user_id', ticket.raised_by)
                .single();

            if (creatorMembership?.role?.toUpperCase() === 'TENANT') {
                await this.send({
                    userId: String(ticket.raised_by),
                    ticketId: ticket.id,
                    propertyId: ticket.property_id,
                    organizationId: ticket.organization_id,
                    type: 'TICKET_PENDING_VALIDATION',
                    title: 'Request Completed — Your Approval Needed',
                    message: `Your request "${ticket.title}" has been resolved. Please review and confirm.`,
                    deepLink: `/tickets/${ticket.id}?from=requests`
                });
            }
        } catch (error) {
            console.error('[NotificationService] afterTicketPendingValidation error:', error);
        }
    }

    /**
     * Triggered when tenant validates (approves or rejects) a ticket.
     */
    static async afterTicketValidated(ticketId: string, approved: boolean) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('id, title, property_id, organization_id, assigned_to')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket) return;

            const recipientIds = new Set<string>();

            // Notify property admins
            const { data: team } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('property_id', ticket.property_id);

            if (team) {
                team.filter(t => t.role?.toLowerCase() === 'property_admin')
                    .forEach(t => recipientIds.add(String(t.user_id)));
            }

            // Notify assignee (MST)
            if (ticket.assigned_to) {
                recipientIds.add(String(ticket.assigned_to));
            }

            const message = approved
                ? `Ticket "${ticket.title}" has been approved and marked as resolved by the client.`
                : `Ticket "${ticket.title}" was rejected by the client and has been reopened.`;

            for (const userId of Array.from(recipientIds)) {
                await this.send({
                    userId,
                    ticketId: ticket.id,
                    propertyId: ticket.property_id,
                    organizationId: ticket.organization_id,
                    type: approved ? 'TICKET_VALIDATED' : 'TICKET_REJECTED',
                    title: approved ? 'Ticket Validated by Client' : 'Ticket Rejected by Client',
                    message,
                    deepLink: `/tickets/${ticket.id}?from=requests`
                });
            }
        } catch (error) {
            console.error('[NotificationService] afterTicketValidated error:', error);
        }
    }

    /**
     * Triggered when a tenant raises a CRITICAL priority ticket.
     * Sends an urgent alert to all property staff/admins/MST — not to tenants.
     */
    static async afterCriticalTicketCreated(ticketId: string) {
        try {
            const { data: ticket, error: ticketError } = await supabaseAdmin
                .from('tickets')
                .select('*, properties(name), creator:users!raised_by(full_name)')
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticket) {
                console.error('[NotificationService] afterCriticalTicketCreated: ticket not found', ticketError);
                return;
            }

            const creatorName = (ticket.creator as any)?.full_name || 'A client';
            const propertyName = (ticket.properties as any)?.name || 'the property';

            // Notify all staff, admins, MST, security — exclude tenants
            const { data: members } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('property_id', ticket.property_id)
                .in('role', ['property_admin', 'staff', 'mst', 'security']);

            const recipientIds = (members || []).map(m => String(m.user_id));

            for (const userId of recipientIds) {
                await this.send({
                    userId,
                    ticketId: ticket.id,
                    propertyId: ticket.property_id,
                    organizationId: ticket.organization_id,
                    type: 'TICKET_CRITICAL',
                    title: 'Critical Request — Immediate Action Required',
                    message: `${creatorName} raised a CRITICAL request at ${propertyName}: "${ticket.title}". Please resolve this urgently.`,
                    deepLink: `/tickets/${ticket.id}?from=requests`,
                });
            }
        } catch (error) {
            console.error('[NotificationService] afterCriticalTicketCreated error:', error);
        }
    }

    static async afterRoomBooked(bookingId: string) {
        try {
            const { data: booking, error: bookingError } = await supabaseAdmin
                .from('meeting_room_bookings')
                .select('*, meeting_room:meeting_rooms(name), booker:users!user_id(full_name)')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) {
                console.error('[NotificationService] Error fetching booking:', bookingError);
                return;
            }

            const bookerName = booking.booker?.full_name || 'A tenant';
            const roomName = booking.meeting_room?.name || 'a meeting room';
            const formatTimeAMPM = (timeStr: string) => {
                const [hours, minutes] = timeStr.split(':');
                let h = parseInt(hours, 10);
                const ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                return `${h}:${minutes} ${ampm}`;
            };

            const date = booking.booking_date;
            const startTime = formatTimeAMPM(booking.start_time);
            const endTime = formatTimeAMPM(booking.end_time);

            const message = `${bookerName} has booked "${roomName}" for ${date} from ${startTime} to ${endTime}.`;

            // Get relevant recipients (Role based)
            const { data: members, error: membersError } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('property_id', booking.property_id)
                .in('role', ['property_admin']);

            if (membersError) {
                console.error('[NotificationService] Error fetching property members for booking notification:', membersError);
                return;
            }

            const finalRecipients = (members || []).map(m => String(m.user_id));
            const uniqueRecipients = Array.from(new Set(finalRecipients));

            for (const userId of uniqueRecipients) {
                await this.send({
                    userId,
                    bookingId: booking.id,
                    propertyId: booking.property_id,
                    type: 'ROOM_BOOKED',
                    title: 'New Room Booking',
                    message,
                    deepLink: `/property-admin/bookings?date=${date}`,
                    whatsapp: {
                        message: `*New Room Booking*\n\n${message}`
                    }
                });
            }
        } catch (error) {
            console.error('[NotificationService] afterRoomBooked error:', error);
        }
    }


    static async afterMaterialRequestCreated(requestId: string) {
        try {
            const { data: request, error } = await supabaseAdmin
                .from('material_requests')
                .select('*, requester:users!material_requests_requested_by_fkey(full_name), properties(name)')
                .eq('id', requestId)
                .single();

            if (error || !request) return;

            const recipientIds = new Set<string>();
            if (request.target_approver_ids && request.target_approver_ids.length > 0) {
                request.target_approver_ids.forEach((id: string) => recipientIds.add(String(id)));
            } else if (request.target_approver_id) {
                recipientIds.add(String(request.target_approver_id));
            }

            // Also find all property admins
            const { data: propMembers } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('property_id', request.property_id)
                .in('role', ['property_admin', 'procurement']);
            
            (propMembers || []).forEach(m => recipientIds.add(String(m.user_id)));

            // Procurement users are stored in organization_memberships, not property_memberships
            if (request.organization_id) {
                const { data: orgMembers } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('user_id, role')
                    .eq('organization_id', request.organization_id)
                    .eq('role', 'procurement');
                
                (orgMembers || []).forEach(m => recipientIds.add(String(m.user_id)));
            }

            const amount = request.total_amount ? `(\u20b9${request.total_amount.toLocaleString()})` : '';

            await this.sendToMany(Array.from(recipientIds), {
                ticketId: request.ticket_id,
                propertyId: request.property_id,
                organizationId: request.organization_id,
                type: 'MATERIAL_REQUEST_PENDING',
                title: 'Material Request Pending Quotation 📥',
                message: `${request.requester?.full_name || 'A team member'} has requested materials ${amount} for ${request.properties?.name || 'the property'}. Please add vendor quotation.`,
                deepLink: `/procurement?tab=orders`,
                priority: 'HIGH',
            });
        } catch (err) {
            console.error('[NS] afterMaterialRequestCreated error:', err);
        }
    }

    static async afterMaterialRequestQuoted(requestId: string) {
        try {
            const { data: request, error } = await supabaseAdmin
                .from('material_requests')
                .select('*, requester:users!material_requests_requested_by_fkey(full_name), properties(name)')
                .eq('id', requestId)
                .single();

            if (error || !request) return;

            const recipientIds = new Set<string>();
            if (request.requested_by) recipientIds.add(String(request.requested_by));
            if (request.assignee_uid) recipientIds.add(String(request.assignee_uid));

            const amount = request.total_amount ? `(₹${request.total_amount.toLocaleString()})` : '';

            await this.sendToMany(Array.from(recipientIds), {
                ticketId: request.ticket_id,
                propertyId: request.property_id,
                organizationId: request.organization_id,
                type: 'MATERIAL_REQUEST_QUOTED',
                title: 'Quotation Added & Budget Deducted ✅',
                message: `Procurement has added a quotation ${amount} for ${request.properties?.name || 'the property'}. Budget has been deducted.`,
                deepLink: `/procurement?tab=orders`,
                priority: 'NORMAL',
            });
        } catch (err) {
            console.error('[NS] afterMaterialRequestQuoted error:', err);
        }
    }

    static async afterMaterialRequestEscalated(requestId: string) {
        try {
            const { data: request, error } = await supabaseAdmin
                .from('material_requests')
                .select('*, requester:users!material_requests_requested_by_fkey(full_name), properties(name)')
                .eq('id', requestId)
                .single();

            if (error || !request) return;

            const recipientIds = new Set<string>();
            if (request.target_approver_ids && request.target_approver_ids.length > 0) {
                request.target_approver_ids.forEach((id: string) => recipientIds.add(String(id)));
            } else if (request.target_approver_id) {
                recipientIds.add(String(request.target_approver_id));
            }

            // Also find all property admins
            const { data: propMembers } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('property_id', request.property_id)
                .in('role', ['property_admin', 'procurement']);
            
            (propMembers || []).forEach(m => recipientIds.add(String(m.user_id)));

            // Procurement users are stored in organization_memberships, not property_memberships
            if (request.organization_id) {
                const { data: orgMembers } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('user_id, role')
                    .eq('organization_id', request.organization_id)
                    .eq('role', 'procurement');
                
                (orgMembers || []).forEach(m => recipientIds.add(String(m.user_id)));
            }

            const amount = request.total_amount ? `(₹${request.total_amount.toLocaleString()})` : '';

            // Also notify the original requester that their request has been escalated
            if (request.requested_by) {
                await this.send({
                    userId: String(request.requested_by),
                    ticketId: request.ticket_id,
                    propertyId: request.property_id,
                    organizationId: request.organization_id,
                    type: 'MATERIAL_REQUEST_STATUS_CHANGE',
                    title: 'Material Request Escalated ⏳',
                    message: `Your material request ${amount} has been escalated to higher management for approval.`,
                    deepLink: `/procurement?tab=orders`,
                    priority: 'NORMAL',
                });
            }

            // Notify the new target approver(s) and admins that a request was escalated to them for approval
            await this.sendToMany(Array.from(recipientIds), {
                ticketId: request.ticket_id,
                propertyId: request.property_id,
                organizationId: request.organization_id,
                type: 'MATERIAL_REQUEST_PENDING',
                title: 'Material Request Escalated — Approval Needed 📥',
                message: `A material request from ${request.requester?.full_name || 'a team member'} ${amount} has been escalated to you for approval at ${request.properties?.name || 'the property'}. Please review and approve.`,
                deepLink: `/procurement?tab=orders`,
                priority: 'HIGH',
            });
        } catch (err) {
            console.error('[NS] afterMaterialRequestEscalated error:', err);
        }
    }

    static async afterMaterialRequestAssigned(requestId: string) {
        try {
            const { data: request, error } = await supabaseAdmin
                .from('material_requests')
                .select('*, requester:users!material_requests_requested_by_fkey(full_name), properties(name)')
                .eq('id', requestId)
                .single();

            if (error || !request || !request.assignee_uid) return;

            await this.send({
                userId: String(request.assignee_uid),
                ticketId: request.ticket_id,
                propertyId: request.property_id,
                organizationId: request.organization_id,
                type: 'MATERIAL_REQUEST_ASSIGNED',
                title: 'Material Request Approved — Action Required 📦',
                message: `A material request from ${request.requester?.full_name || 'someone'} has been approved and assigned to you for ${request.properties?.name || 'the property'}. Please proceed with ordering.`,
                deepLink: `/procurement?tab=orders`,
                priority: 'HIGH',
            });
        } catch (err) {
            console.error('[NS] afterMaterialRequestAssigned error:', err);
        }
    }

    static async afterMaterialRequestStatusChanged(requestId: string, status: string) {
        try {
            const { data: request, error } = await supabaseAdmin
                .from('material_requests')
                .select('*, properties(name)')
                .eq('id', requestId)
                .single();

            if (error || !request) return;

            const recipientIds = new Set<string>();
            if (request.requested_by) recipientIds.add(String(request.requested_by));
            if (request.assignee_uid) recipientIds.add(String(request.assignee_uid));

            // If ordered/delivered, notify all procurement users and property admins
            if (['ordered', 'delivered'].includes(status)) {
                // 1. Property-level Admins & Procurement
                const { data: propMembers } = await supabaseAdmin
                    .from('property_memberships')
                    .select('user_id')
                    .eq('property_id', request.property_id)
                    .in('role', ['property_admin', 'procurement']);
                
                (propMembers || []).forEach(m => recipientIds.add(String(m.user_id)));

                // 2. Organization-level Procurement
                if (request.organization_id) {
                    const { data: orgMembers } = await supabaseAdmin
                        .from('organization_memberships')
                        .select('user_id')
                        .eq('organization_id', request.organization_id)
                        .eq('role', 'procurement');
                    
                    (orgMembers || []).forEach(m => recipientIds.add(String(m.user_id)));
                }
            }

            const statusMap: Record<string, string> = {
                pending_quotation: 'Pending Quotation ⏳',
                quoted: 'Quoted & Budget Deducted ✅',
                approved: 'Approved ✅',
                rejected: 'Rejected ❌',
                ordered: 'Ordered 📦',
                delivered: 'Delivered/Received 🚚',
                cancelled: 'Cancelled 🚫'
            };

            const statusLabel = statusMap[status] || status.replace('_', ' ');

            for (const userId of Array.from(recipientIds)) {
                await this.send({
                    userId,
                    ticketId: request.ticket_id,
                    propertyId: request.property_id,
                    organizationId: request.organization_id,
                    type: 'MATERIAL_REQUEST_STATUS_CHANGE',
                    title: `Material Request ${statusLabel}`,
                    message: `Material request for ${request.properties?.name || 'the property'} has been marked as ${statusLabel}.`,
                    deepLink: `/procurement?tab=orders`
                });
            }
        } catch (err) {
            console.error('[NotificationService] afterMaterialRequestStatusChanged error:', err);
        }
    }

    private static async getRelevantRecipientsWithRoles(propertyId: string) {
        const { data: members, error } = await supabaseAdmin
            .from('property_memberships')
            .select('user_id, role')
            .eq('property_id', propertyId)
            .in('role', ['mst', 'property_admin', 'security', 'staff', 'tenant']);

        if (error) console.error('[NotificationService] Recipients query error:', error);
        return (members || []).map((m: { user_id: string; role: string }) => ({
            userId: String(m.user_id),
            role: String(m.role)
        }));
    }

    private static async injectAssigneePhone(ticket: any): Promise<void> {
        if (!ticket?.assigned_to || ticket?.assignee?.phone) return;
        const { data } = await supabaseAdmin
            .from('users')
            .select('phone')
            .eq('id', ticket.assigned_to)
            .single();
        if (data?.phone && ticket.assignee) {
            ticket.assignee.phone = data.phone;
        }
    }

    private static buildWhatsAppBody(ticket: any): string {
        const priorityEmoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
        const statusEmoji: Record<string, string> = { open: '📬', assigned: '👷', in_progress: '⚙️', resolved: '✅', closed: '🔒', waitlist: '⏳', blocked: '🚫' };
        return [
            `📋 *${ticket.title}*`,
            ticket.properties?.name ? `🏢 ${ticket.properties.name}` : '',
            ticket.ticket_number ? `🎫 ${ticket.ticket_number}` : '',
            ticket.priority ? `${priorityEmoji[ticket.priority] || '⚪'} Priority: *${ticket.priority.toUpperCase()}*` : '',
            ticket.status ? `${statusEmoji[ticket.status] || '📋'} Status: *${ticket.status.replace(/_/g, ' ').toUpperCase()}*` : '',
            ticket.assignee?.full_name ? `👷 Assigned to: *${ticket.assignee.full_name}*${ticket.assignee.phone ? ` (${ticket.assignee.phone})` : ''}` : '',
            ticket.raiser?.full_name ? `👤 Raised by: *${ticket.raiser.full_name}*` : '',
        ].filter(Boolean).join('\n');
    }

    private static extractMedia(ticket: any): { mediaUrl?: string; mediaType?: 'image' | 'video' } {
        const photo = ticket?.photo_before_url || ticket?.photo_after_url;
        const video = ticket?.video_before_url || ticket?.video_after_url;
        if (photo) return { mediaUrl: photo, mediaType: 'image' };
        if (video) return { mediaUrl: video, mediaType: 'video' };
        return {};
    }

    static async send(payload: NotificationPayload) {
        try {
            const { data: notification, error: notifError } = await supabaseAdmin
                .from('notifications')
                .insert({
                    user_id: payload.userId,
                    ticket_id: payload.ticketId || null,
                    booking_id: payload.bookingId || null,
                    property_id: payload.propertyId,
                    organization_id: payload.organizationId,
                    notification_type: payload.type,
                    title: payload.title,
                    message: payload.message,
                    deep_link: payload.deepLink,
                    is_read: false
                })
                .select()
                .single();

            if (notifError) {
                console.error('[NS] DB insert failed:', notifError.message);
                if (payload.type === 'ROOM_BOOKED') {
                    WhatsAppQueueService.enqueue({
                        ticketId: payload.ticketId ?? '',
                        userIds: [payload.userId],
                        message: payload.whatsapp?.message || `*${payload.title}*\n\n${payload.message}`,
                        mediaUrl: payload.whatsapp?.mediaUrl,
                        mediaType: payload.whatsapp?.mediaType,
                        eventType: payload.type,
                    }).catch(err => console.error('[NS] WhatsApp fallback error:', err));
                }
                return;
            }

            const { data: tokenRows } = await supabaseAdmin
                .from('push_tokens')
                .select('token, browser, updated_at, is_active')
                .eq('user_id', payload.userId)
                .eq('is_active', true)
                .order('updated_at', { ascending: false });

            if (tokenRows?.length) {
                const seenBrowsers = new Set<string>();
                for (const t of tokenRows) {
                    if (t.browser) {
                        if (seenBrowsers.has(t.browser)) continue;
                        seenBrowsers.add(t.browser);
                    }
                    await this.dispatchPushNotification(t.token, notification, payload.priority);
                }
            }

            try {
                let waMessage: string;
                let waMediaUrl: string | undefined;
                let waMediaType: 'image' | 'video' | undefined;

                if (payload.whatsapp) {
                    waMessage = payload.whatsapp.message;
                    waMediaUrl = payload.whatsapp.mediaUrl;
                    waMediaType = payload.whatsapp.mediaType;
                } else if (payload.ticketId) {
                    const { data: ticket } = await supabaseAdmin
                        .from('tickets')
                        .select('title, status, priority, ticket_number, photo_before_url, photo_after_url, video_before_url, video_after_url, properties(name), assignee:users!assigned_to(full_name, phone), raiser:users!raised_by(full_name)')
                        .eq('id', payload.ticketId)
                        .single();
                    if (ticket) {
                        const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
                        const waBody = this.buildWhatsAppBody(ticket);
                        const link = APP_URL && payload.deepLink ? `\n\n🔗 ${APP_URL}${payload.deepLink}` : '';
                        waMessage = `*${payload.title}*\n\n${waBody}${link}`;
                        ({ mediaUrl: waMediaUrl, mediaType: waMediaType } = this.extractMedia(ticket));
                    } else {
                        waMessage = `*${payload.title}*\n\n${payload.message}`;
                    }
                } else {
                    waMessage = `*${payload.title}*\n\n${payload.message}`;
                }

                if (payload.type === 'ROOM_BOOKED') {
                    await WhatsAppQueueService.enqueue({
                        ticketId: payload.ticketId ?? '',
                        userIds: [payload.userId],
                        message: waMessage,
                        mediaUrl: waMediaUrl,
                        mediaType: waMediaType,
                        eventType: payload.type,
                    });
                }
            } catch (err) {
                console.error('[NS] WhatsApp queue error:', err);
            }
        } catch (error) {
            console.error('[NS] Global send error:', error);
        }
    }

    static async sendToMany(userIds: string[], payload: Omit<NotificationPayload, 'userId'>) {
        if (!userIds.length) return;
        const unique = [...new Set(userIds)];
        
        const rows = unique.map(userId => ({
            user_id: userId,
            ticket_id: payload.ticketId || null,
            booking_id: payload.bookingId || null,
            property_id: payload.propertyId,
            organization_id: payload.organizationId,
            notification_type: payload.type,
            title: payload.title,
            message: payload.message,
            deep_link: payload.deepLink,
            is_read: false,
        }));

        const { data: inserted, error: insertErr } = await supabaseAdmin
            .from('notifications')
            .insert(rows)
            .select();

        if (insertErr) {
            console.error('[NS] sendToMany DB insert failed:', insertErr.message);
            // Fallback to WhatsApp so bulk notifications don't silently vanish
            try {
                if (payload.type === 'ROOM_BOOKED') {
                    const waMessage = payload.whatsapp?.message || `*${payload.title}*\n\n${payload.message}`;
                    await WhatsAppQueueService.enqueue({
                        ticketId: payload.ticketId ?? '',
                        userIds: unique,
                        message: waMessage,
                        mediaUrl: payload.whatsapp?.mediaUrl,
                        mediaType: payload.whatsapp?.mediaType,
                        eventType: payload.type,
                    });
                }
            } catch (waErr) {
                console.error('[NS] sendToMany WhatsApp fallback error:', waErr);
            }
            return;
        }

        const { data: tokenRows } = await supabaseAdmin
            .from('push_tokens')
            .select('user_id, token, browser, is_active')
            .in('user_id', unique)
            .eq('is_active', true);

        const notifByUser: Record<string, any> = {};
        for (const n of inserted || []) notifByUser[n.user_id] = n;

        const seenPerUser: Record<string, Set<string>> = {};
        for (const t of tokenRows || []) {
            const uid = t.user_id;
            if (!seenPerUser[uid]) seenPerUser[uid] = new Set();
            if (t.browser && seenPerUser[uid].has(t.browser)) continue;
            if (t.browser) seenPerUser[uid].add(t.browser);

            const notif = notifByUser[uid];
            if (notif) await this.dispatchPushNotification(t.token, notif, payload.priority);
        }

        try {
            if (payload.type === 'ROOM_BOOKED') {
                const waMessage = payload.whatsapp?.message || `*${payload.title}*\n\n${payload.message}`;
                await WhatsAppQueueService.enqueue({
                    ticketId: payload.ticketId ?? '',
                    userIds: unique,
                    message: waMessage,
                    mediaUrl: payload.whatsapp?.mediaUrl,
                    mediaType: payload.whatsapp?.mediaType,
                    eventType: payload.type,
                });
            }
        } catch (err) {
            console.error('[NS] sendToMany WhatsApp queue error:', err);
        }
    }

    static async afterVisitorCheckedIn(visitorLogId: string, propertyId: string, organizationId?: string) {
        try {
            const { data: log } = await supabaseAdmin
                .from('visitor_logs')
                .select('*, host:users!whom_to_meet_uid(id, full_name)')
                .eq('id', visitorLogId)
                .single();

            if (!log) return;

            // Recipient IDs: Security + Property Admin + Host
            const recipientIds = new Set<string>();

            // 1. Get Security and Property Admins
            const { data: members } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id')
                .eq('property_id', propertyId)
                .in('role', ['property_admin', 'security']);

            (members || []).forEach(m => recipientIds.add(String(m.user_id)));

            // 2. Add Host (if UID exists)
            if (log.whom_to_meet_uid) {
                recipientIds.add(String(log.whom_to_meet_uid));
            }

            if (!recipientIds.size) return;

            const hostLabel = log.host?.full_name || log.whom_to_meet || 'someone';

            await this.sendToMany(Array.from(recipientIds), {
                propertyId,
                organizationId,
                type: 'VISITOR_CHECKED_IN',
                title: 'Visitor Arrived 🏢',
                message: `${log.name} has checked in to meet ${hostLabel}.${log.coming_from ? ` Coming from: ${log.coming_from}` : ''}`,
                deepLink: `/property-admin/visitors`,
                priority: 'NORMAL',
            });
        } catch (err) {
            console.error('[NS] afterVisitorCheckedIn error:', err);
        }
    }

    static async afterTicketSLABreached(ticketId: string, slaMinutes: number) {
        try {
            const { data: ticket } = await supabaseAdmin
                .from('tickets')
                .select('id, title, ticket_number, property_id, organization_id, assigned_to, properties(name)')
                .eq('id', ticketId)
                .single();

            if (!ticket) return;

            const { data: members } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id')
                .eq('property_id', ticket.property_id)
                .in('role', ['property_admin']);

            const recipientIds = new Set<string>((members || []).map(m => String(m.user_id)));
            if (ticket.assigned_to) recipientIds.add(String(ticket.assigned_to));

            await this.sendToMany([...recipientIds], {
                ticketId: ticket.id,
                propertyId: ticket.property_id,
                organizationId: ticket.organization_id,
                type: 'SLA_BREACH',
                title: '⚠️ SLA Breached',
                message: `Ticket "${ticket.title}" (${ticket.ticket_number}) has exceeded its ${slaMinutes}-minute SLA at ${(ticket.properties as any)?.name}.`,
                deepLink: `/tickets/${ticket.id}?via=sla`,
                priority: 'CRITICAL',
            });
        } catch (err) {
            console.error('[NS] afterTicketSLABreached error:', err);
        }
    }

    private static async dispatchPushNotification(token: string, notification: any, priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL" = 'NORMAL') {
        const fcmPriority: 'high' | 'normal' = (priority === 'CRITICAL' || priority === 'HIGH') ? 'high' : 'normal';
        const { data: delivery } = await supabaseAdmin
            .from('notification_delivery')
            .insert({
                notification_id: notification.id,
                push_token: token,
                delivery_status: 'PENDING'
            })
            .select()
            .single();

        try {
            const message = {
                token,
                notification: {
                    title: notification.title,
                    body: notification.message,
                },
                data: {
                    notificationId: notification.id,
                    type: notification.notification_type,
                    deepLink: notification.deep_link || '',
                    ticketId: notification.ticket_id || '',
                    bookingId: notification.booking_id || '',
                },
                android: {
                    priority: fcmPriority,
                    notification: {
                        channelId: priority === 'CRITICAL' ? 'emergency' : 'default',
                        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                    },
                },
                apns: {
                    payload: {
                        aps: {
                            sound: priority === 'CRITICAL' ? 'emergency.caf' : 'default',
                            'content-available': 1,
                        },
                    },
                },
            };

            await firebaseAdmin.messaging().send(message);
            if (delivery) {
                await supabaseAdmin
                    .from('notification_delivery')
                    .update({ delivery_status: 'SENT' })
                    .eq('id', delivery.id);
            }
        } catch (error: any) {
            // Suppress the huge stack trace if it's just a sender-id-mismatch (common when testing mobile vs web mismatch)
            if (error?.codePrefix === 'messaging' || error?.message?.includes('SenderId mismatch')) {
                console.warn(`[FCM] Push skipped for ${delivery?.id}: SenderId mismatch (check FIREBASE_PROJECT_ID in .env)`);
            } else {
                console.error('[FCM] Push dispatch failed:', error);
            }
            if (delivery) {
                await supabaseAdmin
                    .from('notification_delivery')
                    .update({ delivery_status: 'FAILED' })
                    .eq('id', delivery.id);
            }
        }
    }

static async afterSOPItemRated(
        completionId: string,
        _completionItemId: string,
        rating: 1 | 2 | 3,
        ratedByUserId: string
    ) {
        try {
            const RATING_LABELS: Record<number, string> = { 1: 'Needs Work', 2: 'Acceptable', 3: 'Excellent' };

            // Fetch the completion (to get who did it and the property/org info)
            const { data: completion, error: completionError } = await supabaseAdmin
                .from('sop_completions')
                .select('completed_by, property_id, organization_id, template:sop_templates(title)')
                .eq('id', completionId)
                .single();

            if (completionError || !completion) {
                console.error('[NotificationService] afterSOPItemRated: could not fetch completion', completionError);
                return;
            }

            const completedBy = String(completion.completed_by);

            // Don't notify the admin if they rated their own entry
            if (completedBy === ratedByUserId) return;

            // Fetch the admin's name
            const { data: rater } = await supabaseAdmin
                .from('users')
                .select('full_name')
                .eq('id', ratedByUserId)
                .single();

            const raterName = rater?.full_name || 'An admin';
            const templateTitle = (completion.template as any)?.title || 'SOP Checklist';
            const ratingLabel = RATING_LABELS[rating];

            await this.send({
                userId: completedBy,
                propertyId: String(completion.property_id),
                organizationId: completion.organization_id ? String(completion.organization_id) : undefined,
                type: 'SOP_RATING',
                title: `Your checklist was rated: ${ratingLabel}`,
                message: `${raterName} rated your completion of "${templateTitle}" as "${ratingLabel}".`,
                deepLink: `/properties/${completion.property_id}/sop?completion=${completionId}`,
            });
        } catch (err) {
            console.error('[NotificationService] afterSOPItemRated error:', err);
        }
    }
    static async afterSOPReminderTriggered(templateId: string, propertyId: string, organizationId?: string, assignedUserIds: string[] = []) {
        try {
            const { data: template } = await supabaseAdmin
                .from('sop_templates')
                .select('title')
                .eq('id', templateId)
                .single();

            if (!template) return;

            let recipientIds = [...assignedUserIds];

            if (!recipientIds.length) {
                // Find all staff, admins, mst in property
                const { data: members } = await supabaseAdmin
                    .from('property_memberships')
                    .select('user_id')
                    .eq('property_id', propertyId)
                    .in('role', ['property_admin', 'staff', 'mst']);
                recipientIds = (members || []).map(m => String(m.user_id));
            }

            if (!recipientIds.length) return;

            await this.sendToMany(recipientIds, {
                propertyId,
                organizationId,
                type: 'SOP_REMINDER',
                title: 'Checklist Reminder 🕒',
                message: `Checklist "${template.title}" is due in 30 minutes. Please ensure it is completed on time.`,
                deepLink: `/properties/${propertyId}/sop`,
                priority: 'HIGH',
            });
        } catch (err) {
            console.error('[NS] afterSOPReminderTriggered error:', err);
        }
    }

    static async afterLeadCreated(leadId: string) {
        try {
            const { data: lead, error } = await supabaseAdmin
                .from('crm_leads')
                .select('*, organization_id, assigned_to, company_name, contact_person, contact_number, requirement, lead_source, campaign')
                .eq('id', leadId)
                .single();

            if (error || !lead) return;

            const orgId = lead.organization_id;
            if (!orgId) return;

            const recipientIds = new Set<string>();
            if (lead.assigned_to) recipientIds.add(String(lead.assigned_to));

            // Add CRM Admins (bd_admin, bd_super_admin, org_admin, org_super_admin)
            const { data: admins } = await supabaseAdmin
                .from('organization_memberships')
                .select('user_id')
                .eq('organization_id', orgId)
                .in('role', ['bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'])
                .eq('is_active', true);
            
            (admins || []).forEach(m => recipientIds.add(String(m.user_id)));

            // Also fetch Saniel's user explicitly if they aren't somehow mapped
            const { data: sanielUsers } = await supabaseAdmin
                .from('users')
                .select('id')
                .eq('email', 'saniel@worksquare.in');
            (sanielUsers || []).forEach(u => recipientIds.add(String(u.id)));

            let assigneeName = 'Unassigned';
            if (lead.assigned_to) {
                const { data: u } = await supabaseAdmin.from('users').select('full_name').eq('id', lead.assigned_to).single();
                if (u?.full_name) assigneeName = u.full_name;
            }

            const sourceName = lead.lead_source || 'Manual/Other';
            const campaignName = lead.campaign || 'Direct';
            
            const waMessage = [
                `🚀 *New Inbound Lead!*`,
                `*Source:* ${sourceName}`,
                `*Campaign:* ${campaignName}`,
                `*Name:* ${lead.contact_person || lead.company_name || 'Unknown'}`,
                `*Phone:* ${lead.contact_number || 'Not provided'}`,
                lead.requirement ? `*Requirement:* ${lead.requirement}` : null,
                `*Assigned Rep:* ${assigneeName}`
            ].filter(Boolean).join('\n');

            await WhatsAppQueueService.enqueue({
                userIds: Array.from(recipientIds),
                message: waMessage,
                eventType: 'CRM_NEW_LEAD',
            });

        } catch (err) {
            console.error('[NS] afterLeadCreated error:', err);
        }
    }
}
