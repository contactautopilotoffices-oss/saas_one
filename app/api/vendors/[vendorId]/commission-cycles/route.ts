import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { resolveCaller, isCallerError, canUseProperty, propertyOrgId, forbidden } from '@/backend/lib/auth/callerAccess';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

// GET: Fetch commission cycles for a vendor
/** The vendor's owner may read its cycles; internal staff of the vendor's property may read and change them. */
async function vendorAccess(request: NextRequest, vendorId: string, write: boolean): Promise<NextResponse | null> {
    const caller = await resolveCaller(request);
    if (isCallerError(caller)) return caller;
    const { data: vendor } = await supabaseAdmin.from('vendors').select('id, user_id, property_id').eq('id', vendorId).maybeSingle();
    if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    if (!write && vendor.user_id && vendor.user_id === caller.userId) return null;
    const orgId = vendor.property_id ? await propertyOrgId(vendor.property_id) : null;
    return vendor.property_id && canUseProperty(caller, vendor.property_id, orgId) ? null : forbidden('Forbidden: no access to this vendor');
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const { vendorId } = await params;
    const denied = await vendorAccess(request, vendorId, false);
    if (denied) return denied;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status'); // 'in_progress' | 'payable' | 'paid' | 'overdue'

    let query = supabase
        .from('commission_cycles')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('cycle_start', { ascending: false });

    if (status) {
        query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get daily revenue for current cycle if there's an in_progress cycle
    const activeCycle = data?.find((c: any) => c.status === 'in_progress');
    let dailyBreakdown: any[] = [];

    if (activeCycle) {
        const { data: revenues } = await supabase
            .from('vendor_daily_revenue')
            .select('revenue_date, revenue_amount')
            .eq('vendor_id', vendorId)
            .gte('revenue_date', activeCycle.cycle_start)
            .lte('revenue_date', activeCycle.cycle_end)
            .order('revenue_date', { ascending: true });

        dailyBreakdown = revenues || [];
    }

    return NextResponse.json({
        cycles: data,
        current_cycle: activeCycle || null,
        daily_breakdown: dailyBreakdown,
    });
}

// POST: Create next commission cycle (called after payment)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const { vendorId } = await params;
    const denied = await vendorAccess(request, vendorId, true);
    if (denied) return denied;
    const supabase = await createClient();

    // Get vendor info
    const { data: vendor } = await supabase
        .from('vendors')
        .select('commission_rate, property_id')
        .eq('id', vendorId)
        .single();

    if (!vendor) {
        return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    }

    // Get latest cycle number
    const { data: lastCycle } = await supabase
        .from('commission_cycles')
        .select('cycle_number, cycle_end')
        .eq('vendor_id', vendorId)
        .order('cycle_number', { ascending: false })
        .limit(1)
        .single();

    const nextCycleNumber = (lastCycle?.cycle_number || 0) + 1;
    const cycleStart = lastCycle
        ? new Date(new Date(lastCycle.cycle_end).getTime() + 24 * 60 * 60 * 1000)
        : new Date();
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setDate(cycleEnd.getDate() + 14);

    const { data, error } = await supabase
        .from('commission_cycles')
        .insert({
            vendor_id: vendorId,
            property_id: vendor.property_id,
            cycle_number: nextCycleNumber,
            cycle_start: cycleStart.toISOString().split('T')[0],
            cycle_end: cycleEnd.toISOString().split('T')[0],
            commission_rate: vendor.commission_rate,
            status: 'in_progress',
        })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
}

// PATCH: Update cycle status (e.g., mark as payable or paid)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const { vendorId } = await params;
    const denied = await vendorAccess(request, vendorId, true);
    if (denied) return denied;
    const supabase = await createClient();
    const body = await request.json();

    if (!body.cycle_id) {
        return NextResponse.json({ error: 'Cycle ID required' }, { status: 400 });
    }

    const updateData: any = {
        status: body.status,
        updated_at: new Date().toISOString(),
    };

    if (body.status === 'paid') {
        updateData.paid_at = new Date().toISOString();
    }

    const { data, error } = await supabase
        .from('commission_cycles')
        .update(updateData)
        .eq('id', body.cycle_id)
        .eq('vendor_id', vendorId)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
