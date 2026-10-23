import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
import { plainReasons } from '@/backend/lib/invoices/plainReasons';
import {
    DEFAULT_OWNER, ROLE_GROUPS, compareLine, expectedThisMonth, monthEnd, monthOf, prevMonth, shouldAutoPing, timingFor,
    type BountyKind, type OwnerRole,
} from './bountyRules';

/**
 * The AOP Bounty engine: works out what is missing for a month, keeps the list current, and
 * asks the owners. Idempotent: running it twice changes nothing the second time.
 *
 * Sources of bounties
 *   actual    every active AOP site x cost line with no actual for the month
 *   decision  an invoice in the review queue (does not agree with its PO)
 *   approval  a fast-track payment waiting for a decision
 *   mapping   a PO raised this month with no site or no Capex/Opex
 *   phone     an approved PO whose vendor had no WhatsApp number
 *
 * It closes a bounty when its fact arrives. It never writes an AOP figure.
 */

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

interface Row { id?: string; kind: BountyKind; site_id: string | null; line_item_id: string | null; source_type: string | null; source_id: string | null; title: string; detail: string | null; compare: { month: string; actual: number | null }[]; owner_role: OwnerRole; owner_user_id: string | null; status: 'waiting' | 'open'; expected_at: string | null; due_at: string }

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st, 22nd. */
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** Midnight IST at the start of a 'YYYY-MM-01' month, as an instant. */
const istStart = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) - 5.5 * 3_600_000).toISOString();

export interface GenerateSummary { month: string; created: number; updated: number; closed: number; open: number }

/** Build the month's bounties from the facts, upsert them, and close any whose fact has since arrived. */
export async function generateBounties(orgId: string, month: string, now = new Date()): Promise<GenerateSummary> {
    // Not set up yet: stop at once rather than fail one insert per site x line.
    const probe = await supabaseAdmin.from('aop_bounties').select('id', { head: true, count: 'exact' }).limit(1);
    if (probe.error) throw new Error(`aop_bounties: ${probe.error.message}`);
    const rows: Row[] = [];
    const keyOf = (r: { kind: string; site_id: string | null; line_item_id: string | null; source_id: string | null }) => `${r.kind}|${r.site_id ?? ''}|${r.line_item_id ?? ''}|${r.source_id ?? ''}`;

    // --- owners, expected dates, history --------------------------------------------------
    const [{ data: owners }, { data: expected }, { data: sites }, { data: lines }] = await Promise.all([
        supabaseAdmin.from('aop_line_owners').select('line_item_id, site_id, owner_user_id, owner_role').eq('organization_id', orgId),
        supabaseAdmin.from('aop_expected_dates').select('site_id, line_item_id, expected_day, cadence_months, cadence_anchor, vendor_name').eq('organization_id', orgId),
        supabaseAdmin.from('aop_sites').select('id, name, is_active').eq('organization_id', orgId),
        supabaseAdmin.from('aop_line_items').select('id, code, name, kind, feed_source').eq('organization_id', orgId).eq('kind', 'cost').order('sort_order'),
    ]);
    const ownerFor = (kind: BountyKind, lineId: string | null, siteId: string | null): { role: OwnerRole; user: string | null } => {
        const cands = (owners ?? []).filter((o) => (o.line_item_id == null || o.line_item_id === lineId) && (o.site_id == null || o.site_id === siteId));
        cands.sort((a, b) => (Number(!!b.line_item_id) + Number(!!b.site_id)) - (Number(!!a.line_item_id) + Number(!!a.site_id)));
        const best = cands[0];
        return { role: (best?.owner_role as OwnerRole) ?? DEFAULT_OWNER[kind], user: best?.owner_user_id ?? null };
    };
    const expectedBy = new Map((expected ?? []).map((e) => [`${e.site_id}|${e.line_item_id}`, e]));

    const activeSites = (sites ?? []).filter((s) => s.is_active !== false);
    const siteIds = activeSites.map((s) => s.id);
    const months = [month, prevMonth(month, 1), prevMonth(month, 2)];
    const { data: entries } = siteIds.length ? await supabaseAdmin.from('aop_entries').select('site_id, line_item_id, period_month, actual').eq('organization_id', orgId).in('site_id', siteIds).in('period_month', months) : { data: [] };
    const actualAt = new Map((entries ?? []).map((e) => [`${e.site_id}|${e.line_item_id}|${e.period_month}`, num(e.actual)]));

    // --- 1. actuals ----------------------------------------------------------------------------
    for (const s of activeSites) {
        for (const l of lines ?? []) {
            if (l.feed_source) continue; // fed automatically (electricity, diesel, water, petty cash): not something a person owes
            if (actualAt.get(`${s.id}|${l.id}|${month}`) != null) continue;
            const ex = expectedBy.get(`${s.id}|${l.id}`);
            if (ex && !expectedThisMonth(month, Number(ex.cadence_months), ex.cadence_anchor)) continue;
            const t = timingFor(month, ex?.expected_day ?? null, now);
            const o = ownerFor('actual', l.id, s.id);
            const compare = [prevMonth(month, 1), prevMonth(month, 2)].map((m) => ({ month: m, actual: actualAt.get(`${s.id}|${l.id}|${m}`) ?? null }));
            const vendor = ex?.vendor_name && ex?.expected_day ? ` ${ex.vendor_name} usually bills by the ${ordinal(ex.expected_day)}.` : ex?.expected_day ? ` Usually in by the ${ordinal(ex.expected_day)}.` : ' Expected date not set: say when this vendor normally bills.';
            rows.push({ kind: 'actual', site_id: s.id, line_item_id: l.id, source_type: null, source_id: null,
                title: `${s.name} · ${l.name}`, detail: `No figure for ${monthLabelLong(month)} yet.${vendor}`, compare,
                owner_role: o.role, owner_user_id: o.user, status: t.status, expected_at: t.expected_at?.toISOString() ?? null, due_at: t.due_at.toISOString() });
        }
    }

    // --- 2. invoices needing a decision -------------------------------------------------------
    const { data: inv } = await supabaseAdmin.from('invoices').select('id, invoice_number, invoice_total, match_status, po:zoho_purchase_orders(po_number, vendor_name)')
        .eq('organization_id', orgId).in('match_status', ['mismatched', 'needs_review', 'duplicate_suspected']).not('review_status', 'in', '(accepted,rejected,resubmission_required)').limit(200);
    const invIds = (inv ?? []).map((i) => i.id);
    const { data: rules } = invIds.length ? await supabaseAdmin.from('invoice_validation_results').select('invoice_id, rule_code, severity, outcome, invoice_line_no, expected_value, actual_value, difference_amount, explanation, resolved_at').in('invoice_id', invIds).eq('is_current', true) : { data: [] };
    for (const i of inv ?? []) {
        const po = (Array.isArray(i.po) ? i.po[0] : i.po) as { po_number?: string; vendor_name?: string } | null;
        const r = plainReasons((rules ?? []).filter((x) => x.invoice_id === i.id), i.match_status);
        const o = ownerFor('decision', null, null);
        rows.push({ kind: 'decision', site_id: null, line_item_id: null, source_type: 'invoice', source_id: i.id,
            title: `Invoice ${i.invoice_number ?? '(no number)'} · PO ${po?.po_number ?? '?'} · ${po?.vendor_name ?? ''}`.trim(),
            detail: r.reasons[0] ?? r.headline, compare: [], owner_role: o.role, owner_user_id: o.user, status: 'open', expected_at: null, due_at: monthEnd(month).toISOString() });
    }

    // --- 3. fast-track approvals ----------------------------------------------------------------
    const { data: ft } = await supabaseAdmin.from('invoice_fast_track_requests').select('id, requested_amount, urgency_reason, created_at, po:zoho_purchase_orders(po_number, vendor_name)').eq('organization_id', orgId).eq('status', 'pending_approval').limit(100);
    for (const f of ft ?? []) {
        const po = (Array.isArray(f.po) ? f.po[0] : f.po) as { po_number?: string; vendor_name?: string } | null;
        const o = ownerFor('approval', null, null);
        rows.push({ kind: 'approval', site_id: null, line_item_id: null, source_type: 'fast_track', source_id: f.id,
            title: `Urgent payment ₹${Math.round(Number(f.requested_amount)).toLocaleString('en-IN')} · PO ${po?.po_number ?? '?'} · ${po?.vendor_name ?? ''}`.trim(),
            detail: `Waiting for an approver since ${new Date(f.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. ${String(f.urgency_reason).slice(0, 120)}`,
            compare: [], owner_role: o.role, owner_user_id: o.user, status: 'open', expected_at: null, due_at: new Date(new Date(f.created_at).getTime() + 2 * 86_400_000).toISOString() });
    }

    // --- 4. POs that cannot be filed ------------------------------------------------------------
    const nextMonth = prevMonth(month, -1);
    const { data: pos } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, vendor_name, department, project_name').eq('organization_id', orgId).gte('po_date', month).lt('po_date', nextMonth).or('department.is.null,department.eq.,project_name.is.null,project_name.eq.').limit(200);
    for (const p of pos ?? []) {
        const missing = [!p.department && 'Capex/Opex', !p.project_name && 'site'].filter(Boolean).join(' and ');
        const o = ownerFor('mapping', null, null);
        rows.push({ kind: 'mapping', site_id: null, line_item_id: null, source_type: 'po', source_id: p.id, title: `PO ${p.po_number} · ${p.vendor_name ?? ''}`.trim(),
            detail: `No ${missing} on this PO, so its invoice cannot be filed or counted. Set it in Zoho Books.`, compare: [], owner_role: o.role, owner_user_id: o.user, status: 'open', expected_at: null, due_at: monthEnd(month).toISOString() });
    }

    // --- 5. vendors with no WhatsApp number ------------------------------------------------------
    const { data: noPhone } = await supabaseAdmin.from('po_vendor_notifications').select('po_id, zoho_po_id, sent_at').eq('organization_id', orgId).eq('status', 'no_phone').gte('sent_at', istStart(month)).lt('sent_at', istStart(nextMonth)).limit(200);
    const phonePoIds = [...new Set((noPhone ?? []).map((n) => n.po_id).filter(Boolean))] as string[];
    if (phonePoIds.length) {
        const { data: sent } = await supabaseAdmin.from('po_vendor_notifications').select('po_id').in('po_id', phonePoIds).eq('status', 'sent');
        const sentSet = new Set((sent ?? []).map((s) => s.po_id));
        const { data: ppo } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, vendor_name').in('id', phonePoIds.filter((id) => !sentSet.has(id)));
        for (const p of ppo ?? []) {
            const o = ownerFor('phone', null, null);
            rows.push({ kind: 'phone', site_id: null, line_item_id: null, source_type: 'po', source_id: p.id, title: `${p.vendor_name ?? 'Vendor'} · PO ${p.po_number}`,
                detail: 'Approved, but the vendor has no WhatsApp number, so the approved-PO message was not sent. Add the number in Zoho, then Send WhatsApp on the PO row.', compare: [], owner_role: o.role, owner_user_id: o.user, status: 'open', expected_at: null, due_at: monthEnd(month).toISOString() });
        }
    }

    // --- reconcile with what is stored --------------------------------------------------------------
    const { data: existing } = await supabaseAdmin.from('aop_bounties').select('id, kind, site_id, line_item_id, source_id, status, owner_user_id').eq('organization_id', orgId).eq('period_month', month);
    const have = new Map((existing ?? []).map((e) => [keyOf(e), e]));
    const want = new Map(rows.map((r) => [keyOf(r), r]));
    const nowIso = now.toISOString();
    let created = 0, updated = 0, closed = 0;

    for (const [k, r] of want) {
        const e = have.get(k);
        if (!e) {
            const { error } = await supabaseAdmin.from('aop_bounties').insert({ organization_id: orgId, period_month: month, ...r, updated_at: nowIso });
            if (!error) created++;
        } else if (e.status === 'waiting' || e.status === 'open') {
            // Refresh what can change without touching what a person did (owner they set, pings).
            const patch: Record<string, unknown> = { title: r.title, detail: r.detail, compare: r.compare, expected_at: r.expected_at, due_at: r.due_at, updated_at: nowIso };
            if (e.status === 'waiting' && r.status === 'open') patch.status = 'open';
            if (!e.owner_user_id && r.owner_user_id) { patch.owner_user_id = r.owner_user_id; patch.owner_role = r.owner_role; }
            await supabaseAdmin.from('aop_bounties').update(patch).eq('id', e.id);
            updated++;
        } else if (e.status === 'closed' && r.kind !== 'actual') {
            // A decision that came back (e.g. invoice re-flagged): reopen.
            await supabaseAdmin.from('aop_bounties').update({ status: 'open', closed_reason: null, closed_at: null, detail: r.detail, updated_at: nowIso }).eq('id', e.id);
            updated++;
        }
    }
    for (const [k, e] of have) {
        if (want.has(k) || e.status === 'closed') continue;
        // The fact arrived (actual landed, invoice decided, PO fixed, message sent): close it.
        await supabaseAdmin.from('aop_bounties').update({ status: 'closed', closed_reason: 'resolved', closed_at: nowIso, updated_at: nowIso }).eq('id', e.id);
        closed++;
    }
    const { count } = await supabaseAdmin.from('aop_bounties').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('period_month', month).in('status', ['waiting', 'open']);
    return { month, created, updated, closed, open: count ?? 0 };
}

function monthLabelLong(month: string) {
    return new Date(`${month}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// --- pinging ----------------------------------------------------------------------------------------

async function recipientsFor(orgId: string, role: OwnerRole, userId: string | null): Promise<{ id: string; email: string | null; name: string | null }[]> {
    let ids: string[] = [];
    if (userId) ids = [userId];
    else {
        const { data } = await supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', orgId).eq('is_active', true).in('role', ROLE_GROUPS[role]);
        ids = [...new Set((data ?? []).map((m) => m.user_id))];
    }
    if (!ids.length) return [];
    const { data: users } = await supabaseAdmin.from('users').select('id, email, full_name').in('id', ids);
    return (users ?? []).map((u) => ({ id: u.id, email: u.email ?? null, name: u.full_name ?? null }));
}

/** Ask the owner(s): a bell entry each, and one email. Recorded per recipient. */
export async function pingBounty(bountyId: string, opts: { trigger: 'auto' | 'manual' | 'escalation'; byUserId?: string | null; toRole?: OwnerRole }): Promise<{ sent: number; error?: string }> {
    const { data: b } = await supabaseAdmin.from('aop_bounties').select('*').eq('id', bountyId).maybeSingle();
    if (!b) return { sent: 0, error: 'Bounty not found' };
    const role = opts.toRole ?? (b.owner_role as OwnerRole);
    const people = await recipientsFor(b.organization_id, role, opts.toRole ? null : b.owner_user_id);
    if (!people.length) {
        await supabaseAdmin.from('aop_bounty_pings').insert({ bounty_id: bountyId, channel: 'bell', sent_by: opts.byUserId ?? null, trigger: opts.trigger, ok: false, error: `Nobody holds the ${role} role in this organisation.` });
        return { sent: 0, error: `Nobody holds the ${role} role in this organisation.` };
    }
    const link = APP_URL ? `${APP_URL}/${b.organization_id}/dashboard?tab=bounty` : '';
    const nowIso = new Date().toISOString();

    await supabaseAdmin.from('pending_actions').insert(people.map((p) => ({
        organization_id: b.organization_id, recipient_id: p.id, domain: 'aop_bounty', entity_type: 'aop_bounty', entity_id: bountyId,
        title: `${opts.trigger === 'escalation' ? 'Overdue: ' : ''}${b.title}`, description: b.detail, actions: ['view'], deep_link: `/${b.organization_id}/dashboard?tab=bounty`,
    })));
    const to = people.map((p) => p.email).filter(Boolean) as string[];
    let emailOk = true, emailErr: string | undefined;
    if (to.length) {
        const due = new Date(b.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const html = `<div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto">
            <p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748b;margin:0 0 6px">AOP Bounty · ${monthLabelLong(b.period_month)}</p>
            <h2 style="color:#0f172a;font-size:18px;margin:0 0 8px">${escape(b.title)}</h2>
            <p style="color:#334155;font-size:14px;margin:0 0 10px">${escape(b.detail ?? '')}</p>
            ${(b.compare as { month: string; actual: number | null }[]).length ? `<p style="color:#64748b;font-size:13px;margin:0 0 10px">Previous months: ${escape(compareLine(b.compare))}</p>` : ''}
            <p style="color:#334155;font-size:13px;margin:0 0 14px">Due by <b>${due}</b>.${opts.trigger === 'escalation' ? ' This is overdue and has been escalated to you.' : ''}</p>
            ${link ? `<p><a href="${link}" style="background:#2f6f73;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open the Bounty</a></p>` : ''}
        </div>`;
        try { await EmailService.sendEmail({ to, subject: `${opts.trigger === 'escalation' ? 'Overdue · ' : ''}${b.title} · due ${due}`, html }); }
        catch (e) { emailOk = false; emailErr = e instanceof Error ? e.message : String(e); }
    }
    await supabaseAdmin.from('aop_bounty_pings').insert(people.flatMap((p) => [
        { bounty_id: bountyId, channel: 'bell', recipient_id: p.id, sent_by: opts.byUserId ?? null, trigger: opts.trigger, ok: true },
        ...(p.email ? [{ bounty_id: bountyId, channel: 'email', recipient_id: p.id, sent_by: opts.byUserId ?? null, trigger: opts.trigger, ok: emailOk, error: emailErr ?? null }] : []),
    ]));
    await supabaseAdmin.from('aop_bounties').update({ ping_count: (b.ping_count ?? 0) + 1, last_pinged_at: nowIso, ...(opts.trigger === 'escalation' ? { escalated_at: nowIso } : {}), updated_at: nowIso }).eq('id', bountyId);
    return { sent: people.length };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** The daily run: refresh the month (and the previous one until its books close), ask, escalate. */
export async function runBountyDay(orgId: string, now = new Date()): Promise<{ months: GenerateSummary[]; pinged: number; escalated: number }> {
    const month = monthOf(now);
    const months = [month];
    // The previous month stays live until the 7th, when its invoices are expected to be in.
    if (new Date(now.getTime() + 5.5 * 3_600_000).getUTCDate() <= 7) months.push(prevMonth(month));
    const summaries: GenerateSummary[] = [];
    for (const m of [...new Set(months)]) summaries.push(await generateBounties(orgId, m, now));

    const { data: open } = await supabaseAdmin.from('aop_bounties').select('id, status, expected_at, last_pinged_at, due_at, escalated_at').eq('organization_id', orgId).in('status', ['open']).in('period_month', [...new Set(months)]).limit(500);
    let pinged = 0, escalated = 0;
    for (const b of open ?? []) {
        if (!b.escalated_at && new Date(b.due_at).getTime() < now.getTime()) {
            const r = await pingBounty(b.id, { trigger: 'escalation', toRole: 'operations' });
            if (r.sent) escalated++;
        } else if (shouldAutoPing(b, now)) {
            const r = await pingBounty(b.id, { trigger: 'auto' });
            if (r.sent) pinged++;
        }
    }
    return { months: summaries, pinged, escalated };
}
