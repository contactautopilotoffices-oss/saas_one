import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { addMissingRequisitionItems, getPropertyStockSource } from '@/backend/lib/stock/propertyStock';

/**
 * Adds a stock row (quantity 0) for any item procurement has put on this
 * property's monthly requisition list since the stock list was last opened.
 * Only for properties switched to requisition items. Never touches old items.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: property, error: propError } = await supabase
            .from('properties')
            .select('id, organization_id, code')
            .eq('id', propertyId)
            .maybeSingle();

        if (propError || !property) {
            return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        }

        if (await getPropertyStockSource(propertyId) !== 'catalog') {
            return NextResponse.json({ success: true, added: 0, total: 0 });
        }

        const result = await addMissingRequisitionItems(supabase, {
            organizationId: property.organization_id,
            propertyId,
            propertyCode: property.code,
            userId: user.id,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
