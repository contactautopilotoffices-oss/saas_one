/**
 * MEETINGS — who may host, who may join (PO-approvals topic).
 *
 * Host (create a session, end it, confirm decisions): super admins and ops
 * super admins — the people who approve POs or screen them.
 * Join (enter the room, see the agenda and transcript): the hosts plus the
 * purchase team, org admins and accounts — the people whose answers the
 * agenda needs.
 *
 * The agenda quotes PO numbers, vendors, properties and amounts — what the
 * Payment Tracker already shows accounts and org admins — so a site-level role
 * with no part in purchasing is deliberately not on the list. Nothing from the
 * purchase@ mailbox is on the agenda: several of these roles may not read it.
 * A future topic with a different audience gets its own role list here.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

const HOST_ROLES = ['org_super_admin', 'master_admin', 'ops_super_admin'];
const JOIN_ROLES = [...HOST_ROLES, 'org_admin', 'accounts', 'purchase_manager', 'purchase_executive', 'procurement'];

export interface MeetingViewer {
    userId: string;
    name: string;
    orgId: string;
    canHost: boolean;
}

/**
 * The signed-in person's standing in one organisation, or the response to
 * return instead. Master admins may host anywhere.
 */
export async function meetingViewer(orgId: string | null | undefined): Promise<MeetingViewer | NextResponse> {
    if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [profile, orgs, props] = await Promise.all([
        supabaseAdmin.from('users').select('full_name, is_master_admin').eq('id', user.id).maybeSingle(),
        supabaseAdmin.from('organization_memberships')
            .select('role').eq('user_id', user.id).eq('organization_id', orgId).eq('is_active', true),
        supabaseAdmin.from('property_memberships')
            .select('role').eq('user_id', user.id).eq('organization_id', orgId).eq('is_active', true),
    ]);

    const isMaster = Boolean(profile.data?.is_master_admin);
    const roles = [...(orgs.data ?? []), ...(props.data ?? [])].map((m) => String(m.role ?? ''));
    const canHost = isMaster || roles.some((r) => HOST_ROLES.includes(r));
    const canJoin = canHost || roles.some((r) => JOIN_ROLES.includes(r));
    if (!canJoin) {
        return NextResponse.json({ error: 'PO review meetings are open to approvers, the purchase team and accounts.' }, { status: 403 });
    }

    return {
        userId: user.id,
        name: String(profile.data?.full_name ?? user.email ?? 'Someone').trim() || 'Someone',
        orgId,
        canHost,
    };
}

export function isViewerError(x: MeetingViewer | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}
