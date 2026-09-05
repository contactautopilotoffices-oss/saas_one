import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

// Whether the server has the Zoho OAuth credentials needed to actually sync.
// (The org id is stored per-org in accounts_zoho_config; these are global .env.)
function credsPresent(): boolean {
    return !!(
        Boolean(process.env.ZOHO_BOOKS_CLIENT_ID) &&
        Boolean(process.env.ZOHO_BOOKS_CLIENT_SECRET) &&
        Boolean(process.env.ZOHO_BOOKS_REFRESH_TOKEN)
    );
}

// GET /api/accounts/zoho-config — current connection state for the org.
export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const { data } = await supabaseAdmin
        .from('accounts_zoho_config')
        .select('zoho_organization_id, is_active, last_synced_at, last_sync_status')
        .eq('organization_id', access.organizationId)
        .maybeSingle();

    return NextResponse.json({
        config: data || { zoho_organization_id: null, is_active: true, last_synced_at: null, last_sync_status: null },
        creds_present: credsPresent(),
        can_edit: access.canAlign || access.isAdmin,
    });
}

// PUT /api/accounts/zoho-config — set the Zoho Books organization id / active flag.
export async function PUT(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    if (!access.canAlign && !access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const zohoOrgId = typeof body.zoho_organization_id === 'string' ? body.zoho_organization_id.trim() : '';
    // Zoho organization ids are all-numeric; reject anything else early with a clear message.
    if (zohoOrgId && !/^\d+$/.test(zohoOrgId)) {
        return NextResponse.json({ error: 'Zoho Organization ID must be numeric (e.g. 807372318)' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('accounts_zoho_config')
        .upsert(
            {
                organization_id: access.organizationId,
                zoho_organization_id: zohoOrgId || null,
                is_active: body.is_active !== false,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'organization_id' },
        )
        .select('zoho_organization_id, is_active, last_synced_at, last_sync_status')
        .single();

    if (error) {
        console.error('Zoho config save error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ config: data, creds_present: credsPresent() });
}
