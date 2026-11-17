import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { countRealOldItems, getPropertyStockSource } from '@/backend/lib/stock/propertyStock';

/**
 * Which stock list this property uses, and whether it has an old list worth
 * showing. Read with the caller's client, so RLS decides who may see it.
 */
export async function GET(
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

        // Only for people who can see this property (RLS on properties decides).
        const { data: property } = await supabase
            .from('properties')
            .select('id')
            .eq('id', propertyId)
            .maybeSingle();
        if (!property) {
            return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        }

        const itemSource = await getPropertyStockSource(propertyId);
        const oldItemCount = itemSource === 'catalog' ? await countRealOldItems(supabase, propertyId) : 0;

        return NextResponse.json({
            success: true,
            item_source: itemSource,
            old_item_count: oldItemCount,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
