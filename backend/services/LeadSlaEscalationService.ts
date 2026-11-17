import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppService } from './WhatsAppService';
import { NotificationService } from './NotificationService';

export interface SlaCheckResult {
    checked: number;
    breached: number;
    met: number;
    errors: string[];
}

export class LeadSlaEscalationService {
    /**
     * Arms a 10-minute Call Me Now SLA countdown timer when a lead taps "Call me now".
     */
    static async armCallNowSla(params: {
        leadId: string;
        assignedTo?: string | null;
    }): Promise<{ success: boolean; slaId?: string }> {
        const { leadId, assignedTo } = params;
        try {
            const now = new Date();
            const targetSla = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes from now

            const { data, error } = await supabaseAdmin
                .from('crm_lead_slas')
                .insert({
                    lead_id: leadId,
                    assigned_to: assignedTo || null,
                    sla_type: 'call_me_now_10m',
                    triggered_at: now.toISOString(),
                    target_sla_at: targetSla.toISOString(),
                    status: 'pending',
                })
                .select('id')
                .single();

            if (error) {
                console.error('[LeadSlaEscalationService] Error arming SLA:', error.message);
                return { success: false };
            }

            console.info(`[LeadSlaEscalationService] ⏱️ 10-minute SLA armed for lead ${leadId} (Target: ${targetSla.toLocaleTimeString()})`);
            return { success: true, slaId: data?.id };
        } catch (err: any) {
            console.error('[LeadSlaEscalationService] armCallNowSla error:', err);
            return { success: false };
        }
    }

    /**
     * Resolves pending SLA when a BD rep initiates a call to the lead.
     */
    static async markCallCompleted(leadId: string): Promise<void> {
        try {
            const now = new Date().toISOString();
            await supabaseAdmin
                .from('crm_lead_slas')
                .update({
                    status: 'met',
                    completed_at: now,
                })
                .eq('lead_id', leadId)
                .eq('status', 'pending');

            await supabaseAdmin
                .from('crm_leads')
                .update({ first_call_at: now })
                .eq('id', leadId)
                .is('first_call_at', null);
        } catch (err) {
            console.error('[LeadSlaEscalationService] markCallCompleted error:', err);
        }
    }

    /**
     * Scans for pending SLAs that have crossed their 10-minute deadline without a logged call.
     * Escalates directly to leadership (Saniel) via WhatsApp and Push notification.
     */
    static async checkAndEscalateBreachedSlas(): Promise<SlaCheckResult> {
        const result: SlaCheckResult = { checked: 0, breached: 0, met: 0, errors: [] };
        try {
            const nowIso = new Date().toISOString();

            // Fetch pending SLAs whose 10-minute window has elapsed
            const { data: pendingSlas, error } = await supabaseAdmin
                .from('crm_lead_slas')
                .select(`
                    id,
                    lead_id,
                    assigned_to,
                    triggered_at,
                    target_sla_at,
                    lead:crm_leads(id, contact_person, company_name, contact_number, city, organization_id),
                    assignee:users!assigned_to(id, full_name, phone)
                `)
                .eq('status', 'pending')
                .lte('target_sla_at', nowIso);

            if (error) {
                result.errors.push(error.message);
                return result;
            }

            if (!pendingSlas || pendingSlas.length === 0) {
                return result;
            }

            result.checked = pendingSlas.length;

            for (const sla of pendingSlas) {
                const lead: any = sla.lead;
                const assignee: any = sla.assignee;

                // Check if a call was logged in crm_activity_log since triggered_at
                const { data: calls } = await supabaseAdmin
                    .from('crm_activity_log')
                    .select('id')
                    .eq('lead_id', sla.lead_id)
                    .eq('activity_type', 'call')
                    .gte('created_at', sla.triggered_at)
                    .limit(1);

                if (calls && calls.length > 0) {
                    // Call was logged; mark SLA as met
                    await supabaseAdmin
                        .from('crm_lead_slas')
                        .update({ status: 'met', completed_at: new Date().toISOString() })
                        .eq('id', sla.id);
                    result.met++;
                    continue;
                }

                // SLA BREACHED! Escalate to leadership
                result.breached++;
                console.warn(`[LeadSlaEscalationService] 🚨 SLA Breach for lead ${sla.lead_id}! Escalating to leadership.`);

                // Mark SLA row as breached / escalated
                await supabaseAdmin
                    .from('crm_lead_slas')
                    .update({
                        status: 'breached',
                        escalated_to: 'Saniel',
                    })
                    .eq('id', sla.id);

                await supabaseAdmin
                    .from('crm_leads')
                    .update({ call_sla_breached: true })
                    .eq('id', sla.lead_id);

                // Fetch Saniel's contact info
                const { data: sanielUser } = await supabaseAdmin
                    .from('users')
                    .select('id, full_name, phone')
                    .eq('email', 'saniel@worksquare.in')
                    .maybeSingle();

                const clientName = lead?.contact_person || lead?.company_name || 'Prospect';
                const repName = assignee?.full_name || 'Unassigned';
                const repPhone = assignee?.phone || 'N/A';
                const city = lead?.city || 'Bangalore';

                const escalationMessage = `⚠️ *SLA BREACH ESCALATION (10 min)*\n\n*Client:* ${clientName}\n*Phone:* ${lead?.contact_number}\n*City:* ${city}\n*Assigned Advisor:* ${repName} (${repPhone})\n\nClient tapped *"Call me now"* 10 minutes ago, but no call has been initiated in CRM.\n\nDeep Link: /crm/leads`;

                // 1. Direct WhatsApp Alert to Saniel
                const sanielPhone = sanielUser?.phone || process.env.SANIEL_ESCALATION_PHONE;
                if (sanielPhone) {
                    WhatsAppService.sendAsync(sanielPhone, {
                        message: escalationMessage,
                        moduleName: 'crm',
                    }).catch(e => console.error('[LeadSlaEscalationService] WhatsApp escalation error:', e));
                }

                // 2. High-Priority Push Notification to Saniel & Org Admins
                const alertUserIds: string[] = [];
                if (sanielUser?.id) alertUserIds.push(sanielUser.id);

                if (alertUserIds.length > 0) {
                    NotificationService.sendToMany(alertUserIds, {
                        organizationId: lead?.organization_id,
                        type: 'LEAD_SLA_BREACH',
                        title: '⚠️ 10-Minute Call SLA Breached',
                        message: `${clientName} in ${city} tapped "Call me now" 10m ago — no call from ${repName}!`,
                        deepLink: '/crm/leads',
                        priority: 'CRITICAL',
                    }).catch(e => console.error('[LeadSlaEscalationService] Push escalation error:', e));
                }
            }

            return result;
        } catch (err: any) {
            console.error('[LeadSlaEscalationService] checkAndEscalateBreachedSlas error:', err);
            result.errors.push(err?.message || 'Unknown error');
            return result;
        }
    }
}
