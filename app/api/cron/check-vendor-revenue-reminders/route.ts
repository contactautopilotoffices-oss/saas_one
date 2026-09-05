import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppEventProcessor, formatWhatsAppDate, formatTimeString } from '@/backend/services/WhatsAppEventProcessor';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';
import { VoiceCallingService } from '@/backend/services/VoiceCallingService';

const LOCAL_TIMEZONE = 'Asia/Kolkata';

/** Helper: converts "HH:MM" (e.g. "18:00") into minutes from midnight */
function parseTimeToMinutes(timeStr?: string | null): number {
    if (!timeStr || !timeStr.includes(':')) return 18 * 60; // Default: 18:00 (6:00 PM IST)
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 18 * 60;
    return h * 60 + m;
}

/**
 * GET /api/cron/check-vendor-revenue-reminders
 * Runs periodically (e.g. every 5-15 mins) via Vercel Cron or pg_cron.
 * 
 * Flow:
 * 1. Reads dynamic `schedule_time` configured per organization in Omnichannel Notification Settings UI.
 * 2. Checks current time in IST against the UI-selected cutoff time.
 * 3. Identifies active food vendors who have NOT submitted daily revenue for today.
 * 4. Dispatches WhatsApp reminder (AiSensy/Meta template) and Automated Voice Phone Call (Plivo/Bolna AI).
 * 5. Records event in `public.event_outbox` with strict daily deduplication.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date();

        // 1. Calculate current IST date and time components
        const istFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: LOCAL_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const parts = istFormatter.formatToParts(now);
        const partMap: Record<string, string> = {};
        parts.forEach(p => { partMap[p.type] = p.value; });

        const dateKey = `${partMap.year}-${partMap.month}-${partMap.day}`; // YYYY-MM-DD in IST
        const currentHour = parseInt(partMap.hour, 10);
        const currentMinute = parseInt(partMap.minute, 10);
        const currentMins = currentHour * 60 + currentMinute;
        const formattedDateIST = formatWhatsAppDate(now);
        const startOfTodayIST = new Date(`${dateKey}T00:00:00+05:30`).toISOString();

        // 2. Fetch all organization settings to evaluate custom schedule_time per org
        const { data: orgSettings, error: orgsErr } = await supabaseAdmin
            .from('organization_settings')
            .select('organization_id, notification_matrix, whatsapp_service_config, whatsapp_templates');

        if (orgsErr) throw orgsErr;

        let totalReminded = 0;
        let totalChecked = 0;
        const orgResults: any[] = [];

        for (const orgRow of orgSettings || []) {
            const orgId = orgRow.organization_id;
            const matrix = (orgRow.notification_matrix as any) || {};
            const waConfig = (orgRow.whatsapp_service_config as any) || {};

            // Dynamic rule from Omnichannel UI
            const reminderRule = 
                matrix?.cafeteria_revenue?.vendor_revenue_reminder || 
                matrix?.vendor_revenue?.vendor_revenue_reminder ||
                waConfig?.vendor_revenue_reminder || 
                {};

            // Check if reminder is enabled in channels (default is true if channels not explicitly turned off)
            const channels = reminderRule.channels || { whatsapp: true, email: false, push: true, voice: false };
            const isAnyChannelOn = channels.whatsapp || channels.voice || channels.email || channels.push;
            
            if (reminderRule.enabled === false || !isAnyChannelOn) {
                continue; // Skipped by org config
            }

            // DYNAMIC TIMING: Read schedule_time configured from UI (e.g. "18:00" / "19:30" / "17:00")
            const configuredCutoffTime = reminderRule.schedule_time || '18:00';
            const cutoffMinutes = parseTimeToMinutes(configuredCutoffTime);

            // If current time in IST has NOT yet reached the UI-configured cutoff time, skip for now
            if (currentMins < cutoffMinutes) {
                continue;
            }

            const formattedCutoffLabel = formatTimeString(configuredCutoffTime);

            // 3. Fetch properties belonging to this organization
            const { data: properties } = await supabaseAdmin
                .from('properties')
                .select('id, name')
                .eq('organization_id', orgId);

            if (!properties || properties.length === 0) continue;
            const propertyIds = properties.map(p => p.id);
            const propMap = new Map(properties.map(p => [p.id, p.name]));

            // 4. Fetch all active vendors for these properties
            const { data: vendors, error: vendorsErr } = await supabaseAdmin
                .from('vendors')
                .select('id, shop_name, owner_name, property_id, user_id, commission_rate, status')
                .in('property_id', propertyIds)
                .neq('status', 'inactive')
                .neq('status', 'suspended');

            if (vendorsErr || !vendors || vendors.length === 0) continue;
            totalChecked += vendors.length;

            const vendorIds = vendors.map(v => v.id);

            // 5. Fetch revenues logged today for these vendors
            const { data: todayRevenues } = await supabaseAdmin
                .from('vendor_daily_revenue')
                .select('vendor_id, revenue_amount')
                .in('vendor_id', vendorIds)
                .or(`revenue_date.eq.${dateKey},entry_date.eq.${dateKey}`);

            const submittedVendorIds = new Set((todayRevenues || []).map(r => r.vendor_id));

            // 6. Find vendors who have NOT submitted revenue today
            const pendingVendors = vendors.filter(v => !submittedVendorIds.has(v.id));
            if (pendingVendors.length === 0) continue;

            // 7. Check existing reminders sent today for deduplication
            const [queueRes, callLogsRes] = await Promise.all([
                supabaseAdmin
                    .from('whatsapp_queue')
                    .select('entity_id, event_type')
                    .eq('organization_id', orgId)
                    .eq('event_type', 'VENDOR_REVENUE_REMINDER')
                    .gte('created_at', startOfTodayIST),
                supabaseAdmin
                    .from('omnichannel_call_logs')
                    .select('recipient_phone, event_type')
                    .eq('event_type', 'VENDOR_REVENUE_REMINDER')
                    .gte('created_at', startOfTodayIST)
            ]);

            const remindedEntityIds = new Set((queueRes.data || []).map(q => q.entity_id));
            const calledPhones = new Set((callLogsRes.data || []).map(c => c.recipient_phone));

            // Fetch vendor user profiles (phone & name)
            const userIds = pendingVendors.map(v => v.user_id).filter(Boolean);
            const { data: usersData } = await supabaseAdmin
                .from('users')
                .select('id, phone, full_name')
                .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

            const userMap = new Map((usersData || []).map(u => [u.id, u]));

            for (const vendor of pendingVendors) {
                // Deduplicate: Don't remind the same vendor twice on the same date
                const entityDedupeKey = `${vendor.id}_${dateKey}`;
                if (remindedEntityIds.has(entityDedupeKey) || remindedEntityIds.has(vendor.id)) {
                    continue;
                }

                const propertyName = propMap.get(vendor.property_id) || 'Property';
                const userObj = vendor.user_id ? userMap.get(vendor.user_id) : null;
                const recipientPhone = userObj?.phone;
                const recipientName = userObj?.full_name || vendor.owner_name || 'Vendor Partner';
                const shopName = vendor.shop_name || 'Food Stall';

                const directUploadUrl = `https://fms-dev-saas-one.vercel.app/properties/${vendor.property_id}/vendor-revenue`;

                // A. Dispatch WhatsApp Reminder via Meta Template
                if (channels.whatsapp && recipientPhone) {
                    const templateName = 'vendor_revenue_reminder_v1';
                    const templateParams = [
                        recipientName,
                        shopName,
                        propertyName,
                        formattedDateIST,
                        vendor.property_id // Dynamic CTA button URL suffix ({{5}})
                    ];

                    const summaryMessage = `⏰ *Daily Revenue Reminder*\nHello ${recipientName},\nThis is a reminder that daily sales revenue for *${shopName}* at *${propertyName}* has not been submitted for today (${formattedDateIST}). Please enter your today's total revenue in the vendor portal to ensure timely commission settlement.\n\nSubmit: ${directUploadUrl}`;

                    await WhatsAppQueueService.enqueue({
                        userIds: userObj ? [userObj.id] : [],
                        customPhones: !userObj && recipientPhone ? [recipientPhone] : undefined,
                        message: summaryMessage,
                        eventType: 'VENDOR_REVENUE_REMINDER',
                        entityId: entityDedupeKey,
                        organizationId: orgId,
                        templateName: templateName,
                        templateParams: templateParams
                    });
                }

                // B. Dispatch Automated Voice Phone Call (Plivo / Bolna AI) if Voice channel is enabled
                if (channels.voice && recipientPhone && !calledPhones.has(VoiceCallingService.formatPhone(recipientPhone))) {
                    try {
                        const voiceScript = (reminderRule.voice_template || "Hi {{user_name}}, this is Pratiksha from the Operations team. This is a quick reminder that today's revenue for {{shop_name}} at {{property_name}} has not been recorded yet. Please open the AutoPilot app and submit your sales figures before the day ends.")
                            .replace(/\{\{user_name\}\}/g, recipientName)
                            .replace(/\{\{shop_name\}\}/g, shopName)
                            .replace(/\{\{property_name\}\}/g, propertyName)
                            .replace(/\{\{cutoff_time\}\}/g, formattedCutoffLabel);

                        await VoiceCallingService.triggerCall({
                            recipientPhone,
                            organizationId: orgId,
                            propertyId: vendor.property_id,
                            recipientName,
                            eventType: 'VENDOR_REVENUE_REMINDER',
                            customTemplate: voiceScript,
                            voiceId: reminderRule.voice_id || 'Polly.Aditi',
                            speechSpeed: reminderRule.speech_speed || '1.0',
                            variables: {
                                userName: recipientName,
                                shop_name: shopName,
                                property_name: propertyName,
                                cutoff_time: formattedCutoffLabel
                            }
                        });
                    } catch (voiceErr: any) {
                        console.error(`[Vendor Revenue Cron] Voice call failed for vendor ${vendor.id}:`, voiceErr);
                    }
                }

                // C. Enqueue into public.event_outbox
                const outboxPayload = {
                    vendor_id: vendor.id,
                    property_id: vendor.property_id,
                    organization_id: orgId,
                    property_name: propertyName,
                    shop_name: shopName,
                    owner_name: vendor.owner_name,
                    vendor_name: recipientName,
                    vendor_phone: recipientPhone,
                    revenue_date: dateKey,
                    configured_cutoff_time: configuredCutoffTime,
                    direct_url: directUploadUrl
                };

                await supabaseAdmin.from('event_outbox').insert({
                    event_type: 'VENDOR_REVENUE_REMINDER',
                    entity_id: vendor.id,
                    payload: outboxPayload,
                    status: 'completed' // Handled directly in cron
                });

                totalReminded++;
            }

            // 8. Dispatch Consolidated Pending Revenue Team Digest to Property Admin / Accounts / Super Admin
            const digestRule = matrix?.cafeteria_revenue?.vendor_revenue_pending_digest || {};
            const isDigestOn = digestRule?.enabled !== false && (digestRule?.channels?.whatsapp !== false);

            if (isDigestOn && pendingVendors.length > 0) {
                // Group pending vendors by property to send clear site-specific summaries
                for (const prop of properties) {
                    const propVendors = vendors.filter(v => v.property_id === prop.id);
                    const propPending = pendingVendors.filter(v => v.property_id === prop.id);
                    if (propPending.length === 0) continue;

                    const digestDedupeKey = `digest_${prop.id}_${dateKey}`;
                    if (remindedEntityIds.has(digestDedupeKey)) continue;

                    const submittedCount = propVendors.length - propPending.length;
                    const pendingLines = propPending.map(v => `• ${v.shop_name || 'Stall'} (${v.owner_name || 'Vendor'})`).join('\n');

                    // Dispatch via WhatsAppEventProcessor
                    await WhatsAppEventProcessor.handleVendorRevenuePendingDigest({
                        organization_id: orgId,
                        property_id: prop.id,
                        property_name: prop.name,
                        date: formattedDateIST,
                        total_vendors: propVendors.length,
                        submitted_count: submittedCount,
                        pending_count: propPending.length,
                        pending_list: pendingLines
                    });

                    // Mark completed in outbox
                    await supabaseAdmin.from('event_outbox').insert({
                        event_type: 'VENDOR_REVENUE_PENDING_DIGEST',
                        entity_id: prop.id,
                        payload: {
                            organization_id: orgId,
                            property_id: prop.id,
                            property_name: prop.name,
                            date: dateKey,
                            total_vendors: propVendors.length,
                            submitted_count: submittedCount,
                            pending_count: propPending.length,
                            pending_list: pendingLines
                        },
                        status: 'completed'
                    });
                }
            }

            orgResults.push({
                orgId,
                configuredCutoffTime,
                pendingVendorsCount: pendingVendors.length
            });
        }

        return NextResponse.json({
            success: true,
            current_time_ist: `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`,
            total_checked_vendors: totalChecked,
            total_reminders_dispatched: totalReminded,
            orgs: orgResults
        });

    } catch (err: any) {
        console.error('[Vendor Revenue Cron] Error checking revenue reminders:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
