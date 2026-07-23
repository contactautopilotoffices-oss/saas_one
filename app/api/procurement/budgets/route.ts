import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { canUserSeePrices } from '@/backend/lib/procurement';
import { createClient as createServerClient } from '@/frontend/utils/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const propertyId = searchParams.get('propertyId');

        if (!propertyId) {
            return NextResponse.json({ error: 'Property ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        const { data, error } = await adminSupabase
            .from('procurement_budgets')
            .select('*')
            .eq('property_id', propertyId);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const supabase = await createServerClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        // Find organization_id from first budget or handle carefully
        const organizationId = data?.[0]?.organization_id;
        let canSeePrices = false;
        if (user && organizationId) {
            canSeePrices = await canUserSeePrices(user.id, organizationId, propertyId);
        }

        const maskedData = (data || []).map(b => ({
            ...b,
            total_amount: canSeePrices ? b.total_amount : null,
            spent_amount: canSeePrices ? b.spent_amount : null,
        }));

        return NextResponse.json(maskedData);
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { property_id, organization_id, budget_type, total_amount } = body;

        if (!property_id || !budget_type || total_amount === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        
        // Upsert budget for the current month/period
        // For simplicity, we'll assume a single active budget per type per property for now
        // A more complex system would handle period_start/end
        
        const { data, error } = await adminSupabase
            .from('procurement_budgets')
            .upsert({
                property_id,
                organization_id,
                budget_type,
                total_amount,
                period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'property_id,budget_type,period_start' })
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
