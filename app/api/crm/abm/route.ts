import { NextRequest, NextResponse } from 'next/server';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { getAbmClient } from '@/backend/lib/crm/abmClient';

/**
 * GET /api/crm/abm — account-based outbound, read from the ABM project.
 *
 * Read-only. The ABM system owns its own database (see docs/abm/) and Make
 * writes to it; nothing here mutates it.
 *
 * Access follows the same gate as every other CRM route: resolveCrmAccess.
 * Territory scoping deliberately does NOT apply — ABM leads carry no city and
 * no assignee, so there is nothing to scope by. The route is therefore limited
 * to CRM admins (bd_admin / bd_super_admin / org_admin / org_super_admin), who
 * already have whole-org visibility.
 */

const LEAD_COLUMNS = [
    'company',
    'company_domain',
    'target_area',
    'industry',
    'employees',
    'persona',
    'score',
    'stage',
    'campaign',
    'sequence_start',
    'stopped_at',
    'replied_at',
    'reply_intent',
    'li_connect_sent_at',
    'li_connected_at',
    'li_message_sent_at',
    'wa_intro_sent_at',
    'wa_followup_sent_at',
    'wa_final_sent_at',
    'called_at',
].join(',');

const MAX_LEADS = 2000;

// Furthest-along stage wins when a company has several contacts.
const STAGE_ORDER = [
    'dnc',
    'closed_lost',
    'new',
    'contacted',
    'replied',
    'called',
    'visit_booked',
    'proposal',
    'closed_won',
];

const SCORE_ORDER = ['COLD', 'WARM', 'HOT'];

interface AbmLead {
    company: string | null;
    company_domain: string | null;
    target_area: string | null;
    industry: string | null;
    employees: number | null;
    persona: string | null;
    score: string | null;
    stage: string | null;
    campaign: string | null;
    sequence_start: string | null;
    stopped_at: string | null;
    replied_at: string | null;
    reply_intent: string | null;
    li_connect_sent_at: string | null;
    li_connected_at: string | null;
    li_message_sent_at: string | null;
    wa_intro_sent_at: string | null;
    wa_followup_sent_at: string | null;
    wa_final_sent_at: string | null;
    called_at: string | null;
}

interface AbmAccount {
    company: string;
    domain: string | null;
    target_area: string | null;
    industry: string | null;
    employees: number | null;
    campaign: string | null;
    people: number;
    stage: string;
    score: string;
    day: number | null;
    personas: string[];
    touches: { li_invited: number; li_accepted: number; wa_sent: number; called: number };
    replied: number;
    reply_intent: string | null;
    live: number;
}

/** Day N of the 8-day sequence. Day 1 is the day it started. Mirrors abm_day(). */
function sequenceDay(sequenceStart: string | null): number | null {
    if (!sequenceStart) return null;
    const start = new Date(`${sequenceStart}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return null;
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const diffDays = Math.floor((todayUtc - start.getTime()) / 86_400_000);
    return diffDays + 1;
}

function rank(list: string[], value: unknown): number {
    const i = list.indexOf(String(value ?? ''));
    return i === -1 ? -1 : i;
}

export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;

    if (!access.isAdmin) {
        return NextResponse.json(
            { error: 'ABM is restricted to CRM admins' },
            { status: 403 }
        );
    }

    const abm = getAbmClient();
    if (!abm) {
        // Not an error: the integration simply has no credentials yet.
        return NextResponse.json({
            configured: false,
            reason:
                'ABM_SUPABASE_URL and ABM_SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.',
            totals: null,
            funnel: [],
            accounts: [],
        });
    }

    const { searchParams } = new URL(request.url);
    const campaign = searchParams.get('campaign');

    let leadQuery = abm.from('abm_leads').select(LEAD_COLUMNS).limit(MAX_LEADS);
    if (campaign) leadQuery = leadQuery.eq('campaign', campaign);

    const [leadsRes, funnelRes] = await Promise.all([
        leadQuery,
        abm.from('v_abm_funnel').select('*'),
    ]);

    if (leadsRes.error) {
        console.error('[crm/abm] lead read failed:', leadsRes.error.message);
        return NextResponse.json(
            { error: 'Could not read ABM leads', detail: leadsRes.error.message },
            { status: 502 }
        );
    }
    if (funnelRes.error) {
        console.error('[crm/abm] funnel read failed:', funnelRes.error.message);
    }

    const leads = (leadsRes.data || []) as unknown as AbmLead[];

    // Roll contacts up into the accounts the page lists.
    const byCompany = new Map<string, AbmAccount>();
    for (const l of leads) {
        const name = (l.company || '').trim() || 'Unknown company';
        const key = name.toLowerCase();
        let acc = byCompany.get(key);
        if (!acc) {
            acc = {
                company: name,
                domain: l.company_domain || null,
                target_area: l.target_area || null,
                industry: l.industry || null,
                employees: l.employees ?? null,
                campaign: l.campaign || null,
                people: 0,
                stage: l.stage || 'new',
                score: l.score || 'COLD',
                day: null,
                personas: [],
                touches: { li_invited: 0, li_accepted: 0, wa_sent: 0, called: 0 },
                replied: 0,
                reply_intent: null,
                live: 0,
            };
            byCompany.set(key, acc);
        }

        acc.people += 1;
        if (l.persona && !acc.personas.includes(l.persona)) acc.personas.push(l.persona);
        if (rank(STAGE_ORDER, l.stage) > rank(STAGE_ORDER, acc.stage)) acc.stage = l.stage ?? acc.stage;
        if (rank(SCORE_ORDER, l.score) > rank(SCORE_ORDER, acc.score)) acc.score = l.score ?? acc.score;
        if (!acc.target_area && l.target_area) acc.target_area = l.target_area;

        if (l.li_connect_sent_at) acc.touches.li_invited += 1;
        if (l.li_connected_at) acc.touches.li_accepted += 1;
        if (l.wa_intro_sent_at || l.wa_followup_sent_at || l.wa_final_sent_at) acc.touches.wa_sent += 1;
        if (l.called_at) acc.touches.called += 1;

        if (l.replied_at) {
            acc.replied += 1;
            // Keep the most decisive intent we have seen for the account.
            if (!acc.reply_intent || acc.reply_intent === 'unknown') acc.reply_intent = l.reply_intent;
            else if (l.reply_intent === 'interested') acc.reply_intent = 'interested';
        }

        if (l.sequence_start && !l.stopped_at && !l.replied_at) acc.live += 1;

        const day = sequenceDay(l.sequence_start);
        if (day !== null && (acc.day === null || day > acc.day)) acc.day = day;
    }

    const accounts = Array.from(byCompany.values()).sort((a, b) => {
        const s = rank(STAGE_ORDER, b.stage) - rank(STAGE_ORDER, a.stage);
        if (s !== 0) return s;
        if (b.people !== a.people) return b.people - a.people;
        return a.company.localeCompare(b.company);
    });

    const totals = {
        leads: leads.length,
        companies: accounts.length,
        in_sequence: leads.filter((l) => l.sequence_start && !l.stopped_at && !l.replied_at).length,
        replied: leads.filter((l) => l.replied_at).length,
        interested: leads.filter((l) => l.reply_intent === 'interested').length,
        visits_booked: leads.filter((l) => l.stage === 'visit_booked').length,
        truncated: leads.length === MAX_LEADS,
    };

    return NextResponse.json({
        configured: true,
        totals,
        funnel: funnelRes.error ? [] : funnelRes.data || [],
        accounts,
    });
}
