/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * The AOP Bounty.
 *
 * GET  ?org_id=&month=YYYY-MM-01&view=open|mine|all&refresh=1
 *      Lists the month's bounties grouped for the inbox. refresh=1 regenerates first (cheap, idempotent).
 * POST {org_id, action, bounty_id, ...}
 *      ping                      ask the owner now
 *      answer {answer, note}     no_spend | coming_on (expected_day) | note — the owner replies
 *      expected {expected_day, cadence_months, cadence_anchor, vendor_name}   remembered for the cell
 *      assign {owner_user_id | owner_role}                                     who owes this (and this line from now on)
 *      reopen
 *
 * Audience = everyone the Payment Tracker admits (org super admins, ops super admins, accounts,
 * purchase). Property admins are not admitted, by the same rule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { dbError as invoiceDbError, isUuid } from '@/backend/lib/invoices/http';
import { isMissingTable } from '@/backend/lib/invoices/settings';

/** The Bounty's own tables missing means its migration is not applied yet: say which one. */
const dbError = (error: { code?: string; message?: string }) => (isMissingTable(error) || /aop_(bounties|line_owners|expected_dates|bounty_pings)/.test(error.message ?? '') && /does not exist|schema cache/i.test(error.message ?? '')
    ? NextResponse.json({ provisioned: false, error: 'AOP Bounty is not set up yet. Apply supabase/migrations/20261023000002_aop_bounty.sql.' }, { status: 503 })
    : invoiceDbError(error));
import { generateBounties, pingBounty } from '@/backend/lib/aop/bounty';
import { ROLE_GROUPS, compareLine, dayInMonth, groupOf, isOverdue, monthOf, urgency, type OwnerRole } from '@/backend/lib/aop/bountyRules';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ROLES: OwnerRole[] = ['purchase', 'accounts', 'operations', 'approver'];
const myRoles = (roles: string[]): OwnerRole[] => ROLES.filter((r) => roles.some((x) => ROLE_GROUPS[r].includes(x)));

export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;
    const sp = new URL(request.url).searchParams;
    const now = new Date();
    const month = /^\d{4}-\d{2}-01$/.test(sp.get('month') ?? '') ? sp.get('month')! : monthOf(now);
    const view = sp.get('view') ?? 'open';
    if (sp.get('refresh') === '1') {
        const g = await generateBounties(access.organizationId, month, now).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
        if ('error' in g) return dbError({ message: g.error });
    }

    let q = supabaseAdmin.from('aop_bounties').select('*, site:aop_sites(name), line:aop_line_items(name, code), owner:users!aop_bounties_owner_user_id_fkey(full_name)')
        .eq('organization_id', access.organizationId).eq('period_month', month);
    if (view === 'open') q = q.in('status', ['waiting', 'open']);
    if (view === 'mine') q = q.in('status', ['waiting', 'open']);
    const { data, error } = await q.order('due_at').limit(1000);
    if (error) return dbError(error);

    const mine = myRoles(access.roles);
    const items = (data ?? []).map((b) => {
        const when = b.last_pinged_at ?? b.answered_at ?? b.created_at;
        return {
            ...b,
            site_name: (b.site as { name?: string } | null)?.name ?? null,
            line_name: (b.line as { name?: string } | null)?.name ?? null,
            owner_name: (b.owner as { full_name?: string } | null)?.full_name ?? null,
            compare_line: compareLine(b.compare ?? []),
            urgency: urgency(b, now),
            overdue: isOverdue(b, now),
            group: groupOf(when, now),
            is_mine: b.owner_user_id === access.user.id || (!b.owner_user_id && mine.includes(b.owner_role)),
        };
    }).filter((b) => view !== 'mine' || b.is_mine);

    const counts = { open: 0, waiting: 0, overdue: 0, mine: 0, answered: 0, closed: 0 };
    for (const b of (data ?? [])) {
        if (b.status === 'open') counts.open++; if (b.status === 'waiting') counts.waiting++;
        if (b.status === 'answered') counts.answered++; if (b.status === 'closed') counts.closed++;
        if (isOverdue(b, now)) counts.overdue++;
    }
    counts.mine = items.filter((b) => b.is_mine && (b.status === 'open' || b.status === 'waiting')).length;
    return NextResponse.json({ month, items, counts, can_manage: access.isAdmin, roles: mine }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    const orgId = access.organizationId;
    const nowIso = new Date().toISOString();

    if (body.action === 'refresh') {
        const g = await generateBounties(orgId, /^\d{4}-\d{2}-01$/.test(body.month ?? '') ? body.month : monthOf(new Date()));
        return NextResponse.json(g);
    }
    if (!isUuid(body.bounty_id)) return NextResponse.json({ error: 'bounty_id is required.' }, { status: 400 });
    const { data: b } = await supabaseAdmin.from('aop_bounties').select('*').eq('id', body.bounty_id).eq('organization_id', orgId).maybeSingle();
    if (!b) return NextResponse.json({ error: 'Bounty not found.' }, { status: 404 });
    const isOwner = b.owner_user_id === access.user.id || (!b.owner_user_id && myRoles(access.roles).includes(b.owner_role));

    switch (body.action) {
        case 'ping': {
            const r = await pingBounty(b.id, { trigger: 'manual', byUserId: access.user.id });
            return r.error ? NextResponse.json({ error: r.error }, { status: 422 }) : NextResponse.json({ sent: r.sent });
        }
        case 'answer': {
            if (!isOwner && !access.isAdmin) return NextResponse.json({ error: 'Only the owner (or an admin) can answer this.' }, { status: 403 });
            const kind = String(body.answer ?? '');
            const note = String(body.note ?? '').trim().slice(0, 300);
            if (!['no_spend', 'coming_on', 'note'].includes(kind)) return NextResponse.json({ error: 'answer must be no_spend, coming_on or note.' }, { status: 400 });
            if (kind === 'note' && note.length < 3) return NextResponse.json({ error: 'Write a note.' }, { status: 400 });
            let patch: Record<string, unknown> = { answer: { kind, note: note || null, by: access.user.id }, answered_by: access.user.id, answered_at: nowIso, updated_at: nowIso };
            if (kind === 'no_spend') patch = { ...patch, status: 'answered', closed_reason: 'no_spend' };
            else if (kind === 'coming_on') {
                const day = Math.round(Number(body.expected_day));
                if (!(day >= 1 && day <= 31)) return NextResponse.json({ error: 'Give the day of the month it will be in by.' }, { status: 400 });
                const expectedAt = dayInMonth(b.period_month, day).toISOString(); // day 31 in November is the 30th
                patch = { ...patch, status: 'waiting', expected_at: expectedAt, answer: { kind, expected_day: day, note: note || null, by: access.user.id } };
                if (b.site_id && b.line_item_id) await supabaseAdmin.from('aop_expected_dates').upsert({ organization_id: orgId, site_id: b.site_id, line_item_id: b.line_item_id, expected_day: day, set_by: access.user.id, updated_at: nowIso }, { onConflict: 'site_id,line_item_id' });
            }
            const { error } = await supabaseAdmin.from('aop_bounties').update(patch).eq('id', b.id);
            if (error) return dbError(error);
            await supabaseAdmin.from('pending_actions').update({ status: 'done', resolved_at: nowIso, resolved_action: kind }).eq('entity_type', 'aop_bounty').eq('entity_id', b.id).eq('status', 'open');
            return NextResponse.json({ ok: true });
        }
        case 'expected': {
            if (!isOwner && !access.isAdmin) return NextResponse.json({ error: 'Only the owner (or an admin) can set the billing pattern.' }, { status: 403 });
            if (!b.site_id || !b.line_item_id) return NextResponse.json({ error: 'Only a site x line bounty has an expected date.' }, { status: 400 });
            const day = body.expected_day == null ? null : Math.round(Number(body.expected_day));
            if (day != null && !(day >= 1 && day <= 31)) return NextResponse.json({ error: 'Day must be 1 to 31.' }, { status: 400 });
            const cad = body.cadence_months == null ? 1 : Math.round(Number(body.cadence_months));
            if (!(cad >= 0 && cad <= 12)) return NextResponse.json({ error: 'Cadence is in months, 0 to 12.' }, { status: 400 });
            const anchor = /^\d{4}-\d{2}-01$/.test(body.cadence_anchor ?? '') ? body.cadence_anchor : null;
            const { error } = await supabaseAdmin.from('aop_expected_dates').upsert({ organization_id: orgId, site_id: b.site_id, line_item_id: b.line_item_id, expected_day: day, cadence_months: cad, cadence_anchor: anchor, vendor_name: String(body.vendor_name ?? '').slice(0, 120) || null, note: String(body.note ?? '').slice(0, 300) || null, set_by: access.user.id, updated_at: nowIso }, { onConflict: 'site_id,line_item_id' });
            if (error) return dbError(error);
            await generateBounties(orgId, b.period_month);
            return NextResponse.json({ ok: true });
        }
        case 'assign': {
            if (!access.isAdmin) return NextResponse.json({ error: 'Only an admin can assign owners.' }, { status: 403 });
            const user = isUuid(body.owner_user_id) ? body.owner_user_id : null;
            const role = ROLES.includes(body.owner_role) ? body.owner_role : null;
            if (!user && !role) return NextResponse.json({ error: 'Pick a person or a role.' }, { status: 400 });
            const patch = { owner_user_id: user, owner_role: role ?? b.owner_role, updated_at: nowIso };
            await supabaseAdmin.from('aop_bounties').update(patch).eq('id', b.id);
            if (b.line_item_id && body.remember !== false) {
                const siteId = body.this_site_only ? b.site_id : null;
                let existing = supabaseAdmin.from('aop_line_owners').select('id').eq('organization_id', orgId).eq('line_item_id', b.line_item_id);
                existing = siteId ? existing.eq('site_id', siteId) : existing.is('site_id', null);
                const { data: have } = await existing.maybeSingle();
                const row = { owner_user_id: user, owner_role: role, set_by: access.user.id, updated_at: nowIso };
                const { error: saveErr } = have
                    ? await supabaseAdmin.from('aop_line_owners').update(row).eq('id', have.id)
                    : await supabaseAdmin.from('aop_line_owners').insert({ organization_id: orgId, line_item_id: b.line_item_id, site_id: siteId, ...row });
                if (saveErr) return NextResponse.json({ error: `Assigned for this month, but not remembered for next month: ${saveErr.message}` }, { status: 500 });
            }
            return NextResponse.json({ ok: true });
        }
        case 'reopen': {
            if (!isOwner && !access.isAdmin) return NextResponse.json({ error: 'Only the owner (or an admin) can reopen this.' }, { status: 403 });
            // A row closed because its figure arrived would just close again on the next refresh.
            if (b.status !== 'answered') return NextResponse.json({ error: 'Only an answered item can be reopened.' }, { status: 409 });
            await supabaseAdmin.from('aop_bounties').update({ status: 'open', answer: null, answered_by: null, answered_at: null, closed_reason: null, closed_at: null, updated_at: nowIso }).eq('id', b.id);
            return NextResponse.json({ ok: true });
        }
        default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
}
