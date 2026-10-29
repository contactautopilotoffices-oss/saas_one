import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { LeadOutreachService } from '@/backend/services/LeadOutreachService';
import { CampaignOutreachConfigService } from '@/backend/services/CampaignOutreachConfigService';
import { EmailService } from '@/backend/services/EmailService';

const DEFAULT_BANGALORE_ADVISOR_ID = '0889c23c-0028-4b08-af18-b95d602fde28';

// POST /api/crm/outreach/test — Dispatches automated Message 1 directly to test phone
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const orgId = access.organizationId;
    const phoneInput = (body.phone || '7028232515').toString().trim();
    const clientName = (body.name || 'Test Client').trim();
    const campaignName = (body.campaign || 'Test Campaign').trim();

    // Look up matching campaign config to get exact city and advisor
    const configs = await CampaignOutreachConfigService.getAllCampaignConfigs(orgId);
    const targetCamp = configs.find(c => c.campaign.toLowerCase() === campaignName.toLowerCase())
        || configs.find(c => c.campaign.toLowerCase() === 'test campaign');
    const city = targetCamp?.city || (body.city || 'Bangalore').trim();
    const advisorId = targetCamp?.assigned_user_id || DEFAULT_BANGALORE_ADVISOR_ID;

    const tenDigits = LeadOutreachService.get10DigitPhone(phoneInput);
    const formattedPhone = LeadOutreachService.formatPhone(phoneInput);

    if (tenDigits.length < 10) {
        return NextResponse.json({ error: 'Valid 10-digit Indian phone number is required' }, { status: 400 });
    }

    try {
        // 1. Find existing sandbox test lead or create one
        const { data: existingLead } = await supabaseAdmin
            .from('crm_leads')
            .select('id, contact_number, assigned_to')
            .ilike('contact_number', `%${tenDigits}%`)
            .eq('organization_id', orgId)
            .eq('is_archived', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        let leadId: string;

        // Resolve default lead source UUID
        const { data: defaultSource } = await supabaseAdmin
            .from('crm_lead_sources')
            .select('id')
            .or(`organization_id.eq.${orgId},organization_id.is.null`)
            .limit(1)
            .maybeSingle();

        if (existingLead) {
            leadId = existingLead.id;
            // Reset testing state so the lead is fresh
            await supabaseAdmin
                .from('crm_leads')
                .update({
                    contact_person: clientName,
                    campaign: campaignName,
                    city,
                    location: city,
                    assigned_to: advisorId,
                    status: 'edac5b61-6567-4acb-8fc6-1ccc9d0bd277',
                    priority: 'High',
                    outreach_button_tapped: null,
                    outreach_tapped_at: null,
                    call_sla_breached: false,
                    is_smb_nurture: false,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', leadId);
        } else {
            const { data: newLead, error: leadErr } = await supabaseAdmin
                .from('crm_leads')
                .insert({
                    organization_id: orgId,
                    company_name: `${clientName} (Test Sandbox)`,
                    contact_person: clientName,
                    contact_number: formattedPhone,
                    email: 'test@autopilotoffices.com',
                    city,
                    location: city,
                    seats: 30,
                    status: 'edac5b61-6567-4acb-8fc6-1ccc9d0bd277',
                    priority: 'High',
                    lead_source: defaultSource?.id || null,
                    campaign: campaignName,
                    assigned_to: advisorId,
                    created_by: access.user.id,
                })
                .select('id')
                .single();

            if (leadErr || !newLead) {
                console.error('[OutreachTestAPI] Error creating sandbox lead:', leadErr);
                return NextResponse.json({ error: leadErr?.message || 'Failed to initialize test lead' }, { status: 500 });
            }
            leadId = newLead.id;
        }

        // 2. Trigger automated lead outreach flow
        console.info(`[OutreachTestAPI] Triggering live test outreach for ${formattedPhone} (Lead: ${leadId})`);
        const dispatchResult = await LeadOutreachService.sendLeadFollowupOutreach(leadId);

        // 3. Dispatch test notification email exclusively to harshrp2309@gmail.com
        EmailService.sendNewLeadEmail({
            emailTo: 'harshrp2309@gmail.com',
            subject: `[TEST CRM Lead] ${clientName} - Test Sandbox`,
            html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #6366f1; margin: 0; font-size: 20px;">🎯 Test Campaign Lead Simulation</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Automated outreach test lead dispatched</p>
                    </div>
                    <div style="background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 16px; border-radius: 6px; margin: 18px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr><td style="padding: 4px 0; color: #64748b; width: 130px;"><b>Client:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: bold;">${clientName}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Phone:</b></td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${formattedPhone}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>Campaign:</b></td><td style="padding: 4px 0; color: #0f172a;">${campaignName}</td></tr>
                            <tr><td style="padding: 4px 0; color: #64748b;"><b>City:</b></td><td style="padding: 4px 0; color: #0f172a;">${city}</td></tr>
                        </table>
                    </div>
                </div>
            `,
        }).catch(err => console.error('[OutreachTestAPI] Email dispatch error:', err));

        return NextResponse.json({
            success: true,
            leadId,
            phone: formattedPhone,
            tenDigits,
            clientName,
            campaign: campaignName,
            result: dispatchResult,
            message: `Test outreach dispatched to ${formattedPhone}! Check WhatsApp on this phone to test quick-reply buttons.`,
        });
    } catch (err: any) {
        console.error('[OutreachTestAPI] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal test dispatch error' }, { status: 500 });
    }
}

// GET /api/crm/outreach/test — Poll live status and BD rep responses for the test phone
export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const phoneInput = (new URL(request.url).searchParams.get('phone') || '7028232515').trim();
    const tenDigits = LeadOutreachService.get10DigitPhone(phoneInput);

    // Fetch the test lead
    const { data: lead } = await supabaseAdmin
        .from('crm_leads')
        .select(`
            id,
            contact_person,
            contact_number,
            campaign,
            city,
            seats,
            status,
            outreach_button_tapped,
            outreach_tapped_at,
            call_sla_breached,
            followup_notes,
            created_at,
            updated_at,
            assignee:users!assigned_to(id, full_name, phone)
        `)
        .ilike('contact_number', `%${tenDigits}%`)
        .eq('organization_id', access.organizationId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!lead) {
        return NextResponse.json({
            active: false,
            phone: phoneInput,
            message: 'No test run found for this phone number yet. Click Send Test Message to begin.',
        });
    }

    // Fetch chronological activities for this lead
    const { data: activities } = await supabaseAdmin
        .from('crm_activity_log')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(20);

    // Fetch SLA record if any
    let sla: any = null;
    try {
        const { data: slaData } = await supabaseAdmin
            .from('crm_lead_slas')
            .select('*')
            .eq('lead_id', lead.id)
            .maybeSingle();
        sla = slaData || null;
    } catch {}

    // Extract the BD notification preview if one was generated
    const repAlertActivity = (activities || []).find(
        (a: any) =>
            a.description?.includes('Call me now') ||
            a.description?.includes('Preferred slot') ||
            a.activity_type === 'whatsapp_received'
    );

    return NextResponse.json({
        active: true,
        lead: {
            id: lead.id,
            name: lead.contact_person,
            phone: lead.contact_number,
            campaign: lead.campaign,
            city: lead.city,
            seats: lead.seats,
            call_now_requested_at: (lead as any).outreach_button_tapped === 'call_now' ? (lead as any).outreach_tapped_at : null,
            preferred_slot: (lead as any).outreach_button_tapped,
            outreach_button_tapped: (lead as any).outreach_button_tapped,
            outreach_tapped_at: (lead as any).outreach_tapped_at,
            followup_notes: (lead as any).followup_notes,
            assignee: (lead as any).assignee,
        },
        sla: sla || null,
        repAlert: repAlertActivity || null,
        activities: activities || [],
    });
}
