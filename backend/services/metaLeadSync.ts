import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveDistributionAssignee } from '@/backend/lib/crm/distribution';
import { NotificationService } from '@/backend/services/NotificationService';

/**
 * Meta Lead Ads polling sync.
 *
 * Pulls Lead Gen Form responses for an org's page and upserts new ones into
 * crm_leads (deduped by phone/email + crm_meta_leads). Used as a reliable
 * BACKSTOP to the real-time webhook — the cron runs it every few minutes so
 * leads always land even if a webhook delivery is missed (or the Meta app is
 * still in Development mode and webhooks don't fire).
 */

const GRAPH_VERSION = 'v19.0';

export interface MetaLeadSyncResult {
    orgId: string;
    status: 'ok' | 'skipped' | 'failed';
    inserted: number;
    skipped: number;
    failed: number;
    formsProcessed: number;
    error?: string;
}

function cleanPhone(raw: string | null): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
    return digits.replace(/^91/, '') || null;
}

async function fetchAllPages(path: string, token: string, cap = 300): Promise<any[]> {
    const out: any[] = [];
    let url: string | null = `https://graph.facebook.com/${GRAPH_VERSION}/${path}&access_token=${encodeURIComponent(token)}`;
    while (url) {
        const res: Response = await fetch(url);
        const json: any = await res.json();
        if (!res.ok) {
            // Surface API failures (expired/invalid token, permission, rate-limit)
            // instead of silently returning an empty list — a silent break makes an
            // auth failure look identical to "no leads", hiding real ingestion outages.
            const msg = json?.error?.message || `${res.status} ${res.statusText}`;
            throw new Error(`Meta Graph API error: ${msg}`);
        }
        out.push(...(json.data || []));
        url = json.paging?.next || null;
        if (out.length >= cap) break;
    }
    return out;
}

/**
 * Sync one org's Meta leads. `recentOnly` caps how many leads per form we scan
 * (cron uses a small cap for speed; a full backfill passes a large cap).
 */
export async function syncMetaLeadsForOrg(orgId: string, opts: { perFormCap?: number } = {}): Promise<MetaLeadSyncResult> {
    const base: MetaLeadSyncResult = { orgId, status: 'ok', inserted: 0, skipped: 0, failed: 0, formsProcessed: 0 };

    const { data: config } = await supabaseAdmin
        .from('crm_meta_config').select('*')
        .eq('organization_id', orgId).eq('is_active', true).maybeSingle();
    if (!config?.page_access_token) {
        return { ...base, status: 'skipped', error: 'No active Meta config / page token' };
    }

    const token = config.page_access_token;
    const pageId = config.page_id;
    const perFormCap = opts.perFormCap ?? 50;

    let forms: Array<{ id: string; name: string }> = [];
    try {
        const fd: any = await (await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/leadgen_forms?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`)).json();
        forms = fd.data || [];
    } catch (e: any) {
        return { ...base, status: 'failed', error: e?.message || 'forms fetch failed' };
    }
    if (!forms.length) return { ...base, status: 'ok', error: 'no forms' };

    const { data: adminUser } = await supabaseAdmin
        .from('organization_memberships').select('user_id')
        .eq('organization_id', orgId).in('role', ['bd_admin', 'org_super_admin', 'org_admin'])
        .eq('is_active', true).limit(1).maybeSingle();
    const createdBy = config.default_assignee || adminUser?.user_id;
    if (!createdBy) return { ...base, status: 'failed', error: 'no admin to own leads' };

    const { data: defStatus } = await supabaseAdmin
        .from('crm_lead_statuses').select('id').eq('is_default', true)
        .or(`organization_id.eq.${orgId},organization_id.is.null`)
        .order('organization_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const { data: metaSrc } = await supabaseAdmin
        .from('crm_lead_sources').select('id').ilike('name', '%Meta%')
        .or(`organization_id.eq.${orgId},organization_id.is.null`).limit(1).maybeSingle();

    for (const form of forms) {
        base.formsProcessed++;
        let formLeads: any[] = [];
        try {
            formLeads = await fetchAllPages(`${form.id}/leads?fields=id,created_time,field_data&limit=100`, token, perFormCap);
        } catch (e: any) {
            base.failed++;
            base.error = e?.message || 'form leads fetch failed';
            console.error('[metaLeadSync] form leads fetch failed', form.id, e?.message);
            continue;
        }

        for (const lead of formLeads) {
            const leadgenId = lead.id;
            const { data: existingMeta } = await supabaseAdmin
                .from('crm_meta_leads').select('id, status').eq('meta_lead_id', leadgenId).maybeSingle();
            if (existingMeta?.status === 'processed') { base.skipped++; continue; }

            const fields: Array<{ name: string; values: string[] }> = lead.field_data || [];
            const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const get = (...names: string[]) => {
                for (const n of names) {
                    const f = fields.find((x) => norm(x.name).includes(norm(n)));
                    if (f?.values?.[0]) return f.values[0];
                }
                return null;
            };
            const fullName = get('full_name', 'full name') || [get('first_name'), get('last_name')].filter(Boolean).join(' ') || get('name') || null;
            const email = get('email', 'work email', 'work_email');
            const phone = get('phone_number', 'phone', 'mobile_number', 'mobile');
            const city = get('city', 'preferred location', 'location');
            const seatsRaw = get('seat requirement', 'seat_requirement', 'number of seats', 'seats');
            const seatNums = (seatsRaw || '').match(/\d+/g)?.map((n) => parseInt(n)) || [];
            const seats = seatNums.length ? Math.max(...seatNums) : null;
            const moveIn = get('move in timeline', 'move_in_timeline', 'when do you want to move in', 'move in');
            const companyName = get('company name', 'company_name', 'organization');
            const jobTitle = get('job title', 'job_title', 'designation');

            const requirement = [
                seatsRaw ? `Seats: ${seatsRaw.replace(/_/g, ' ')}` : null,
                companyName ? `Company: ${companyName}` : null,
                jobTitle ? `Title: ${jobTitle}` : null,
            ].filter(Boolean).join(' | ') || null;

            const cleanedPhone = cleanPhone(phone);
            if (cleanedPhone || email) {
                const conditions: string[] = [];
                if (cleanedPhone) conditions.push(`contact_number.ilike.%${cleanedPhone}%`);
                if (email) conditions.push(`email.ilike.${email}`);
                const { data: existing } = await supabaseAdmin
                    .from('crm_leads').select('id').eq('organization_id', orgId)
                    .or(conditions.join(',')).limit(1).maybeSingle();
                if (existing) {
                    if (!existingMeta) {
                        // Mark this Meta lead as a duplicate of an existing CRM contact.
                        // NOTE: status MUST be one of the values allowed by the
                        // crm_meta_leads_status_check constraint ('pending','processed',
                        // 'failed','duplicate'). Writing an invalid value here previously
                        // threw and — because this insert is outside the try below —
                        // killed the ENTIRE org sync before new leads were reached,
                        // silently stalling Meta lead ingestion. Wrapped + valid now.
                        try {
                            await supabaseAdmin.from('crm_meta_leads').insert({
                                organization_id: orgId, meta_lead_id: leadgenId, form_id: form.id,
                                payload: lead, status: 'duplicate', processed_lead_id: existing.id,
                                processed_at: new Date().toISOString(),
                            });
                        } catch (e) {
                            console.error('[metaLeadSync] failed to mark duplicate', leadgenId, e);
                        }
                    }
                    base.skipped++;
                    continue;
                }
            }

            const distributionAssignee = await resolveDistributionAssignee(orgId, form.name, city).catch(() => null);
            // No fallback to a default admin — unmatched leads stay unassigned (null)
            // so they surface in the pool instead of dumping on one person.
            const assignedTo = distributionAssignee ?? config.default_assignee ?? null;

            try {
                const { data: newLead } = await supabaseAdmin.from('crm_leads').insert({
                    organization_id: orgId, created_by: createdBy, assigned_to: assignedTo,
                    company_name: companyName || fullName || 'Meta Lead', contact_person: fullName,
                    contact_number: cleanedPhone || phone, email, city, location: city, seats,
                    move_in_timeline: moveIn ? moveIn.replace(/_/g, ' ') : null, requirement,
                    status: defStatus?.id, priority: 'Medium',
                    lead_source: metaSrc?.id ?? config.default_lead_source ?? null,
                    campaign: form.name, meta_form_name: form.name, meta_lead_id: leadgenId,
                    created_at: lead.created_time ? new Date(lead.created_time).toISOString() : undefined,
                }).select('id').single();

                await supabaseAdmin.from('crm_meta_leads').upsert({
                    organization_id: orgId, meta_lead_id: leadgenId, form_id: form.id, payload: lead,
                    status: 'processed', processed_lead_id: newLead?.id, processed_at: new Date().toISOString(),
                }, { onConflict: 'meta_lead_id' });

                base.inserted++;

                if (newLead?.id) {
                    // Send notifications to BD team asynchronously
                    NotificationService.afterLeadCreated(newLead.id).catch(e => console.error(e));
                }

            } catch (err) { 
                console.error('Failed to process lead', err);
                base.failed++; 
            }
        }
    }

    // Record the run on the config for observability. Reflect failures so an
    // expired token / API outage shows up as 'failed' instead of a misleading 'ok'.
    if (base.failed > 0) base.status = 'failed';
    await supabaseAdmin.from('crm_meta_config')
        .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: base.failed > 0 ? 'failed' : 'ok',
        })
        .eq('organization_id', orgId);

    return base;
}
