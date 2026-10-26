import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppRecipientResolver } from '@/backend/services/WhatsAppRecipientResolver';
import { EmailRecipientResolver } from '@/backend/services/EmailRecipientResolver';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';
import { EmailService } from '@/backend/services/EmailService';

/**
 * GET /api/cron/meeting-room-reminders
 * Runs every minute or 5 minutes.
 * Dispatches automated omnichannel reminders for meeting rooms:
 *   1. Pre-meeting start reminder (e.g. 10 minutes before start_time)
 *   2. Meeting ending soon reminder (e.g. 10 minutes before end_time)
 *
 * Configurable from Omnichannel Notification Matrix:
 *   - reminder_minutes (e.g. 5, 10, 15, 30 mins)
 *   - channels (email, whatsapp, push)
 *   - recipients (notify_requester/booker, attendee_email, roles, specific user_ids)
 */

interface OrgContext {
    organizationId: string;
    matrix: Record<string, any>;
    templates: Record<string, any>;
    timezone: string;
}

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function getTimeInMinutes(timeStr: string): number {
    if (!timeStr) return -1;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return -1;
    return h * 60 + m;
}

function getZonedDateAndMinutes(timezone: string = DEFAULT_TIMEZONE) {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

    const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    const hours = parseInt(getPart('hour'), 10);
    const minutes = parseInt(getPart('minute'), 10);
    const currentMinutes = hours * 60 + minutes;

    return { dateStr, currentMinutes };
}

export async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const summary = {
        organizationsChecked: 0,
        startRemindersSent: 0,
        endRemindersSent: 0,
        errors: [] as string[]
    };

    try {
        const { data: orgSettings, error: orgsErr } = await supabaseAdmin
            .from('organization_settings')
            .select('organization_id, notification_matrix, whatsapp_templates');

        if (orgsErr) {
            console.error('[cron/meeting-room-reminders] Error fetching organization_settings:', orgsErr);
            return NextResponse.json({ error: orgsErr.message }, { status: 500 });
        }

        const orgContexts: OrgContext[] = (orgSettings || []).map((row: any) => ({
            organizationId: row.organization_id,
            matrix: row.notification_matrix || {},
            templates: row.whatsapp_templates || {},
            timezone: DEFAULT_TIMEZONE,
        }));

        summary.organizationsChecked = orgContexts.length;

        for (const ctx of orgContexts) {
            try {
                const mrModule = ctx.matrix.meeting_rooms || {};
                const startRule = mrModule.meeting_room_start_reminder || {
                    enabled: true,
                    channels: { email: true, whatsapp: true, push: true },
                    roles: ['property_admin'],
                    notify_requester: true,
                    reminder_minutes: 10
                };
                const endRule = mrModule.meeting_room_end_reminder || {
                    enabled: true,
                    channels: { email: true, whatsapp: true, push: true },
                    roles: ['property_admin'],
                    notify_requester: true,
                    reminder_minutes: 10
                };

                const startMinutesLead = startRule.reminder_minutes ?? 10;
                const endMinutesLead = endRule.reminder_minutes ?? 10;

                const { dateStr, currentMinutes } = getZonedDateAndMinutes(ctx.timezone);

                // Fetch property names map for this org
                const { data: properties } = await supabaseAdmin
                    .from('properties')
                    .select('id, name')
                    .eq('organization_id', ctx.organizationId);

                const propertyMap = new Map((properties || []).map((p: any) => [p.id, p.name]));
                const propertyIds = Array.from(propertyMap.keys());

                if (propertyIds.length === 0) {
                    continue;
                }

                // Fetch all confirmed bookings for today in this organization (by org id or belonging to org's properties)
                const { data: bookings, error: bookingsErr } = await supabaseAdmin
                    .from('meeting_room_bookings')
                    .select(`
                        id, meeting_room_id, property_id, user_id, booking_date, start_time, end_time,
                        status, comment, attendee_email, start_reminder_sent_at, end_reminder_sent_at,
                        created_at,
                        room:meeting_rooms(name),
                        booker:users!user_id(id, full_name, email, phone)
                    `)
                    .in('property_id', propertyIds)
                    .eq('booking_date', dateStr)
                    .eq('status', 'confirmed');

                if (bookingsErr) {
                    console.error('[cron/meeting-room-reminders] Error fetching bookings:', bookingsErr);
                    summary.errors.push(`Bookings fetch error: ${bookingsErr.message}`);
                    continue;
                }

                if (!bookings || bookings.length === 0) {
                    continue;
                }

                for (const b of bookings) {
                    const startMin = getTimeInMinutes(b.start_time);
                    const endMin = getTimeInMinutes(b.end_time);

                    if (startMin === -1 || endMin === -1) continue;

                    // 1. Process PRE-MEETING START REMINDER
                    if (
                        startRule.enabled !== false &&
                        startMinutesLead > 0 &&
                        !b.start_reminder_sent_at
                    ) {
                        const targetTriggerMin = startMin - startMinutesLead;
                        // Trigger if within the window: current time >= trigger time and before start time
                        if (currentMinutes >= targetTriggerMin && currentMinutes < startMin) {
                            const remaining = Math.max(1, startMin - currentMinutes);
                            const propertyName = propertyMap.get(b.property_id) || 'Your Property';

                            // Check if booking was created very recently (< 2 minutes ago)
                            // If user booked 1 minute ago, they already received immediate booking confirmation
                            const createdAtMs = b.created_at ? new Date(b.created_at).getTime() : 0;
                            const minsSinceCreation = createdAtMs > 0 ? (Date.now() - createdAtMs) / (60 * 1000) : 999;
                            const shouldSuppressDuplicateStartAlert = minsSinceCreation < 2 && remaining <= 2;

                            if (!shouldSuppressDuplicateStartAlert) {
                                await dispatchMeetingReminder({
                                    ctx,
                                    booking: b,
                                    reminderType: 'start',
                                    rule: startRule,
                                    remainingMinutes: remaining,
                                    propertyName
                                });
                                summary.startRemindersSent++;
                            }

                            // Mark as sent so it transitions smoothly into the active meeting without re-evaluating
                            await supabaseAdmin
                                .from('meeting_room_bookings')
                                .update({ start_reminder_sent_at: new Date().toISOString() })
                                .eq('id', b.id);
                        }
                    }

                    // 2. Process MEETING ENDING SOON REMINDER
                    if (
                        endRule.enabled !== false &&
                        endMinutesLead > 0 &&
                        !b.end_reminder_sent_at
                    ) {
                        const targetTriggerMin = endMin - endMinutesLead;
                        // Trigger if within the window: current time >= trigger time and before end time
                        if (currentMinutes >= targetTriggerMin && currentMinutes < endMin) {
                            const remaining = Math.max(1, endMin - currentMinutes);
                            const propertyName = propertyMap.get(b.property_id) || 'Your Property';
                            await dispatchMeetingReminder({
                                ctx,
                                booking: b,
                                reminderType: 'end',
                                rule: endRule,
                                remainingMinutes: remaining,
                                propertyName
                            });
                            await supabaseAdmin
                                .from('meeting_room_bookings')
                                .update({ end_reminder_sent_at: new Date().toISOString() })
                                .eq('id', b.id);
                            summary.endRemindersSent++;
                        }
                    }
                }
            } catch (orgErr: any) {
                console.error(`[cron/meeting-room-reminders] Error processing org ${ctx.organizationId}:`, orgErr);
                summary.errors.push(`${ctx.organizationId}: ${orgErr.message}`);
            }
        }
    } catch (err: any) {
        console.error('[cron/meeting-room-reminders] Fatal cron error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, summary });
}

async function dispatchMeetingReminder({
    ctx,
    booking,
    reminderType,
    rule,
    remainingMinutes,
    propertyName: propNameOverride,
}: {
    ctx: OrgContext;
    booking: any;
    reminderType: 'start' | 'end';
    rule: any;
    remainingMinutes: number;
    propertyName?: string;
}) {
    const isEnd = reminderType === 'end';
    const featureKey = isEnd ? 'meeting_room_end_reminder' : 'meeting_room_start_reminder';

    const roomName = (booking.room as any)?.name || 'Meeting Room';
    const propertyName = propNameOverride || (booking.property as any)?.name || 'Your Property';
    const booker = (booking.booker as any) || {};
    const bookerName = booker.full_name || 'Valued Member';
    const bookerEmail = booker.email || '';
    let bookerPhone = booker.phone ? String(booker.phone).trim() : '';

    if (!bookerPhone && booking.user_id) {
        try {
            const { data: emp } = await supabaseAdmin
                .from('employee_profiles')
                .select('phone')
                .eq('user_id', booking.user_id)
                .maybeSingle();
            if (emp?.phone && String(emp.phone).trim()) {
                bookerPhone = String(emp.phone).trim();
            }
        } catch {
            // ignore
        }
    }

    const formatTime12h = (timeStr: string) => {
        if (!timeStr) return '';
        const [hStr, mStr] = timeStr.split(':');
        let h = parseInt(hStr, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${String(h).padStart(2, '0')}:${mStr} ${ampm}`;
    };

    const formattedStart = formatTime12h(booking.start_time);
    const formattedEnd = formatTime12h(booking.end_time);

    // Channels config from rule
    const channels = rule.channels || { email: true, whatsapp: true, push: true };

    // --- 1. WHATSAPP DISPATCH ---
    if (channels.whatsapp) {
        try {
            const { enabled, users } = await WhatsAppRecipientResolver.resolveRecipients({
                organizationId: ctx.organizationId,
                propertyId: booking.property_id,
                featureKey,
                contextualUserIds: [booking.user_id]
            });

            // Ensure booker is included if notify_requester is active
            const targetUsers = [...(users || [])];
            if (rule.notify_requester !== false && bookerPhone) {
                const cleanPhone = bookerPhone.replace(/[^0-9]/g, '');
                const hasBooker = targetUsers.some(u => {
                    const uClean = String(u.phone).replace(/[^0-9]/g, '');
                    return u.id === booking.user_id || uClean === cleanPhone;
                });
                if (!hasBooker) {
                    targetUsers.push({
                        id: booking.user_id,
                        phone: bookerPhone,
                        name: bookerName
                    });
                }
            }

            if (enabled && targetUsers.length > 0) {
                const defaultCampaign = isEnd ? 'meeting_room_end_reminder_v1' : 'meeting_room_start_reminder_v1';
                const campaignName = ctx.templates[featureKey]?.campaign_name || defaultCampaign;
                const paramKeys = isEnd
                    ? ['user_name', 'room_name', 'property', 'remaining_minutes', 'end_time']
                    : ['user_name', 'room_name', 'property', 'remaining_minutes', 'start_time'];

                const paramMap: Record<string, string> = {
                    room_name: roomName,
                    property: propertyName,
                    remaining_minutes: String(remainingMinutes),
                    start_time: formattedStart,
                    end_time: formattedEnd,
                    booker: bookerName,
                    booker_phone: bookerPhone || 'N/A'
                };

                for (const u of targetUsers) {
                    const recipientName = u.name || bookerName;
                    const finalParams = paramKeys.map((p: string) => {
                        if (p === 'user_name') return recipientName;
                        return paramMap[p] ?? '';
                    });

                    await WhatsAppQueueService.enqueue({
                        organizationId: ctx.organizationId,
                        propertyId: booking.property_id,
                        userIds: u.id ? [u.id] : [],
                        customPhones: !u.id && u.phone ? [u.phone] : [],
                        message: isEnd
                            ? `Meeting ending soon: ${roomName} in ${remainingMinutes} mins`
                            : `Upcoming meeting reminder: ${roomName} starts in ${remainingMinutes} mins`,
                        eventType: isEnd ? 'MEETING_ROOM_END_REMINDER' : 'MEETING_ROOM_START_REMINDER',
                        templateName: campaignName,
                        templateParams: finalParams,
                        entityId: booking.id
                    });
                }
            }
        } catch (waErr) {
            console.error('[cron/meeting-room-reminders] WhatsApp dispatch failed:', waErr);
        }
    }

    // --- 2. EMAIL DISPATCH ---
    if (channels.email) {
        try {
            const attendeeEmails = booking.attendee_email
                ? String(booking.attendee_email).split(/[,;]+/).map((e: string) => e.trim()).filter((e: string) => e.includes('@'))
                : [];

            const contextualEmails = [bookerEmail, ...attendeeEmails].filter(Boolean);

            const { enabled, emails } = await EmailRecipientResolver.resolveRecipients({
                organizationId: ctx.organizationId,
                propertyId: booking.property_id,
                featureKey,
                contextualEmails
            });

            if (enabled) {
                const allEmails = Array.from(new Set([...emails, ...contextualEmails]));
                for (const to of allEmails) {
                    await EmailService.sendMeetingRoomReminderEmail({
                        emailTo: to,
                        roomName,
                        date: booking.booking_date,
                        startTime: booking.start_time,
                        endTime: booking.end_time,
                        propertyName,
                        requesterName: bookerName,
                        requesterEmail: bookerEmail,
                        reminderType,
                        remainingMinutes,
                        comment: booking.comment || null
                    });
                }
            }
        } catch (emailErr) {
            console.error('[cron/meeting-room-reminders] Email dispatch failed:', emailErr);
        }
    }

    // --- 3. IN-APP / PUSH NOTIFICATION DISPATCH ---
    if (channels.push) {
        try {
            const title = isEnd
                ? `Meeting Ending Soon: ${roomName}`
                : `Upcoming Meeting: ${roomName}`;
            const message = isEnd
                ? `Your meeting in ${roomName} is concluding in ${remainingMinutes} minutes (${formattedEnd}). Please wrap up on time.`
                : `Your meeting in ${roomName} starts in ${remainingMinutes} minutes (${formattedStart}).`;

            const pushUserIds = Array.from(new Set([
                ...(rule.notify_requester !== false && booking.user_id ? [booking.user_id] : []),
                ...(rule.user_ids || [])
            ]));

            for (const uid of pushUserIds) {
                await supabaseAdmin.from('notifications').insert({
                    user_id: uid,
                    organization_id: ctx.organizationId,
                    property_id: booking.property_id,
                    notification_type: featureKey,
                    title,
                    message,
                    deep_link: `/dashboard/meeting-rooms`,
                    is_read: false
                });
            }
        } catch (pushErr) {
            console.error('[cron/meeting-room-reminders] Push dispatch failed:', pushErr);
        }
    }
}
