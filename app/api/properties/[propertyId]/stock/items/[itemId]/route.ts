import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { getPropertyStockSource, isLiveStockItem, OLD_ITEM_LOCKED_MESSAGE, REQUISITION_LIST_LOCKED_MESSAGE } from '@/backend/lib/stock/propertyStock';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; itemId: string }> }
) {
    const { propertyId, itemId } = await params;
    const supabase = await createClient();

    try {
        const { data: item, error } = await supabase
            .from('stock_items')
            .select('*')
            .eq('id', itemId)
            .eq('property_id', propertyId)
            .single();

        if (error) {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, item });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; itemId: string }> }
) {
    const { propertyId, itemId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: existing } = await supabase
            .from('stock_items')
            .select('*')
            .eq('id', itemId)
            .eq('property_id', propertyId)
            .maybeSingle();
        if (existing && !(await isLiveStockItem(propertyId, existing))) {
            return NextResponse.json({ error: OLD_ITEM_LOCKED_MESSAGE }, { status: 409 });
        }

        const body = await request.json();
        const { name, category, unit, min_threshold, location, description } = body;

        const { data: item, error: updateError } = await supabase
            .from('stock_items')
            .update({
                ...(name && { name }),
                ...(category && { category }),
                ...(unit && { unit }),
                ...(min_threshold !== undefined && { min_threshold }),
                ...(location && { location }),
                ...(description && { description }),
                updated_at: new Date().toISOString(),
            })
            .eq('id', itemId)
            .eq('property_id', propertyId)
            .select()
            .single();

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, item });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; itemId: string }> }
) {
    const { propertyId, itemId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (await getPropertyStockSource(propertyId) === 'catalog') {
            return NextResponse.json({ error: REQUISITION_LIST_LOCKED_MESSAGE }, { status: 409 });
        }

        // Delete cascades to stock_movements due to FK
        const { error: deleteError } = await supabase
            .from('stock_items')
            .delete()
            .eq('id', itemId)
            .eq('property_id', propertyId);

        if (deleteError) {
            return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'Item deleted' });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
