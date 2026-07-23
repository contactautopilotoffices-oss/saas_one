import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveDistributionAssignee } from '@/backend/lib/crm/distribution';
import { NotificationService } from '@/backend/services/NotificationService';
import {
    LinkedInConfig,
    LinkedInAuthError,
    linkedinGet,
    urnId,
} from '@/backend/services/linkedinClient';

/**
 * LinkedIn Lead Gen Forms sync.
 *
 * LinkedIn has no real-time lead webhook (unlike Meta), so we POLL the
 * `leadFormResponses` endpoint on a schedule. Each response is mapped to a
 * crm_leads row with the same dedup + round-robin distribution rules used by
 * the Meta webhook.
 *
 *   - Cursor: crm_linkedin_config.last_lead_sync_at limits the query window.
 *   - Dedup: linkedin_lead_id (exact) + phone/email cross-source match.
 */

export interface LeadSyncResult {
    orgId: string;
    status: 'ok' | 'failed' | 'auth_error' | 'skipped';
    inserted: number;
    skipped: number;
    errors: string[];
}

function cleanPhone(raw: string | null): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
    return digits.replace(/^91/, '') || null;
}

/** Pull the answer for a question by fuzzy-matching the question text. */
function answerFor(answers: Array<{ question: string; answer: string }>, ...needles: string[]): string | null {
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const n of needles) {
        const hit = answers.find((a) => norm(a.question).includes(norm(n)));
        if (hit?.answer) return hit.answer;
    }
    return null;
}

async function findExistingLead(orgId: string, phone: string | null, email: string | null) {
    if (!phone && !email) return null;
    const conditions: string[] = [];
    const cleaned = cleanPhone(phone);
    if (cleaned) conditions.push(`contact_number.ilike.%${cleaned}%`);
    if (email) conditions.push(`email.ilike.${email}`);
    if (!conditions.length) return null;
    const { data } = await supabaseAdmin
        .from('crm_leads')
        .select('id')
        .eq('organization_id', orgId)
        .or(conditions.join(','))
        .limit(1)
        .maybeSingle();
    return data;
}

/**
 * Normalize a leadFormResponse into a flat {question, answer} list.
 * LinkedIn's shape: response.answers[].{ questionText / question, answerDetails.textQuestionAnswer.answer }
 */
function flattenAnswers(resp: any): Array<{ question: string; answer: string }> {
    const out: Array<{ question: string; answer: string }> = [];
    const answers = resp?.answers || resp?.formResponse?.answers || [];
    for (const a of answers) {
        const question = a.questionText || a.question || a.name || '';
        const answer =
            a.answerDetails?.textQuestionAnswer?.answer ??
            a.answer ??
            (Array.isArray(a.values) ? a.values[0] : '') ??
            '';
        if (question) out.push({ question: String(question), answer: String(answer ?? '') });
    }
    return out;
}

export async function syncLinkedInLeadsForOrg(cfg: LinkedInConfig): Promise<LeadSyncResult> {
    const errors: string[] = [];
    if (!cfg.is_active || !cfg.access_token || !cfg.ad_account_urn) {
        return { orgId: cfg.organization_id, status: 'skipped', inserted: 0, skipped: 0, errors: ['LinkedIn not connected / no ad account'] };
    }

    // Resolve system user + defaults (same approach as the Meta webhook).
    const createdBy = await resolveSystemUser(cfg);
    if (!createdBy) {
        return { orgId: cfg.organization_id, status: 'failed', inserted: 0, skipped: 0, errors: ['No admin user to own leads'] };
    }
    const [{ data: def }, sourceId] = await Promise.all([
        supabaseAdmin.from('crm_lead_statuses').select('id').eq('is_default', true)
            .or(`organization_id.eq.${cfg.organization_id},organization_id.is.null`)
            .order('organization_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
        resolveLinkedInSourceId(cfg),
    ]);

    // Poll lead form responses for this sponsored account. Window from the cursor
    // (default: last 30 days) to now.
    const sinceMs = cfg.last_lead_sync_at
        ? new Date(cfg.last_lead_sync_at).getTime()
        : Date.now() - 30 * 86400_000;

    let responses: any[] = [];
    try {
        responses = await fetchLeadResponses(cfg, sinceMs);
    } catch (err: any) {
        if (err instanceof LinkedInAuthError) {
            await markLeadSync(cfg, 'auth_error');
            return { orgId: cfg.organization_id, status: 'auth_error', inserted: 0, skipped: 0, errors: [err.message] };
        }
        await markLeadSync(cfg, 'failed');
        return { orgId: cfg.organization_id, status: 'failed', inserted: 0, skipped: 0, errors: [err?.message || 'fetch failed'] };
    }

    let inserted = 0;
    let skipped = 0;

    for (const resp of responses) {
        const leadId = resp.id || resp.leadGenFormResponse || resp.formResponse?.id;
        if (!leadId) { skipped++; continue; }

        // Exact dedup by linkedin_lead_id.
        const { data: dupe } = await supabaseAdmin
            .from('crm_leads').select('id').eq('linkedin_lead_id', String(leadId)).maybeSingle();
        if (dupe) { skipped++; continue; }

        const answers = flattenAnswers(resp);
        const firstName = answerFor(answers, 'first name', 'firstname');
        const lastName = answerFor(answers, 'last name', 'lastname');
        const fullName = answerFor(answers, 'full name') || [firstName, lastName].filter(Boolean).join(' ') || null;
        const email = answerFor(answers, 'email', 'work email');
        const phone = answerFor(answers, 'phone', 'phone number', 'mobile');
        const city = answerFor(answers, 'city', 'location', 'preferred location');
        const company = answerFor(answers, 'company name', 'company', 'organization');
        const jobTitle = answerFor(answers, 'job title', 'title', 'designation');
        const seatsRaw = answerFor(answers, 'seat requirement', 'number of seats', 'seats');
        const moveIn = answerFor(answers, 'move in timeline', 'move-in', 'timeline');
        const seatNums = (seatsRaw || '').match(/\d+/g)?.map((n) => parseInt(n)) || [];
        const seats = seatNums.length ? Math.max(...seatNums) : null;

        const cleaned = cleanPhone(phone);
        const existing = await findExistingLead(cfg.organization_id, phone, email);
        if (existing) {
            // Tag the existing lead with the LinkedIn id so we don't re-evaluate it.
            await supabaseAdmin.from('crm_leads').update({ linkedin_lead_id: String(leadId) }).eq('id', existing.id);
            skipped++;
            continue;
        }

        const campaignName = resp.campaignName || resp.campaign || urnId(resp.campaign) || 'LinkedIn Lead Gen';
        const assignedTo = (await resolveDistributionAssignee(cfg.organization_id, campaignName, city).catch(() => null))
            ?? cfg.default_assignee ?? null;

        const requirement = [
            seatsRaw ? `Seats: ${seatsRaw}` : null,
            company ? `Company: ${company}` : null,
            jobTitle ? `Title: ${jobTitle}` : null,
        ].filter(Boolean).join(' | ') || null;

        const { data: newLead, error: insErr } = await supabaseAdmin.from('crm_leads').insert({
            organization_id: cfg.organization_id,
            created_by: createdBy,
            assigned_to: assignedTo,
            company_name: company || fullName || 'LinkedIn Lead',
            contact_person: fullName,
            contact_number: cleaned || phone,
            email,
            city,
            location: city,
            seats,
            move_in_timeline: moveIn,
            requirement,
            status: def?.id,
            priority: 'Medium',
            lead_source: sourceId,
            property_interest: cfg.default_property ?? null,
            campaign: campaignName,
            linkedin_lead_id: String(leadId),
            // Real submission time so the lead doesn't appear "new" on import day.
            created_at: (() => {
                const ts = resp.submittedAt ?? resp.createdAt ?? resp.formResponse?.submittedAt;
                return typeof ts === 'number' ? new Date(ts).toISOString() : (ts ? new Date(ts).toISOString() : undefined);
            })(),
        }).select('id').single();
        if (insErr) { errors.push(insErr.message); skipped++; }
        else {
            inserted++;
            if (newLead?.id) {
                NotificationService.afterLeadCreated(newLead.id).catch(e => console.error(e));
            }
        }
    }

    await markLeadSync(cfg, 'ok');
    return { orgId: cfg.organization_id, status: 'ok', inserted, skipped, errors };
}

/** Fetch lead form responses for the org's sponsored account since `sinceMs`. */
async function fetchLeadResponses(cfg: LinkedInConfig, sinceMs: number): Promise<any[]> {
    const account = cfg.ad_account_urn!;
    // REST finder: leadFormResponses?q=owner&owner=(sponsoredAccount:...)&...
    // Paginated via `start`/`count`. We cap to a few pages per run.
    const out: any[] = [];
    let start = 0;
    const count = 100;
    for (let page = 0; page < 10; page++) {
        const path =
            `/leadFormResponses?q=owner` +
            `&owner=(sponsoredAccount:${encodeURIComponent(account)})` +
            `&submittedAtTimeRange=(start:${sinceMs})` +
            `&start=${start}&count=${count}`;
        const json = await linkedinGet(cfg, path);
        const elements: any[] = json.elements || [];
        out.push(...elements);
        if (elements.length < count) break;
        start += count;
    }
    return out;
}

async function resolveLinkedInSourceId(cfg: LinkedInConfig): Promise<string | null> {
    if (cfg.default_lead_source) return cfg.default_lead_source;
    const { data } = await supabaseAdmin
        .from('crm_lead_sources').select('id').ilike('name', '%LinkedIn%')
        .or(`organization_id.eq.${cfg.organization_id},organization_id.is.null`).limit(1).maybeSingle();
    return data?.id ?? null;
}

async function resolveSystemUser(cfg: LinkedInConfig): Promise<string | null> {
    if (cfg.default_assignee) return cfg.default_assignee;
    const [pm, om] = await Promise.all([
        supabaseAdmin.from('property_memberships').select('user_id').eq('organization_id', cfg.organization_id).in('role', ['bd_admin', 'org_super_admin', 'org_admin']).eq('is_active', true).limit(1),
        supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', cfg.organization_id).in('role', ['bd_admin', 'org_super_admin', 'org_admin']).eq('is_active', true).limit(1),
    ]);
    return pm.data?.[0]?.user_id || om.data?.[0]?.user_id || null;
}

async function markLeadSync(cfg: LinkedInConfig, status: string) {
    await supabaseAdmin.from('crm_linkedin_config').update({
        last_lead_sync_at: new Date().toISOString(),
        last_sync_status: status,
        updated_at: new Date().toISOString(),
    }).eq('id', cfg.id);
}
