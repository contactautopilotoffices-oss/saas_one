import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

/**
 * PATCH /api/accounts/mailbox/[id] — tick a purchase-mailbox thread off, or reopen it.
 *
 * Exists so the toggle is enforced server-side like every other accounts write. The
 * table previously carried an RLS UPDATE policy keyed on bare org membership plus a
 * column GRANT, which meant any member — including the external maintenance-vendor and
 * super-tenant logins created by app/api/vendors/maintenance and app/api/super-tenant —
 * could resolve the purchase team's whole queue in one request, unattributably.
 *
 * resolved_at is stamped HERE, from the server clock, never from the browser: the sync's
 * reopen rule compares it against Zoho's server-side message timestamp
 * (backend/services/mailboxDigest.ts), so a client with a slow clock would make the
 * thread reopen on every run forever, and a client with a fast one could set a date far
 * enough ahead that no reply could ever reopen it.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.is_resolved !== 'boolean') {
        return NextResponse.json({ error: 'is_resolved (boolean) is required' }, { status: 400 });
    }

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;

    const resolved = body.is_resolved as boolean;

    // Scoped by organization_id as well as id, so a thread belonging to another org can
    // never be written even if its uuid reaches this handler.
    const { data, error } = await supabaseAdmin
        .from('mailbox_threads')
        .update({
            is_resolved: resolved,
            resolved_at: resolved ? new Date().toISOString() : null,
            resolved_by: resolved ? access.user.id : null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', access.organizationId)
        .select('id, is_resolved, resolved_at, resolved_by')
        .maybeSingle();

    if (error) {
        console.error('Mailbox thread PATCH error:', error);
        return NextResponse.json({ error: 'Failed to update the thread' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ thread: data });
}
