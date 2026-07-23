import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveDistributionAssignee } from '@/backend/lib/crm/distribution';
import { EmailService } from '@/backend/services/EmailService';
import { NotificationService } from '@/backend/services/NotificationService';

const GRAPH_VERSION = 'v19.0';

// --- GET: Meta subscription verification --------------------------------
export async function GET(request: NextRequest) {
    const sp = new URL(request.url).searchParams;
    const mode = sp.get('hub.mode');
    const token = sp.get('hub.verify_token');
    const challenge = sp.get('hub.challenge');

    if (mode !== 'subscribe' || !token) {
        return NextResponse.json({ status: 'ok', service: 'meta_lead_ads_webhook' });
    }

    // Match the verify token against any org's active config.
    const { data: cfg } = await supabaseAdmin
        .from('crm_meta_config')
        .select('id')
        .eq('verify_token', token)
        .eq('is_active', true)
        .maybeSingle();

    if (!cfg) return new NextResponse('Forbidden', { status: 403 });
    // Meta expects the raw challenge string echoed back.
    return new NextResponse(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

// --- POST: leadgen notifications ----------------------------------------
export async function POST(request: NextRequest) {
    // Read the RAW body first — signature is computed over the exact bytes.
    const rawBody = await request.text();
    let body: any;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
    if (entries.length === 0) {
        return NextResponse.json({ error: 'No entries' }, { status: 400 });
    }

    // Determine the page (and therefore the org config) from the payload.
    const pageId =
        entries[0]?.id ||
        entries[0]?.changes?.[0]?.value?.page_id ||
        null;
    if (!pageId) return NextResponse.json({ error: 'Missing page id' }, { status: 400 });

    const { data: config } = await supabaseAdmin
        .from('crm_meta_config')
        .select('*')
        .eq('page_id', pageId)
        .eq('is_active', true)
        .maybeSingle();

    if (!config) {
        // Unknown / unconfigured page — ack 200 so Meta doesn't retry forever,
        // but do nothing.
        console.warn('[Meta webhook] No active config for page', pageId);
        return NextResponse.json({ status: 'ignored', reason: 'unconfigured_page' });
    }

    // Verify X-Hub-Signature-256 against this org's app secret.
    const signature = request.headers.get('x-hub-signature-256') || '';
    if (!config.app_secret || !verifySignature(rawBody, signature, config.app_secret)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const results: any[] = [];
    for (const entry of entries) {
        for (const change of entry.changes || []) {
            if (change.field && change.field !== 'leadgen') continue;
            const v = change.value || {};
            const leadgenId = v.leadgen_id;
            if (!leadgenId) continue;
            results.push(await processLeadgen(leadgenId, v, config));
        }
    }

    return NextResponse.json({ status: 'ok', processed: results });
}

function verifySignature(rawBody: string, header: string, appSecret: string): boolean {
    if (!header.startsWith('sha256=')) return false;
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const received = header.slice('sha256='.length);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Resolve a user id to own webhook-created rows: configured assignee, else an org admin. */
async function resolveSystemUser(config: any): Promise<string | null> {
    if (config.default_assignee) return config.default_assignee;
    const [pm, om] = await Promise.all([
        supabaseAdmin.from('property_memberships').select('user_id').eq('organization_id', config.organization_id).in('role', ['bd_admin', 'org_super_admin', 'org_admin']).eq('is_active', true).limit(1),
        supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', config.organization_id).in('role', ['bd_admin', 'org_super_admin', 'org_admin']).eq('is_active', true).limit(1),
    ]);
    return pm.data?.[0]?.user_id || om.data?.[0]?.user_id || null;
}

function cleanPhone(raw: string | null): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
    return digits.replace(/^91/, '') || null;
}

async function fetchFormName(formId: string, token: string): Promise<string | null> {
    try {
        const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${formId}?fields=name&access_token=${encodeURIComponent(token)}`);
        const json = await res.json();
        return json.name || null;
    } catch { return null; }
}

async function findExistingLead(orgId: string, phone: string | null, email: string | null) {
    if (!phone && !email) return null;
    const conditions: string[] = [];
    const cleanedPhone = cleanPhone(phone);
    if (cleanedPhone) conditions.push(`contact_number.ilike.%${cleanedPhone}%`);
    if (email) conditions.push(`email.ilike.${email}`);
    if (conditions.length === 0) return null;
    const { data } = await supabaseAdmin
        .from('crm_leads')
        .select('id, contact_person, assigned_to')
        .eq('organization_id', orgId)
        .or(conditions.join(','))
        .limit(1)
        .maybeSingle();
    return data;
}

async function notifyNewLead(config: any, lead: any, assignedTo: string | null, formName: string | null) {
    try {
        const { data: users } = assignedTo
            ? await supabaseAdmin
                .from('users')
                .select('id, email, full_name')
                .in('id', [assignedTo])
            : { data: [] as any[] };

        // Fetch Business Development Admins (bd_admin)
        const { data: bdAdmins } = await supabaseAdmin
            .from('organization_memberships')
            .select('user_id, users:user_id(email)')
            .eq('organization_id', config.organization_id)
            .eq('role', 'bd_admin')
            .eq('is_active', true);

        const emails = new Set<string>();
        
        // 1. Always add the assigned sales rep ("other persons")
        users?.forEach((u: any) => { if (u.email) emails.add(u.email); });
        
        // 2. Always add all Business Development Admins
        bdAdmins?.forEach((a: any) => {
            const e = (a.users as any)?.email;
            if (e) emails.add(e);
        });
        
        // 3. ONLY these two specific Org Super Admins should receive CRM lead emails
        emails.add('rushab@worksquare.in');
        emails.add('saniel@worksquare.in');

        if (emails.size === 0) return;

        const repName = users?.[0]?.full_name || 'Unassigned';
        const html = `
            <h2>New Meta Lead Received</h2>
            <table style="border-collapse:collapse;font-family:sans-serif;">
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Name</td><td>${lead.contact_person || 'N/A'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Phone</td><td>${lead.contact_number || 'N/A'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email</td><td>${lead.email || 'N/A'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">City</td><td>${lead.city || 'N/A'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Form</td><td>${formName || 'N/A'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Assigned To</td><td>${repName}</td></tr>
            </table>
            <p style="margin-top:16px;">Log in to <b>Autopilot CRM</b> to follow up.</p>
        `;

        for (const to of emails) {
            await EmailService.sendNewLeadEmail({ emailTo: to, subject: `New Meta Lead: ${lead.contact_person || 'Unknown'}`, html });
        }
    } catch (err) {
        console.error('[Meta webhook] email notification failed:', err);
    }
}

async function processLeadgen(leadgenId: string, value: any, config: any) {
    const { data: existing } = await supabaseAdmin
        .from('crm_meta_leads').select('id, status').eq('meta_lead_id', leadgenId).maybeSingle();
    if (existing) {
        await supabaseAdmin.from('crm_meta_leads')
            .update({ status: 'duplicate', processed_at: new Date().toISOString() })
            .eq('id', existing.id);
        return { leadgen_id: leadgenId, status: 'duplicate' };
    }

    const { data: metaRow } = await supabaseAdmin
        .from('crm_meta_leads')
        .insert({
            organization_id: config.organization_id,
            meta_lead_id: leadgenId,
            payload: value,
            campaign_id: value.campaign_id ?? null,
            adset_id: value.adgroup_id ?? value.adset_id ?? null,
            ad_id: value.ad_id ?? null,
            form_id: value.form_id ?? null,
            status: 'pending',
        })
        .select('id')
        .single();

    try {
        const fields = await fetchLeadFields(leadgenId, config.page_access_token);
        // Robust fuzzy matcher (Meta names look like `what_is_your_seat_requirement?`).
        const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const get = (...names: string[]) => {
            for (const n of names) {
                const f = fields.find((x) => norm(x.name).includes(norm(n)));
                if (f?.values?.[0]) return f.values[0];
            }
            return null;
        };
        const fullName = get('full_name', 'full name')
            || [get('first_name'), get('last_name')].filter(Boolean).join(' ')
            || get('name') || null;
        const email = get('email', 'work email', 'work_email');
        const phone = get('phone_number', 'phone', 'mobile_number', 'mobile');
        const city = get('city', 'preferred location', 'location');
        const seatsRaw = get('seat requirement', 'seat_requirement', 'number of seats', 'seats');
        const seatNums = (seatsRaw || '').match(/\d+/g)?.map((x) => parseInt(x)) || [];
        const seats = seatNums.length ? Math.max(...seatNums) : null;
        const moveIn = get('move in timeline', 'move_in_timeline', 'when do you want to move in', 'move in');
        const companyName = get('company name', 'company_name', 'organization');
        const jobTitle = get('job title', 'job_title', 'designation');
        const requirement = [
            seatsRaw ? `Seats: ${seatsRaw.replace(/_/g, ' ')}` : null,
            companyName ? `Company: ${companyName}` : null,
            jobTitle ? `Title: ${jobTitle}` : null,
        ].filter(Boolean).join(' | ') || null;

        // Cross-source dedup: check phone/email against existing leads.
        // status MUST be a value allowed by crm_meta_leads_status_check
        // ('pending','processed','failed','duplicate'). 'duplicate_contact' is NOT
        // allowed and previously violated the constraint — in the webhook that
        // surfaced as a 500, causing Meta to retry the delivery repeatedly (a
        // constraint-violation storm) and the lead to never settle. Use 'duplicate'.
        const existingLead = await findExistingLead(config.organization_id, phone, email);
        if (existingLead) {
            await supabaseAdmin.from('crm_meta_leads')
                .update({ status: 'duplicate', processed_lead_id: existingLead.id, processed_at: new Date().toISOString() })
                .eq('id', metaRow!.id);
            return { leadgen_id: leadgenId, status: 'duplicate', existing_lead_id: existingLead.id };
        }

        const createdBy = await resolveSystemUser(config);
        if (!createdBy) throw new Error('No assignee/admin available to own the lead');

        // Fetch form name from Graph API for round-robin matching + reporting.
        const formName = value.form_id ? await fetchFormName(value.form_id, config.page_access_token) : null;
        const campaignName = formName || value.campaign_name || null;
        const distributionAssignee = await resolveDistributionAssignee(
            config.organization_id,
            campaignName,
            city
        );

        const { data: def } = await supabaseAdmin
            .from('crm_lead_statuses').select('id').eq('is_default', true)
            .or(`organization_id.eq.${config.organization_id},organization_id.is.null`)
            .order('organization_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        let sourceId = config.default_lead_source;
        if (!sourceId) {
            const { data: metaSrc } = await supabaseAdmin
                .from('crm_lead_sources').select('id').ilike('name', 'Meta Lead Ads')
                .or(`organization_id.eq.${config.organization_id},organization_id.is.null`).limit(1).maybeSingle();
            sourceId = metaSrc?.id ?? null;
        }

        // Unmatched leads stay unassigned (null) rather than dumping on an admin.
        const assignedTo = distributionAssignee ?? config.default_assignee ?? null;
        const leadData = {
            organization_id: config.organization_id,
            created_by: createdBy,
            assigned_to: assignedTo,
            company_name: companyName || fullName || 'Meta Lead',
            contact_person: fullName,
            contact_number: phone,
            email,
            location: city,
            city,
            seats,
            move_in_timeline: moveIn ? moveIn.replace(/_/g, ' ') : null,
            requirement,
            status: def?.id,
            priority: 'Medium',
            lead_source: sourceId,
            property_interest: config.default_property ?? null,
            campaign: campaignName,
            meta_lead_id: leadgenId,
            meta_campaign_id: value.campaign_id ?? null,
            meta_adset_id: value.adgroup_id ?? value.adset_id ?? null,
            meta_ad_id: value.ad_id ?? null,
            meta_form_name: formName,
        };

        const { data: lead, error: leadErr } = await supabaseAdmin
            .from('crm_leads').insert(leadData).select('id').single();
        if (leadErr) throw leadErr;

        await supabaseAdmin.from('crm_meta_leads')
            .update({
                status: 'processed', processed_lead_id: lead.id, processed_at: new Date().toISOString(),
                // Persist the full Q&A so the lead drawer can show every field.
                payload: { ...(value || {}), field_data: fields },
            })
            .eq('id', metaRow!.id);

        // Fire-and-forget email notification.
        notifyNewLead(config, leadData, assignedTo, formName).catch(() => {});

        // Fire-and-forget WhatsApp notification.
        NotificationService.afterLeadCreated(lead.id).catch(e => console.error('[Meta webhook] WA error:', e));

        return { leadgen_id: leadgenId, status: 'processed', lead_id: lead.id };
    } catch (err: any) {
        console.error('[Meta webhook] processing error:', err);
        await supabaseAdmin.from('crm_meta_leads')
            .update({ status: 'failed', error_message: err?.message || 'unknown', processed_at: new Date().toISOString() })
            .eq('id', metaRow!.id);
        return { leadgen_id: leadgenId, status: 'failed', error: err?.message };
    }
}

async function fetchLeadFields(leadgenId: string, pageAccessToken: string | null): Promise<Array<{ name: string; values: string[] }>> {
    if (!pageAccessToken) throw new Error('page_access_token not configured');
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?fields=field_data,created_time&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `Graph API error (${res.status})`);
    return json.field_data || [];
}
