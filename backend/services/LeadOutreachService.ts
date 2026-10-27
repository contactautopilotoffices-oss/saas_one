import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveDistributionAssignee } from '@/backend/lib/crm/distribution';
import { getCityCentrePhoto } from '@/backend/lib/crm/centreMedia';
import { CampaignOutreachConfigService } from './CampaignOutreachConfigService';
import { AiSensyService } from './AiSensyService';
import { WhatsAppService } from './WhatsAppService';
import { NotificationService } from './NotificationService';
import { LeadSlaEscalationService } from './LeadSlaEscalationService';

export interface LeadFollowupResult {
    success: boolean;
    channel: 'whatsapp' | 'sms' | 'none';
    skipped?: string;
    nurture?: boolean;
    error?: string;
    messageId?: string;
}

export class LeadOutreachService {
    /**
     * Standardizes phone numbers to include country code (default 91 for India).
     */
    static formatPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 10) return '91' + digits;
        return digits;
    }

    /**
     * Extracts last 10 digits for matching regardless of country code prefix (+91, 0, 91).
     */
    static get10DigitPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        return digits.slice(-10);
    }

    /**
     * Determines whether current IST time is after business hours (after 7 PM, before 9 AM, or Sunday).
     */
    static isAfterHours(now = new Date()): boolean {
        // IST is UTC + 5:30
        const istOffsetMs = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(now.getTime() + istOffsetMs);
        const istHour = istDate.getUTCHours();
        const istDay = istDate.getUTCDay(); // 0 is Sunday

        return istHour >= 19 || istHour < 9 || istDay === 0;
    }

    /**
     * Safe logger for crm_activity_log / crm_lead_activities.
     */
    private static async logActivity(params: {
        leadId: string;
        userId?: string | null;
        activityType: 'whatsapp_sent' | 'whatsapp_received' | 'sms_sent' | 'note_added' | string;
        description: string;
        metadata?: Record<string, any>;
    }): Promise<void> {
        const { leadId, userId, activityType, description, metadata = {} } = params;

        const payload: Record<string, any> = {
            lead_id: leadId,
            user_id: userId || null,
            activity_type: activityType,
            description,
            metadata: { ...metadata, logged_at: new Date().toISOString() },
        };

        const { error: err1 } = await supabaseAdmin.from('crm_activity_log').insert(payload);
        if (err1) {
            // Graceful fallback to note_added if check constraint is pending
            const fallbackPayload = {
                ...payload,
                activity_type: 'note_added',
                metadata: {
                    ...payload.metadata,
                    intended_activity_type: activityType,
                    fallback: true,
                },
            };
            const { error: err2 } = await supabaseAdmin.from('crm_activity_log').insert(fallbackPayload);
            if (err2) {
                console.error('[LeadOutreachService] Failed to log activity:', err2);
            }
        }
    }

    /**
     * Trigger automated lead outreach upon successful lead creation (from Meta, LinkedIn, or manual intake).
     * Implements pre-dispatch city round robin, deduplication against CRM, business hours variant,
     * centre photo header, and under-20 seat nurture routing.
     */
    static async sendLeadFollowupOutreach(leadId: string): Promise<LeadFollowupResult> {
        try {
            const { data: lead, error } = await supabaseAdmin
                .from('crm_leads')
                .select(`
                    id,
                    organization_id,
                    company_name,
                    contact_person,
                    contact_number,
                    email,
                    city,
                    location,
                    seats,
                    move_in_timeline,
                    requirement,
                    assigned_to,
                    created_by,
                    property_interest,
                    lead_source,
                    campaign
                `)
                .eq('id', leadId)
                .single();

            if (error || !lead) {
                console.error(`[LeadOutreachService] Lead not found: ${leadId}`, error);
                return { success: false, channel: 'none', error: 'Lead not found' };
            }

            if (!lead.contact_number) {
                console.info(`[LeadOutreachService] No phone number for lead ${leadId}, skipping outreach`);
                return { success: false, channel: 'none', error: 'No contact number' };
            }

            const raw10Phone = this.get10DigitPhone(lead.contact_number);
            const formattedPhone = this.formatPhone(lead.contact_number);
            if (formattedPhone.length < 11) {
                console.warn(`[LeadOutreachService] Invalid phone number: ${lead.contact_number} for lead ${leadId}`);
                return { success: false, channel: 'none', error: 'Invalid phone number' };
            }

            // 1. DEDUPLICATION: Check if this phone number already exists in CRM
            const { data: existingLeads } = await supabaseAdmin
                .from('crm_leads')
                .select('id, assigned_to, contact_person, company_name, assignee:users!assigned_to(id, full_name, phone)')
                .ilike('contact_number', `%${raw10Phone}%`)
                .neq('id', leadId)
                .eq('is_archived', false)
                .order('created_at', { ascending: false })
                .limit(1);

            const isTestClientPhone = raw10Phone === '7028232515';
            if (!isTestClientPhone && existingLeads && existingLeads.length > 0) {
                const existingLead = existingLeads[0];
                const existingAssignee: any = existingLead.assignee;
                console.info(`[LeadOutreachService] 🔄 Existing lead found (${existingLead.id}) for phone ${raw10Phone}. Alerting existing owner.`);

                // Alert the existing BD relationship owner directly
                if (existingAssignee?.phone) {
                    const alertMsg = `⚡ *Repeat Lead Enquiry!*
Client: ${lead.contact_person || lead.company_name} (${formattedPhone})
City: ${lead.city || 'Not specified'}
Enquiry: ${lead.requirement || 'New workspace enquiry via ad form'}

This client is already in your pipeline (Lead ID: ${existingLead.id}). Skipping generic welcome message. Please reach out to them directly.`;

                    WhatsAppService.sendAsync(existingAssignee.phone, {
                        message: alertMsg,
                        moduleName: 'crm',
                    }).catch(e => console.error('[LeadOutreachService] Existing owner alert error:', e));
                }

                await this.logActivity({
                    leadId: lead.id,
                    userId: existingLead.assigned_to || null,
                    activityType: 'whatsapp_sent',
                    description: `Existing CRM lead enquiry detected; alerted original advisor (${existingAssignee?.full_name || 'BD rep'}).`,
                    metadata: { duplicate_of: existingLead.id, channel: 'whatsapp' },
                });

                return { success: true, channel: 'none', skipped: 'existing_crm_lead' };
            }

            // 2. SMALL LEADS PATH (< 20 seats)
            // If lead requirement is under 20 seats, route to digital nurture flow rather than senior BD calling time
            if (lead.seats && Number(lead.seats) < 20) {
                console.info(`[LeadOutreachService] Lead ${leadId} requires ${lead.seats} seats (< 20). Routing to digital nurture.`);
                await supabaseAdmin
                    .from('crm_leads')
                    .update({ is_smb_nurture: true })
                    .eq('id', lead.id);

                return await this.sendSmallLeadNurture(lead, formattedPhone);
            }

            // 3. CAMPAIGN OUTREACH SWITCH & PROPERTY SHOWCASE CHECK (Bangalore Pilot / Campaign Controls)
            const outreachConfig = await CampaignOutreachConfigService.isOutreachEnabledForLead({
                organization_id: lead.organization_id,
                campaign: lead.campaign,
                city: lead.city,
                location: lead.location,
                contact_number: lead.contact_number,
            });

            if (!outreachConfig.enabled) {
                console.info(`[LeadOutreachService] ⏸️ Outreach paused/disabled for campaign '${outreachConfig.matchedCampaign}'. Skipping automated WhatsApp dispatch.`);
                await this.logActivity({
                    leadId: lead.id,
                    activityType: 'note_added',
                    description: `Automated WhatsApp outreach paused for campaign '${outreachConfig.matchedCampaign}'.`,
                    metadata: { campaign: outreachConfig.matchedCampaign, outreach_enabled: false },
                });
                return { success: true, channel: 'none', skipped: 'campaign_outreach_disabled' };
            }

            // 4. PRE-DISPATCH ADVISOR ASSIGNMENT
            let assignedUserId = lead.assigned_to;
            const isBangalore = (lead.city || '').toLowerCase().includes('bangalore') ||
                (lead.city || '').toLowerCase().includes('bengaluru') ||
                (lead.campaign || '').toLowerCase().includes('bangalore') ||
                (lead.campaign || '').toLowerCase().includes('bengaluru') ||
                (outreachConfig.city || '').toLowerCase().includes('bangalore') ||
                (outreachConfig.city || '').toLowerCase().includes('bengaluru');

            if (outreachConfig.advisorId) {
                assignedUserId = outreachConfig.advisorId;
                await supabaseAdmin
                    .from('crm_leads')
                    .update({ assigned_to: assignedUserId })
                    .eq('id', lead.id);
            } else if (!assignedUserId && lead.organization_id) {
                assignedUserId = await resolveDistributionAssignee(
                    lead.organization_id,
                    lead.campaign,
                    lead.city || lead.location
                );
                if (assignedUserId) {
                    await supabaseAdmin
                        .from('crm_leads')
                        .update({ assigned_to: assignedUserId })
                        .eq('id', lead.id);
                }
            }

            // Fetch assigned advisor details
            let advisorName = outreachConfig.advisorName || 'Our Workspace Specialist';
            if (!outreachConfig.advisorName && assignedUserId) {
                const { data: advisorUser } = await supabaseAdmin
                    .from('users')
                    .select('full_name, phone')
                    .eq('id', assignedUserId)
                    .maybeSingle();

                if (advisorUser?.full_name) {
                    advisorName = advisorUser.full_name;
                }
            }

            // 5. BUSINESS HOURS & TEMPLATE SELECTION
            const afterHours = this.isAfterHours();
            const variant = 'variant_a';

            // Safely store variant if column exists
            try {
                await supabaseAdmin
                    .from('crm_leads')
                    .update({ outreach_variant: variant })
                    .eq('id', lead.id);
            } catch {}

            // Campaign selection: After-hours has "Tomorrow Morning", daytime has "Call me now"
            let campaignName: string;
            if (afterHours) {
                campaignName = process.env.AISENSY_LEAD_AFTERHOURS_CAMPAIGN || 'autopilot_lead_afterhours_v1';
            } else if (process.env.AISENSY_LEAD_VARIANT_B_CAMPAIGN) {
                campaignName = process.env.AISENSY_LEAD_VARIANT_B_CAMPAIGN;
            } else {
                campaignName = process.env.AISENSY_LEAD_FOLLOWUP_CAMPAIGN || 'autopilot_lead_outreach_v1';
            }

            // Clean template variables (Meta Hygiene: no leading/trailing variables, fallback "there")
            const firstName = (lead.contact_person || '').trim().split(' ')[0] || 'there';
            const city = outreachConfig.city || lead.city || lead.location || (isBangalore ? 'Bangalore' : 'Mumbai');
            const headerPhoto = outreachConfig.propertyPhotoUrl || getCityCentrePhoto(city);

            console.info(`[LeadOutreachService] Dispatching Message 1 (${campaignName}) to ${firstName} in ${city} via Advisor ${advisorName}`);

            // 6. DISPATCH VIA AISENSY / WHATSAPP CLOUD API
            const waRes = await AiSensyService.sendTemplate({
                phone: formattedPhone,
                campaignName,
                templateParams: [
                    firstName,
                    city,
                    advisorName,
                ],
                userName: firstName,
                mediaUrl: headerPhoto,
                mediaFilename: `${city.toLowerCase()}_centre.jpg`,
            });

            if (waRes.success) {
                await this.logActivity({
                    leadId: lead.id,
                    userId: assignedUserId || lead.created_by || null,
                    activityType: 'whatsapp_sent',
                    description: `Message 1 sent to lead via WhatsApp (Campaign: ${campaignName}, Advisor: ${advisorName}, Header: ${city} Centre)`,
                    metadata: {
                        channel: 'whatsapp',
                        campaign: campaignName,
                        variant,
                        after_hours: afterHours,
                        advisor_name: advisorName,
                        phone: formattedPhone,
                        header_image: headerPhoto,
                        provider_reference: waRes.providerReference,
                    },
                });

                return { success: true, channel: 'whatsapp', messageId: waRes.providerReference };
            }

            // Fallback: SMS
            console.warn(`[LeadOutreachService] WhatsApp dispatch failed: ${waRes.error}. Attempting SMS fallback.`);
            const smsRes = await this.sendSmsFallback(lead, formattedPhone, advisorName);

            if (smsRes.success) {
                await this.logActivity({
                    leadId: lead.id,
                    userId: assignedUserId || lead.created_by || null,
                    activityType: 'sms_sent',
                    description: `Message 1 sent to lead via SMS fallback (Advisor: ${advisorName})`,
                    metadata: {
                        channel: 'sms',
                        phone: formattedPhone,
                        reason: waRes.error,
                    },
                });
                return { success: true, channel: 'sms' };
            }

            return {
                success: false,
                channel: 'none',
                error: `WhatsApp failed (${waRes.error}); SMS fallback (${smsRes.error})`,
            };
        } catch (err: any) {
            console.error('[LeadOutreachService] Unexpected error during lead outreach:', err);
            return { success: false, channel: 'none', error: err?.message || 'Internal error' };
        }
    }

    /**
     * Digital nurture flow for SMB / under 20-seat inquiries:
     * Dispatches centre brochure and pricing calculator link.
     */
    private static async sendSmallLeadNurture(lead: any, formattedPhone: string): Promise<LeadFollowupResult> {
        const campaignName = process.env.AISENSY_LEAD_NURTURE_CAMPAIGN || 'autopilot_lead_smb_nurture_v1';
        const firstName = (lead.contact_person || '').trim().split(' ')[0] || 'there';
        const city = lead.city || 'Bangalore';
        const headerPhoto = getCityCentrePhoto(city);

        const waRes = await AiSensyService.sendTemplate({
            phone: formattedPhone,
            campaignName,
            templateParams: [firstName, city],
            userName: firstName,
            mediaUrl: headerPhoto,
            mediaFilename: 'autopilot_centres.jpg',
        });

        await this.logActivity({
            leadId: lead.id,
            userId: lead.assigned_to || null,
            activityType: 'whatsapp_sent',
            description: `Automated digital nurture sent for <20 seats requirement.`,
            metadata: { channel: 'whatsapp', campaign: campaignName, nurture: true },
        });

        return { success: waRes.success, channel: 'whatsapp', nurture: true };
    }

    /**
     * Checks whether an incoming phone number belongs to an active prospective CRM lead.
     */
    static async isLeadPhone(phone: string): Promise<boolean> {
        try {
            const tenDigits = this.get10DigitPhone(phone);
            if (!tenDigits || tenDigits.length < 10) return false;

            const { data } = await supabaseAdmin
                .from('crm_leads')
                .select('id')
                .ilike('contact_number', `%${tenDigits}%`)
                .eq('is_archived', false)
                .order('created_at', { ascending: false })
                .limit(1);

            return (data || []).length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Handles an inbound WhatsApp reply or button tap from a prospective lead:
     * - Button "Call me now": Urgent rep alert, 10-minute SLA countdown armed, sends Message 2
     * - Button "First thing tomorrow" / "Later today" / "Tomorrow": Creates call task, sends confirmation + advisor card, sends Message 2
     * - Team size list picker: Updates seats, notifies rep
     */
    static async handleInboundLeadReply(params: {
        phone: string;
        text: string;
        messageId?: string;
    }): Promise<{ handled: boolean; leadId?: string; action?: string }> {
        const { phone, text, messageId } = params;
        const clean = text.trim();

        // Bypass internal task manager commands
        if (/^(tasks?|my tasks|done \d+|cancel|status)$/i.test(clean)) {
            return { handled: false };
        }

        const tenDigits = this.get10DigitPhone(phone);
        if (!tenDigits || tenDigits.length < 10) return { handled: false };

        try {
            // Find most recent active lead for this phone
            const { data: lead, error } = await supabaseAdmin
                .from('crm_leads')
                .select(`
                    id,
                    organization_id,
                    company_name,
                    contact_person,
                    contact_number,
                    assigned_to,
                    created_by,
                    city,
                    location,
                    seats,
                    property_interest,
                    status,
                    followup_notes,
                    assignee:users!assigned_to(id, full_name, phone)
                `)
                .ilike('contact_number', `%${tenDigits}%`)
                .eq('is_archived', false)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error || !lead) {
                return { handled: false };
            }

            console.info(`[LeadOutreachService] Inbound WhatsApp response: "${clean}" from Lead: ${lead.id}`);

            const clientName = lead.contact_person || lead.company_name || 'Client';
            const rep: any = lead.assignee;
            const advisorName = rep?.full_name || 'Our Workspace Advisor';
            const advisorPhone = rep?.phone || '+91 98205 25108';

            const lower = clean.toLowerCase();

            // ── ACTION 1: "Call me now" (or "1" / Instant Call request) ──────────────────
            if (lower.includes('call me now') || lower === 'call now' || lower === '1') {
                const nowIso = new Date().toISOString();

                // 1. Update lead state
                await supabaseAdmin
                    .from('crm_leads')
                    .update({
                        priority: 'High',
                        outreach_button_tapped: 'Call me now',
                        outreach_tapped_at: nowIso,
                        last_contacted: nowIso,
                        followup_notes: `[Lead tapped "Call me now" at ${new Date().toLocaleTimeString()}]: Requires immediate call (5m SLA).`,
                    })
                    .eq('id', lead.id);

                // 2. Arm 10-minute SLA countdown timer
                await LeadSlaEscalationService.armCallNowSla({
                    leadId: lead.id,
                    assignedTo: lead.assigned_to,
                });

                // 3. Log activity
                await this.logActivity({
                    leadId: lead.id,
                    userId: lead.assigned_to || null,
                    activityType: 'whatsapp_received',
                    description: `Client tapped "Call me now" on WhatsApp. 10-minute call SLA armed.`,
                    metadata: { action: 'call_me_now', raw_message_id: messageId },
                });

                // 4. Urgent WhatsApp alert to assigned rep
                if (rep?.phone) {
                    const alertMsg = `🚨 *HOT LEAD ALERT — CALL NOW!*
Client: ${clientName}
Phone: ${lead.contact_number}
City: ${lead.city || 'Bangalore'}

Client tapped *"Call me now"*.
Target SLA: Connect within 5 minutes!
Deep Link: /crm/leads`;

                    WhatsAppService.sendAsync(rep.phone, {
                        message: alertMsg,
                        moduleName: 'crm',
                    }).catch(e => console.error('[LeadOutreachService] Urgent rep alert error:', e));
                }

                // 5. High-Priority Push Notification to Rep & Admins
                if (lead.assigned_to) {
                    NotificationService.send({
                        userId: lead.assigned_to,
                        organizationId: lead.organization_id,
                        type: 'LEAD_CALL_NOW',
                        title: '🚨 Call Me Now — Immediate Call Required',
                        message: `${clientName} in ${lead.city || 'Bangalore'} tapped Call Me Now. Target SLA: 5 mins!`,
                        deepLink: '/crm/leads',
                        priority: 'CRITICAL',
                    }).catch(e => console.error('[LeadOutreachService] Push alert error:', e));
                }

                // 6. Send Message 2 (Interactive List Picker for Team Size)
                await this.sendMessage2Qualification(lead, phone);

                return { handled: true, leadId: lead.id, action: 'call_me_now' };
            }

            // ── ACTION 2: "First thing tomorrow" / "Later today" / "Tomorrow" ────────────
            if (lower.includes('first thing tomorrow') || lower.includes('later today') || lower.includes('tomorrow') || lower === '2' || lower === '3') {
                const nowIso = new Date().toISOString();
                const slotName = lower.includes('first thing')
                    ? 'First thing tomorrow'
                    : (lower.includes('later') ? 'Later today' : 'Tomorrow');

                // 1. Calculate followup date
                const targetFollowup = this.parsePreferredFollowupTime(clean);

                await supabaseAdmin
                    .from('crm_leads')
                    .update({
                        outreach_button_tapped: slotName,
                        outreach_tapped_at: nowIso,
                        next_followup_date: targetFollowup.toISOString(),
                        followup_notes: `[Client tapped "${slotName}" at ${new Date().toLocaleTimeString()}]: Scheduled call for ${targetFollowup.toLocaleString()}.`,
                    })
                    .eq('id', lead.id);

                await this.logActivity({
                    leadId: lead.id,
                    userId: lead.assigned_to || null,
                    activityType: 'whatsapp_received',
                    description: `Client selected "${slotName}". Call scheduled for ${targetFollowup.toLocaleString()}.`,
                    metadata: { action: slotName, scheduled_time: targetFollowup.toISOString(), raw_message_id: messageId },
                });

                // 2. Send confirmation to lead with advisor's direct business card
                const confirmationMsg = `Great, noted! ${advisorName} from Autopilot Offices will connect with you ${slotName.toLowerCase()}. In the meantime, you can reach them directly at ${advisorPhone}.`;
                WhatsAppService.sendAsync(this.formatPhone(phone), {
                    message: confirmationMsg,
                    moduleName: 'crm',
                }).catch(e => console.error('[LeadOutreachService] Advisor card send error:', e));

                // 3. Send Message 2 (Team size list picker)
                await this.sendMessage2Qualification(lead, phone);

                return { handled: true, leadId: lead.id, action: slotName };
            }

            // ── ACTION 3: Team size list picker responses ────────────────────────────────
            const seatMatch = clean.match(/(under 50|50 to 150|150 to 500|500\+)/i);
            if (seatMatch) {
                const band = seatMatch[1];
                let approximateSeats = 40;
                if (band.includes('50 to 150')) approximateSeats = 100;
                if (band.includes('150 to 500')) approximateSeats = 300;
                if (band.includes('500+')) approximateSeats = 600;

                await supabaseAdmin
                    .from('crm_leads')
                    .update({
                        seats: approximateSeats,
                        requirement: `Seat Band: ${band}`,
                    })
                    .eq('id', lead.id);

                await this.logActivity({
                    leadId: lead.id,
                    userId: lead.assigned_to || null,
                    activityType: 'whatsapp_received',
                    description: `Client selected team size band: "${band}" (~${approximateSeats} seats).`,
                    metadata: { seat_band: band, seats: approximateSeats },
                });

                // Notify rep of qualified seat count
                if (rep?.phone) {
                    const updateMsg = `ℹ️ *Lead Requirement Updated*\nClient: ${clientName}\nTeam Size: ${band} (~${approximateSeats} seats).`;
                    WhatsAppService.sendAsync(rep.phone, { message: updateMsg, moduleName: 'crm' }).catch(() => {});
                }

                // Acknowledge to client
                const ackMsg = `Thank you! We've noted your team size (${band}). Our advisor is pulling together live floor plans and availability.`;
                WhatsAppService.sendAsync(this.formatPhone(phone), { message: ackMsg, moduleName: 'crm' }).catch(() => {});

                return { handled: true, leadId: lead.id, action: 'team_size_captured' };
            }

            // ── ACTION 4: Nudge response: "Still looking" vs "Please close" ─────────────
            if (lower.includes('still looking')) {
                await supabaseAdmin.from('crm_leads').update({ priority: 'Medium' }).eq('id', lead.id);
                const ack = `Glad to hear! ${advisorName} will give you a quick call today to understand what you're looking for.`;
                WhatsAppService.sendAsync(this.formatPhone(phone), { message: ack, moduleName: 'crm' }).catch(() => {});
                return { handled: true, leadId: lead.id, action: 'nudge_still_looking' };
            }
            if (lower.includes('close') || lower.includes('not looking') || lower.includes('no thanks')) {
                await supabaseAdmin.from('crm_leads').update({ status_changed_reason: 'Closed by client via WhatsApp nudge' }).eq('id', lead.id);
                const ack = `Understood. We have closed this inquiry. Feel free to reach back out anytime you need workspace! — Team Autopilot Offices`;
                WhatsAppService.sendAsync(this.formatPhone(phone), { message: ack, moduleName: 'crm' }).catch(() => {});
                return { handled: true, leadId: lead.id, action: 'nudge_closed' };
            }

            // Fallback: Natural language text from lead
            const targetFollowup = this.parsePreferredFollowupTime(clean);
            await supabaseAdmin
                .from('crm_leads')
                .update({
                    next_followup_date: targetFollowup.toISOString(),
                    followup_notes: `[Client text reply]: "${clean}".`,
                })
                .eq('id', lead.id);

            return { handled: true, leadId: lead.id, action: 'text_reply' };
        } catch (err: any) {
            console.error('[LeadOutreachService] Error handling inbound lead reply:', err);
            return { handled: false };
        }
    }

    /**
     * Dispatches Message 2 (Qualification list picker) only after a button is tapped.
     * Skips any questions already answered in the Meta Lead Gen form.
     */
    private static async sendMessage2Qualification(lead: any, phone: string): Promise<void> {
        const hasSeats = lead.seats && Number(lead.seats) > 0;
        const hasLocation = Boolean(lead.location || lead.city);

        // If Meta form already captured both seats and location, skip list picker and send brief confirmation
        if (hasSeats && hasLocation) {
            const skipMsg = `Great, noted! We see you're looking for ~${lead.seats} seats in ${lead.location || lead.city}. Our advisor will have tailored live options ready when we speak!`;
            WhatsAppService.sendAsync(this.formatPhone(phone), { message: skipMsg, moduleName: 'crm' }).catch(() => {});
            return;
        }

        // Send Message 2 with list picker options
        const questionText = `Great, noted! Two quick details so we come prepared with the right layouts and pricing:\n1. Approx team size\n2. Preferred area and target move-in month\n\nPlease select your approx team size below:`;
        const seatOptions = ['Under 50', '50 to 150', '150 to 500', '500+'];

        WhatsAppService.sendPoll(this.formatPhone(phone), questionText, seatOptions).catch(() => {
            // Fallback text if poll is unsupported
            const fallbackText = `${questionText}\n\n1. Under 50\n2. 50 to 150\n3. 150 to 500\n4. 500+\n\nReply with the number of your option.`;
            WhatsAppService.sendAsync(this.formatPhone(phone), { message: fallbackText, moduleName: 'crm' }).catch(() => {});
        });
    }

    /**
     * Scans for leads created > configured nudge delay hours ago with no response and sends one polite nudge.
     * Operates only during active business hours (9 AM - 7 PM IST).
     */
    static async send4HourNudges(organizationId?: string): Promise<{ nudged: number; skipped: number }> {
        const res = { nudged: 0, skipped: 0 };
        try {
            if (this.isAfterHours()) {
                console.info('[LeadOutreachService] After-hours: skipping nudges until next morning 10 AM.');
                return res;
            }

            const defaultOrgId = organizationId || '211e1330-ad83-446d-941f-dcea48396798';
            const nudgeConfig = await CampaignOutreachConfigService.getNudgeConfig(defaultOrgId);

            if (!nudgeConfig.nudge_enabled) {
                console.info('[LeadOutreachService] Follow-up nudges are currently paused in outreach settings.');
                return res;
            }

            const delayHours = nudgeConfig.nudge_delay_hours || 4;
            const cutoffTime = new Date(Date.now() - delayHours * 60 * 60 * 1000).toISOString();
            const { data: leads } = await supabaseAdmin
                .from('crm_leads')
                .select('id, contact_person, contact_number, city, assigned_to, assignee:users!assigned_to(full_name)')
                .is('nudge_sent_at', null)
                .is('outreach_button_tapped', null)
                .lte('created_at', cutoffTime)
                .eq('is_archived', false)
                .limit(25);

            if (!leads || leads.length === 0) return res;

            const nudgeCampaign = process.env.AISENSY_LEAD_NUDGE_CAMPAIGN || 'autopilot_lead_nudge_v1';

            for (const lead of leads) {
                if (!lead.contact_number) continue;
                const formattedPhone = this.formatPhone(lead.contact_number);
                const firstName = (lead.contact_person || '').trim().split(' ')[0] || 'there';
                const advisorName = (lead.assignee as any)?.full_name || 'Our team';
                const city = lead.city || 'Bangalore';

                const waRes = await AiSensyService.sendTemplate({
                    phone: formattedPhone,
                    campaignName: nudgeCampaign,
                    templateParams: [firstName, city],
                    userName: firstName,
                });

                if (waRes.success) {
                    await supabaseAdmin
                        .from('crm_leads')
                        .update({ nudge_sent_at: new Date().toISOString() })
                        .eq('id', lead.id);

                    await this.logActivity({
                        leadId: lead.id,
                        userId: lead.assigned_to || null,
                        activityType: 'whatsapp_sent',
                        description: `4-hour unengaged follow-up nudge sent to client.`,
                        metadata: { channel: 'whatsapp', campaign: nudgeCampaign },
                    });
                    res.nudged++;
                } else {
                    res.skipped++;
                }
            }

            return res;
        } catch (err) {
            console.error('[LeadOutreachService] send4HourNudges error:', err);
            return res;
        }
    }

    /**
     * Parses the lead's preferred contact time from their WhatsApp reply text.
     */
    static parsePreferredFollowupTime(text: string): Date {
        const clean = text.trim().toLowerCase();
        const now = new Date();
        const target = new Date(now);

        // Specific time parsing (e.g. "4pm", "11:30 am", "at 4", etc.)
        const timeMatch = clean.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i) || (clean.includes('at ') ? clean.match(/at\s*(\d{1,2})/i) : null);
        if (timeMatch) {
            let hour = parseInt(timeMatch[1], 10);
            const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
            const meridian = timeMatch[3]?.toLowerCase();

            if (meridian === 'pm' && hour < 12) hour += 12;
            if (meridian === 'am' && hour === 12) hour = 0;
            if (!meridian && hour >= 1 && hour <= 7) hour += 12;

            target.setHours(hour, minute, 0, 0);
            if (clean.includes('tomorrow') || target.getTime() <= now.getTime()) {
                target.setDate(target.getDate() + 1);
            }
            return target;
        }

        // Option 1 or Afternoon (2 PM - 5 PM)
        if (clean === '1' || clean.includes('afternoon')) {
            target.setHours(15, 0, 0, 0); // 3:00 PM
            if (clean.includes('tomorrow') || target.getTime() <= now.getTime()) {
                target.setDate(target.getDate() + 1);
            }
            return target;
        }

        // Option 2 or Evening (5 PM - 7:30 PM)
        if (clean === '2' || clean.includes('evening')) {
            target.setHours(17, 30, 0, 0); // 5:30 PM
            if (clean.includes('tomorrow') || target.getTime() <= now.getTime()) {
                target.setDate(target.getDate() + 1);
            }
            return target;
        }

        // Option 3 or Tomorrow Morning (10:30 AM - 1:00 PM)
        if (clean === '3' || clean.includes('morning') || clean.includes('tomorrow') || clean.includes('first thing')) {
            target.setDate(target.getDate() + 1);
            target.setHours(10, 30, 0, 0); // 10:30 AM tomorrow
            return target;
        }

        // Default business hours offset
        const currentHour = now.getHours();
        if (currentHour < 10) {
            target.setHours(11, 0, 0, 0);
        } else if (currentHour >= 18) {
            target.setDate(target.getDate() + 1);
            target.setHours(10, 30, 0, 0);
        } else {
            target.setTime(now.getTime() + 2 * 60 * 60 * 1000);
        }

        return target;
    }

    /**
     * SMS fallback adapter for numbers lacking WhatsApp.
     */
    private static async sendSmsFallback(lead: any, formattedPhone: string, advisorName: string): Promise<{ success: boolean; error?: string }> {
        const smsApiKey = process.env.FAST2SMS_API_KEY || process.env.SMS_API_KEY;
        if (!smsApiKey) {
            return { success: false, error: 'SMS provider not configured' };
        }

        try {
            const rawPhone = this.get10DigitPhone(formattedPhone);
            const firstName = (lead.contact_person || '').trim().split(' ')[0] || 'there';
            const city = lead.city || 'Bangalore';
            const message = `Hi ${firstName}, thanks for your enquiry about managed office space in ${city}. I'm ${advisorName} from Autopilot Offices. When is a good time for a 10 min call today or tomorrow?`;

            const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                method: 'POST',
                headers: {
                    'authorization': smsApiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    route: 'q',
                    message,
                    flash: 0,
                    numbers: rawPhone,
                }),
                signal: AbortSignal.timeout(10_000),
            });

            const data = await res.json();
            return { success: data.return === true || res.ok, error: data.message };
        } catch (err: any) {
            return { success: false, error: err?.message };
        }
    }
}
