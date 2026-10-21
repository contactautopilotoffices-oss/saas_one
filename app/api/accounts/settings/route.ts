import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

// GET /api/accounts/settings — fetch Payment Tracker settings and eligible approver users
export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const orgId = access.organizationId;

    // Fetch existing settings
    const { data: settings, error: settingsError } = await supabaseAdmin
        .from('payment_tracker_settings')
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();

    if (settingsError && settingsError.code !== 'PGRST116') {
        return NextResponse.json({ error: settingsError.message }, { status: 500 });
    }

    // Fetch active members of this org to populate the Approver picker dropdown
    const { data: memberships, error: memError } = await supabaseAdmin
        .from('organization_memberships')
        .select(`
            user_id,
            role,
            user:users!organization_memberships_user_id_fkey(id, full_name, email, phone)
        `)
        .eq('organization_id', orgId)
        .eq('is_active', true);

    if (memError) {
        return NextResponse.json({ error: memError.message }, { status: 500 });
    }

    // Map eligible users
    const eligibleApprovers = (memberships || [])
        .map((m: any) => ({
            id: m.user?.id || m.user_id,
            full_name: m.user?.full_name || 'Unnamed User',
            email: m.user?.email || '',
            phone: m.user?.phone || '',
            role: m.role || 'staff',
        }))
        .filter((u: any) => Boolean(u.id));

    return NextResponse.json({
        settings: settings || {
            organization_id: orgId,
            approver_user_ids: [],
            auto_pre_align: true,
            notify_via_whatsapp: true,
            notify_via_email: true,
        },
        eligible_approvers: eligibleApprovers,
    });
}

// POST /api/accounts/settings — update Payment Tracker settings (Org Admin / Super Admin only)
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;

    // Only org admins, master admins, or ops super admins can modify approver settings
    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'Forbidden: only organization admins can change payment settings' }, { status: 403 });
    }

    const orgId = access.organizationId;
    const approverUserIds = Array.isArray(body.approver_user_ids) ? body.approver_user_ids : [];
    const autoPreAlign = body.auto_pre_align !== undefined ? Boolean(body.auto_pre_align) : true;
    const notifyViaWhatsapp = body.notify_via_whatsapp !== undefined ? Boolean(body.notify_via_whatsapp) : true;
    const notifyViaEmail = body.notify_via_email !== undefined ? Boolean(body.notify_via_email) : true;

    const payload = {
        organization_id: orgId,
        approver_user_ids: approverUserIds,
        auto_pre_align: autoPreAlign,
        notify_via_whatsapp: notifyViaWhatsapp,
        notify_via_email: notifyViaEmail,
        updated_at: new Date().toISOString(),
        updated_by: access.user.id,
    };

    const { data, error } = await supabaseAdmin
        .from('payment_tracker_settings')
        .upsert(payload, { onConflict: 'organization_id' })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings: data });
}
