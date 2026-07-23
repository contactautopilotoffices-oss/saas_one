
import os

file_path = r'd:\Projects\saas_one\backend\services\NotificationService.ts'

# 1. Update NotificationPayload interface
def update_interface(content):
    if 'priority?: string;' not in content:
        content = content.replace('deepLink: string;', 'deepLink: string;\n    priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";')
    return content

# 2. Re-insert the methods and update send/sendToMany
# I'll replace the entire class content from afterRoomBooked onwards

def fix_class_methods(content):
    # Find afterRoomBooked end
    # Find getRelevantRecipientsWithRoles start
    # We want to put procurement methods between them
    
    # Actually, let's just replace the whole section from afterRoomBooked to the end of the class
    # but keep afterSOPItemRated if it's at the end.
    
    # Content of the missing methods from history
    IMPROVED_METHODS = """
    static async afterMaterialRequestCreated(requestId: string) {
        try {
            const { data: request, error } = await supabaseAdmin
                .from('material_requests')
                .select('*, requester:users!material_requests_requested_by_fkey(full_name), properties(name)')
                .eq('id', requestId)
                .single();

            if (error || !request) return;

            if (request.target_approver_id) {
                await this.send({
                    userId: String(request.target_approver_id),
                    ticketId: request.ticket_id,
                    propertyId: request.property_id,
                    organizationId: request.organization_id,
                    type: 'MATERIAL_REQUEST_PENDING',
                    title: 'New Material Request to Approve 📥',
                    message: `${request.requester?.full_name || 'Someone'} has requested materials (\\u20b9${request.total_amount?.toLocaleString()}) for ${request.properties?.name || 'the property'}. Tap to review and approve.`,
                    deepLink: `/procurement?tab=approvals`,
                    priority: 'HIGH',
                });
            }
        } catch (err) {
            console.error('[NS] afterMaterialRequestCreated error:', err);
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

            const statusMap: Record<string, string> = {
                approved: 'Approved ✅',
                rejected: 'Rejected ❌',
                ordered: 'Ordered 📦',
                delivered: 'Delivered/Received 🚚'
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
        ].filter(Boolean).join('\\n');
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
            console.log(`[NS] send() → user:${payload.userId} type:${payload.type}`);
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
                WhatsAppQueueService.enqueue({
                    ticketId: payload.ticketId ?? '',
                    userIds: [payload.userId],
                    message: payload.whatsapp?.message || `*${payload.title}*\\n\\n${payload.message}`,
                    mediaUrl: payload.whatsapp?.mediaUrl,
                    mediaType: payload.whatsapp?.mediaType,
                    eventType: payload.type,
                }).catch(err => console.error('[NS] WhatsApp fallback error:', err));
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
                        const APP_URL = (process.env.APP_URL || '').replace(/\\/$/, '');
                        const waBody = this.buildWhatsAppBody(ticket);
                        const link = APP_URL && payload.deepLink ? `\\n\\n🔗 ${APP_URL}${payload.deepLink}` : '';
                        waMessage = `*${payload.title}*\\n\\n${waBody}${link}`;
                        ({ mediaUrl: waMediaUrl, mediaType: waMediaType } = this.extractMedia(ticket));
                    } else {
                        waMessage = `*${payload.title}*\\n\\n${payload.message}`;
                    }
                } else {
                    waMessage = `*${payload.title}*\\n\\n${payload.message}`;
                }

                await WhatsAppQueueService.enqueue({
                    ticketId: payload.ticketId ?? '',
                    userIds: [payload.userId],
                    message: waMessage,
                    mediaUrl: waMediaUrl,
                    mediaType: waMediaType,
                    eventType: payload.type,
                });
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

        if (insertErr) console.error('[NS] sendToMany DB insert failed:', insertErr.message);

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
            const waMessage = payload.whatsapp?.message || `*${payload.title}*\\n\\n${payload.message}`;
            await WhatsAppQueueService.enqueue({
                ticketId: payload.ticketId ?? '',
                userIds: unique,
                message: waMessage,
                mediaUrl: payload.whatsapp?.mediaUrl,
                mediaType: payload.whatsapp?.mediaType,
                eventType: payload.type,
            });
        } catch (err) {
            console.error('[NS] sendToMany WhatsApp queue error:', err);
        }
    }

    static async afterVisitorCheckedIn(visitorId: string, propertyId: string, organizationId?: string) {
        try {
            const { data: visitor } = await supabaseAdmin
                .from('visitors')
                .select('visitor_name, host_name, purpose, checked_in_at')
                .eq('id', visitorId)
                .single();

            if (!visitor) return;

            const { data: members } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id')
                .eq('property_id', propertyId)
                .in('role', ['property_admin', 'security']);

            const recipientIds = (members || []).map(m => String(m.user_id));
            if (!recipientIds.length) return;

            await this.sendToMany(recipientIds, {
                propertyId,
                organizationId,
                type: 'VISITOR_CHECKED_IN',
                title: 'Visitor Arrived 🏢',
                message: `${visitor.visitor_name} has checked in${visitor.host_name ? ` to meet ${visitor.host_name}` : ''}${visitor.purpose ? ` — ${visitor.purpose}` : ''}.`,
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
            console.error('[FCM] Push dispatch failed:', error);
            if (delivery) {
                await supabaseAdmin
                    .from('notification_delivery')
                    .update({ delivery_status: 'FAILED' })
                    .eq('id', delivery.id);
            }
        }
    }
"""
    
    # We want to replace EVERYTHING from getRelevantRecipientsWithRoles onwards
    # and also insert the procurement methods before it.
    
    # But wait, there's afterSOPItemRated at the end.
    
    # Let's find afterSOPItemRated and keep it.
    sop_index = content.find('static async afterSOPItemRated')
    
    # Find start of getRelevantRecipientsWithRoles (the private one)
    # Wait, in the COMMITTED version it's at line 693.
    # We want to replace from line 693 up to sop_index.
    
    start_point = content.find('private static async getRelevantRecipientsWithRoles')
    if start_point == -1:
        # Try without private
        start_point = content.find('static async getRelevantRecipientsWithRoles')
        
    if start_point != -1 and sop_index != -1:
        new_content = content[:start_point] + IMPROVED_METHODS + "\n" + content[sop_index:]
        return new_content
    else:
        print(f"Could not find start_point: {start_point} or sop_index: {sop_index}")
        return content

with open(file_path, 'r', encoding='utf-8') as f:
    full_content = f.read()

full_content = update_interface(full_content)
full_content = fix_class_methods(full_content)

with open(file_path, 'w', encoding='utf-8', newline='') as f:
    f.write(full_content)

print("File reconstructed successfully!")
