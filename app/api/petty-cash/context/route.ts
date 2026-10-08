import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcError } from '@/backend/lib/pettyCash/api';
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    let query = supabaseAdmin.from('properties').select('id,name,code').eq('organization_id', access.organizationId).is('deleted_at', null).eq('is_active', true);
    if (access.propertyIds.length) query = query.in('id', access.propertyIds);
    else query = query.in('id', []);
    const [properties, wallet, routes, configurationProperties, counts] = await Promise.all([
        query.order('name'),
        access.isMasterAdmin && !access.roles.length ? Promise.resolve({ data: { balance: 0, received: 0, spent: 0, returned: 0, can_request: false, blocker: 'An active internal membership is required to request cash.' }, error: null }) : supabaseAdmin.rpc('pc_wallet', { actor: access.user.id, org: access.organizationId }),
        supabaseAdmin.from('petty_cash_property_assignments').select('property_id,user_id,kind,user:users!user_id(id,full_name,email)').eq('organization_id', access.organizationId).eq('is_active', true).eq('is_primary', true).in('property_id', access.propertyIds),
        access.canManageRouting ? supabaseAdmin.from('properties').select('id,name,code').eq('organization_id', access.organizationId).is('deleted_at', null).eq('is_active', true).order('name') : Promise.resolve({ data: [], error: null }),
        Promise.resolve(supabaseAdmin.rpc('pc_pending_counts', { actor: access.user.id, org: access.organizationId })).catch(()=>({data:null,error:{message:'Counts unavailable'}})),
    ]);
    const error = properties.error || wallet.error || routes.error || configurationProperties.error;
    if (error) return pcError(error);
    const ids = new Set((properties.data || []).map(p => p.id));
    return NextResponse.json({ organization_id: access.organizationId, user_id: access.user.id, properties: properties.data, configuration_properties: configurationProperties.data, wallet: wallet.data, counts: counts.error ? null : counts.data, counts_error: counts.error ? 'Pending counts are unavailable. Try Refresh.' : null, routes: (routes.data || []).filter(r => ids.has(r.property_id)), caps: { isAdmin: access.isAdmin, canManageRouting: access.canManageRouting, canAllocate: access.canAllocate, canApprove: access.canApprove, canDisburse: access.canDisburse } });
}
