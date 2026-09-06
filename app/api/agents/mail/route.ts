/**
 * CONNECTED MAILBOXES — what the console shows and removes.
 *
 * GET    ?orgId=            the mailboxes this org has connected, their aliases
 *                           and their health. Never a token.
 * DELETE ?orgId=&id=        disconnect one. Org admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isOrgMember } from '@/backend/lib/ira/procurement/guard';
import { listMailAccounts, refreshMailAccountAddresses } from '@/backend/lib/mail/accounts';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(['org_admin', 'org_super_admin']);

async function gate(request: NextRequest, needAdmin: boolean) {
    const orgId = new URL(request.url).searchParams.get('orgId') ?? '';
    if (!UUID_RE.test(orgId)) return { error: NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 }) };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!(await isOrgMember(orgId, user.id))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    if (needAdmin) {
        const { data: m } = await supabaseAdmin.from('organization_memberships')
            .select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
        if (!m || !ADMIN_ROLES.has(String(m.role))) {
            return { error: NextResponse.json({ error: 'Org admin role required' }, { status: 403 }) };
        }
    }
    return { orgId, userId: user.id };
}

export async function GET(request: NextRequest) {
    const g = await gate(request, false);
    if ('error' in g) return g.error;

    const res = await listMailAccounts(g.orgId);
    // The one-time setup: is there an application to connect THROUGH at all?
    const appReady = Boolean(process.env.ZOHO_MAIL_APP_CLIENT_ID && process.env.ZOHO_MAIL_APP_CLIENT_SECRET);
    const keyReady = Boolean((process.env.MAIL_TOKEN_KEY ?? '').trim());

    if (!res.ok) {
        const needsMigration = /relation|does not exist/i.test(res.error ?? '');
        return NextResponse.json({
            provisioned: false, app_ready: appReady, key_ready: keyReady, accounts: [],
            error: needsMigration
                ? 'Connected mailboxes need migration 20260907000003_mail_accounts.sql.'
                : res.error,
        });
    }
    return NextResponse.json({ provisioned: true, app_ready: appReady, key_ready: keyReady, accounts: res.accounts });
}

/**
 * POST ?orgId=&address=   re-read the aliases on a connected mailbox.
 *
 * An alias added AFTER consent is invisible until this runs: the address list
 * was captured at connect time. Adding an alias is exactly how an agent gets
 * its own address, so this is a normal operation, not a repair.
 */
export async function POST(request: NextRequest) {
    const g = await gate(request, true);
    if ('error' in g) return g.error;
    const address = (new URL(request.url).searchParams.get('address') ?? '').trim();
    if (!address.includes('@')) return NextResponse.json({ error: 'address required' }, { status: 400 });

    const r = await refreshMailAccountAddresses(g.orgId, address);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({
        ok: true, addresses: r.addresses, added: r.added,
        note: r.added.length
            ? `Now also reading ${r.added.join(', ')}.`
            : 'No new addresses — the alias may not have been added yet, or is on a different mailbox.',
    });
}

export async function DELETE(request: NextRequest) {
    const g = await gate(request, true);
    if ('error' in g) return g.error;
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id (uuid) required' }, { status: 400 });

    const { error } = await supabaseAdmin.from('oem_mail_accounts')
        .delete().eq('organization_id', g.orgId).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // The token is gone from us, but the grant still exists on Zoho's side until
    // the owner revokes it. Say so rather than implying more than we did.
    return NextResponse.json({
        ok: true,
        note: 'Removed here. To fully revoke, the mailbox owner should remove this app under Zoho Account → Security → Connected Apps.',
    });
}
