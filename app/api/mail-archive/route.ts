/**
 * MAIL ARCHIVE — the roster and its health. SUPER ADMINS ONLY.
 *
 * GET  ?org_id=                          each rostered mailbox: connected or not,
 *                                        how far back history has been read, how
 *                                        many emails and texts are held, last run.
 *                                        Counts and health only — never a message.
 * POST ?org_id=  { address, action }     action: add | pause | resume.
 *
 * The archive holds personal work mailboxes, so this is narrower than the
 * purchase digest: procurement can read the digest, not this.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveMailboxAccess, isMailboxAccessError, readOrgId } from '@/backend/lib/mailbox/access';
import { grantForMailbox } from '@/backend/lib/mail/accounts';
import { isZohoMailConfigured, mailboxAddress } from '@/backend/services/zohoMailService';

export const dynamic = 'force-dynamic';

async function superAdmin(request: NextRequest, body?: unknown) {
    const access = await resolveMailboxAccess(request, readOrgId(request, body));
    if (isMailboxAccessError(access)) return { error: access };
    if (!access.isSuperAdmin) {
        return { error: NextResponse.json({ error: 'The mail archive is limited to super admins.' }, { status: 403 }) };
    }
    return { access };
}

const missingTable = (e: { code?: string; message?: string } | null) =>
    Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist/i.test(e.message ?? '')));

async function count(table: string, filter: Record<string, string>): Promise<number | null> {
    let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { count: n, error } = await q;
    return error ? null : n ?? 0;
}

export async function GET(request: NextRequest) {
    const g = await superAdmin(request);
    if ('error' in g) return g.error;
    const orgId = g.access.organizationId;

    const { data: rows, error } = await supabaseAdmin
        .from('mail_archive_mailboxes')
        .select('id, address, is_active, newest_received_at, backfill_oldest_at, backfill_done_at, last_run_at, last_ok_at, last_error, last_run_stats')
        .eq('organization_id', orgId)
        .order('added_at', { ascending: true });
    if (missingTable(error)) {
        return NextResponse.json({ provisioned: false, mailboxes: [], note: 'Apply supabase/migrations/20261006000002_mail_archive.sql.' });
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const envServes = orgId === process.env.ZOHO_MAIL_ORG_ID && isZohoMailConfigured();
    const mailboxes = await Promise.all((rows ?? []).map(async (r) => {
        const [connected, listed, done, pending, failed] = await Promise.all([
            grantForMailbox(orgId, r.address).then((x) => Boolean(x) || (envServes && r.address === mailboxAddress())),
            count('mail_archive_messages', { mailbox_id: r.id }),
            count('mail_archive_messages', { mailbox_id: r.id, body_state: 'done' }),
            count('mail_archive_messages', { mailbox_id: r.id, body_state: 'pending' }),
            count('mail_archive_messages', { mailbox_id: r.id, body_state: 'failed' }),
        ]);
        return {
            id: r.id,
            address: r.address,
            is_active: r.is_active,
            connected,
            listed,
            bodies: { done, pending, failed },
            oldest_at: r.backfill_oldest_at,
            newest_at: r.newest_received_at,
            history_done: Boolean(r.backfill_done_at),
            last_run_at: r.last_run_at,
            last_ok_at: r.last_ok_at,
            last_error: r.last_error,
            last_run: r.last_run_stats,
        };
    }));

    return NextResponse.json({
        provisioned: true,
        mailboxes,
        unique_emails_with_text: await count('mail_archive_bodies', { organization_id: orgId }),
    });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const g = await superAdmin(request, body);
    if ('error' in g) return g.error;
    const orgId = g.access.organizationId;

    const address = String(body?.address ?? '').trim().toLowerCase();
    const action = String(body?.action ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    if (action === 'add') {
        const { error } = await supabaseAdmin.from('mail_archive_mailboxes').upsert(
            { organization_id: orgId, address, added_by: g.access.user.id, is_active: true },
            { onConflict: 'organization_id,address' },
        );
        if (missingTable(error)) return NextResponse.json({ error: 'Apply supabase/migrations/20261006000002_mail_archive.sql first.' }, { status: 503 });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, note: `${address} is on the roster. It is read from the next run once its owner has connected it.` });
    }

    if (action === 'pause' || action === 'resume') {
        const { data, error } = await supabaseAdmin.from('mail_archive_mailboxes')
            .update({ is_active: action === 'resume' })
            .eq('organization_id', orgId).eq('address', address)
            .select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: `${address} is not on the roster.` }, { status: 404 });
        return NextResponse.json({ ok: true, note: action === 'pause' ? `${address} is paused. Nothing already archived is removed.` : `${address} resumes on the next run.` });
    }

    return NextResponse.json({ error: 'action must be add, pause or resume' }, { status: 400 });
}
