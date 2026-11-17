import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveDistributionAssignee } from '@/backend/lib/crm/distribution';
import { NotificationService } from '@/backend/services/NotificationService';
import { EmailService } from '@/backend/services/EmailService';
import { checkRateLimit, getClientIP } from '@/frontend/utils/rate-limiter';

/**
 * Public intake for website enquiry forms (first user: the Total Environment
 * Workcations landing page). Creates a CRM lead (source "Website") in the
 * Autopilot org and emails the people who must call back.
 * No auth by design: protected by an IP rate limit, a honeypot field and
 * strict validation. Mirrors the Meta lead webhook's lead shape.
 */

const NOTIFY_TO = ['harshini.ranganathan@autopilotoffices.com', 'saniel@worksquare.in'];
const CAMPAIGN = 'TE Whitefield landing page';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const schema = z.object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(160).optional().default(''),
    phone: z.string().trim().max(30).refine(v => v.replace(/\D/g, '').length >= 10, 'phone'),
    email: z.string().trim().max(200).email().optional().or(z.literal('')).default(''),
    seats: z.string().trim().max(40).optional().default(''),
    moveIn: z.string().trim().max(40).optional().default(''),
    page: z.string().trim().max(200).optional().default(''),
    website: z.string().optional().default(''), // honeypot: real people leave it empty
});

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
    const limit = checkRateLimit(getClientIP(req), { maxRequests: 5, windowMs: 60_000 });
    if (!limit.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: CORS });

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid form data' }, { status: 400, headers: CORS });
    const f = parsed.data;
    if (f.website) return NextResponse.json({ ok: true }, { headers: CORS }); // bot: pretend success

    const phone = f.phone.replace(/\D/g, '').replace(/^0+/, '').replace(/^91(?=\d{10}$)/, '');
    const seatNums = f.seats.match(/\d+/g)?.map(Number) || [];
    const requirement = [f.seats && `Seats: ${f.seats}`, f.moveIn && `Move in: ${f.moveIn}`, 'Property: Total Environment Workcations, ITPL Main Road, Whitefield']
        .filter(Boolean).join(' | ');

    // 1. CRM lead. A failure here must not lose the enquiry, so email still goes out.
    let leadId: string | null = null;
    let leadError: string | null = null;
    try {
        const orgId = process.env.NEXT_PUBLIC_AUTOPILOT_ORG_ID;
        if (!orgId) throw new Error('NEXT_PUBLIC_AUTOPILOT_ORG_ID not set');

        const [pm, om] = await Promise.all([
            supabaseAdmin.from('property_memberships').select('user_id').eq('organization_id', orgId).in('role', ['bd_admin', 'org_super_admin', 'org_admin']).eq('is_active', true).limit(1),
            supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', orgId).in('role', ['bd_admin', 'org_super_admin', 'org_admin']).eq('is_active', true).limit(1),
        ]);
        const createdBy = pm.data?.[0]?.user_id || om.data?.[0]?.user_id;
        if (!createdBy) throw new Error('No admin in org to own website leads');

        const [{ data: status }, { data: source }, assignee] = await Promise.all([
            supabaseAdmin.from('crm_lead_statuses').select('id').eq('is_default', true)
                .or(`organization_id.eq.${orgId},organization_id.is.null`)
                .order('organization_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
            supabaseAdmin.from('crm_lead_sources').select('id').ilike('name', 'Website')
                .or(`organization_id.eq.${orgId},organization_id.is.null`)
                .order('organization_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
            resolveDistributionAssignee(orgId, CAMPAIGN, 'Bengaluru'),
        ]);
        if (!status?.id) throw new Error('No default lead status');

        const { data: lead, error } = await supabaseAdmin.from('crm_leads').insert({
            organization_id: orgId,
            created_by: createdBy,
            assigned_to: assignee ?? null,
            company_name: f.company || f.name,
            contact_person: f.name,
            contact_number: phone,
            email: f.email || null,
            location: 'ITPL Main Road, Whitefield',
            city: 'Bengaluru',
            seats: seatNums.length ? Math.max(...seatNums) : null,
            move_in_timeline: f.moveIn || null,
            requirement,
            status: status.id,
            priority: /immediate/i.test(f.moveIn) ? 'High' : 'Medium',
            lead_source: source?.id ?? null,
            campaign: CAMPAIGN,
        }).select('id').single();
        if (error) throw error;
        leadId = lead.id;
        NotificationService.afterLeadCreated(lead.id).catch(e => console.error('[website-lead] notify error:', e));
    } catch (e: any) {
        leadError = e?.message || 'unknown';
        console.error('[website-lead] CRM insert failed:', e);
    }

    // 2. Email the people who call back.
    const rows: [string, string][] = [
        ['Name', f.name], ['Company', f.company || '-'], ['Phone', phone], ['Email', f.email || '-'],
        ['Seats', f.seats || '-'], ['Move in', f.moveIn || '-'], ['Page', f.page || 'TE Whitefield landing'],
        ['CRM', leadId ? `Lead created (${leadId})` : `NOT saved to CRM: ${leadError}`],
    ];
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<p><b>New site-visit request: Total Environment Workcations, Whitefield</b></p>
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#777">${k}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>
<p style="color:#777">Call within the hour. Sent by Autopilot FMS from the website form.</p></div>`;
    const mailed = await EmailService.sendEmail({
        to: NOTIFY_TO,
        subject: `Site visit request: ${f.name}${f.company ? ` (${f.company})` : ''}, ${f.moveIn || 'TE Whitefield'}`,
        html,
    }).catch(() => false);

    if (!leadId && !mailed) {
        return NextResponse.json({ error: 'Could not record the request' }, { status: 502, headers: CORS });
    }
    return NextResponse.json({ ok: true, lead: !!leadId, mailed: !!mailed }, { headers: CORS });
}
