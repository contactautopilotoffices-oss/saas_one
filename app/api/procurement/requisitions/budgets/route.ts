import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { resolveCaller, isCallerError, forbidden, guardOrg, guardProperty, propertyOrgId } from '@/backend/lib/auth/callerAccess';
import { isProcurementAdmin } from '@/backend/lib/auth/procurementAccess';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organization_id') || searchParams.get('organizationId');
        const propertyId = searchParams.get('property_id') || searchParams.get('propertyId');
        const floorTag = searchParams.get('floor_tag') || searchParams.get('floorTag');

        if (!organizationId) {
            // Every organisation's budgets: master admins only.
            const caller = await resolveCaller(request);
            if (isCallerError(caller)) return caller;
            if (!caller.isMasterAdmin) return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
        } else {
            // Reading: internal members of the property (which must be in this organisation) or of the organisation.
            {
                const denied = propertyId
                        ? (await guardProperty(request, propertyId)) || ((await propertyOrgId(propertyId)) !== organizationId ? NextResponse.json({ error: 'Property does not belong to this organization' }, { status: 400 }) : null)
                        : await guardOrg(request, organizationId);
                if (denied) return denied;
            }
        }

        const adminSupabase = createAdminClient();

        let query = adminSupabase
            .from('property_monthly_requisition_budgets')
            .select(`
                *,
                property:properties!property_id(id, name, address, city)
            `)
            .order('site_name', { ascending: true });

        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }

        if (propertyId && propertyId !== 'all') {
            query = query.eq('property_id', propertyId);
        }

        if (floorTag && floorTag !== 'all') {
            query = query.eq('floor_tag', floorTag);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[Requisition Budgets GET Error]:', error);
            return NextResponse.json({ error: error.message, budgets: [] }, { status: 500 });
        }

        return NextResponse.json({ budgets: data || [] });
    } catch (err: any) {
        console.error('[Requisition Budgets GET Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', budgets: [] }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const adminSupabase = createAdminClient();
        const body = await request.json();

        // Support both single budget upsert and batch array upsert
        const rawBudgets = Array.isArray(body) ? body : (body.budgets || [body]);

        if (!rawBudgets || rawBudgets.length === 0) {
            return NextResponse.json({ error: 'No budget payload provided' }, { status: 400 });
        }

        // Build upsert rows and deduplicate by (org_id, property_id, floor_tag)
        const deduplicatedMap = new Map<string, any>();

        for (const b of rawBudgets) {
            const hkBudget = Number(b.hk_budget) || 0;
            const beverageBudget = Number(b.beverage_budget) || 0;
            const totalBudget = Number(b.total_budget) !== undefined && !isNaN(Number(b.total_budget)) && Number(b.total_budget) > 0 
                ? Number(b.total_budget) 
                : (hkBudget + beverageBudget);

            const floorTag = (b.floor_tag || 'All Floors').trim();
            const orgId = b.organization_id;
            const propId = b.property_id;

            if (!orgId || !propId) continue;

            const key = `${orgId}_${propId}_${floorTag.toLowerCase()}`;
            deduplicatedMap.set(key, {
                organization_id: orgId,
                property_id: propId,
                floor_tag: floorTag,
                site_name: b.site_name || b.property_name || '',
                hk_budget: hkBudget,
                beverage_budget: beverageBudget,
                total_budget: totalBudget,
                is_active: b.is_active !== undefined ? b.is_active : true,
                updated_at: new Date().toISOString()
            });
        }

        const upsertRows = Array.from(deduplicatedMap.values());

        // Procurement or admin of every organisation in the batch, and each property in its organisation.
        {
            const caller = await resolveCaller(request);
            if (isCallerError(caller)) return caller;
            for (const row of upsertRows as { organization_id?: string; property_id?: string }[]) {
                if (!row.organization_id || !isProcurementAdmin(caller, row.organization_id)) return forbidden('Forbidden: procurement or admin access is required');
                if (row.property_id && (await propertyOrgId(row.property_id)) !== row.organization_id) {
                    return NextResponse.json({ error: 'A property does not belong to its organization' }, { status: 400 });
                }
            }
        }

        if (upsertRows.length === 0) {
            return NextResponse.json({ error: 'organization_id and property_id are required for all budget items' }, { status: 400 });
        }

        const { data, error } = await adminSupabase
            .from('property_monthly_requisition_budgets')
            .upsert(upsertRows, { onConflict: 'organization_id,property_id,floor_tag' })
            .select(`
                *,
                property:properties!property_id(id, name, address, city)
            `);

        if (error) {
            console.error('[Requisition Budgets POST Error]:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, budgets: data });
    } catch (err: any) {
        console.error('[Requisition Budgets POST Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Budget ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        {
            const caller = await resolveCaller(request);
            if (isCallerError(caller)) return caller;
            const { data: row } = await adminSupabase.from('property_monthly_requisition_budgets').select('organization_id').eq('id', id).maybeSingle();
            if (!row) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
            if (!isProcurementAdmin(caller, row.organization_id)) return forbidden('Forbidden: procurement or admin access is required');
        }
        const { error } = await adminSupabase
            .from('property_monthly_requisition_budgets')
            .delete()
            .eq('id', id);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Requisition Budgets DELETE Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
