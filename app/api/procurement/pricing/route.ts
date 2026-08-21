import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { PricingAndAliasService } from '@/backend/lib/procurement/pricingAndAliasService';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organization_id');
        const propertyId = searchParams.get('property_id');

        if (!organizationId) {
            return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
        }

        const items = await PricingAndAliasService.getCatalogWithSitePrices(organizationId, propertyId);
        return NextResponse.json({ items });
    } catch (err: any) {
        console.error('[Pricing GET Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { organization_id, item_id, property_id, unit_price, source } = body;

        if (!organization_id || !item_id || !property_id || unit_price === undefined) {
            return NextResponse.json({ error: 'Missing required fields: organization_id, item_id, property_id, unit_price' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // Upsert active site-specific price
        const { data, error } = await adminSupabase
            .from('item_site_prices')
            .upsert(
                {
                    organization_id,
                    item_id,
                    property_id,
                    unit_price: parseFloat(unit_price),
                    source: source || 'ADMIN_OVERRIDE',
                    is_active: true,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'item_id,property_id,is_active' }
            )
            .select('*')
            .single();

        if (error) {
            console.error('[Pricing POST DB Error]:', error);
            return NextResponse.json({ error: 'Failed to update site price', details: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, site_price: data });
    } catch (err: any) {
        console.error('[Pricing POST Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
