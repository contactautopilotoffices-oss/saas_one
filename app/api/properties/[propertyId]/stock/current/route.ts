import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { getPropertyStockSource } from '@/backend/lib/stock/propertyStock';
import { itemSourceOf } from '@/frontend/lib/stock/itemSource';

/**
 * Update Current Stock: the site team types today's count for many items at once.
 * Each changed item gets a stock_movements row, 'initial' for its first ever entry
 * and 'adjust' for a recount, so every number has a history line.
 *
 * Body: { counts: [{ itemId, quantity }] }
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const counts: { itemId: string; quantity: number }[] = Array.isArray(body?.counts) ? body.counts : [];
        if (counts.length === 0) {
            return NextResponse.json({ error: 'counts array is required' }, { status: 400 });
        }

        const wanted = new Map<string, number>();
        for (const c of counts) {
            const raw = c?.quantity as unknown;
            const qty = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
            if (!c?.itemId || !Number.isFinite(qty) || qty < 0) {
                return NextResponse.json({ error: 'Each count needs an item and a quantity of 0 or more' }, { status: 400 });
            }
            wanted.set(c.itemId, qty);
        }

        const source = await getPropertyStockSource(propertyId);

        const { data: items, error: itemsError } = await supabase
            .from('stock_items')
            .select('*')
            .eq('property_id', propertyId)
            .in('id', [...wanted.keys()]);

        if (itemsError) {
            return NextResponse.json({ error: itemsError.message }, { status: 500 });
        }

        const liveItems = (items || []).filter(i => itemSourceOf(i) === source);
        const changed = liveItems.filter(i => Number(i.quantity) !== wanted.get(i.id));
        if (changed.length === 0) {
            return NextResponse.json({ success: true, updated: 0 });
        }

        const { data: moved } = await supabase
            .from('stock_movements')
            .select('item_id')
            .in('item_id', changed.map(i => i.id));
        const hasHistory = new Set((moved || []).map(m => m.item_id as string));

        let updated = 0;
        const failed: string[] = [];
        for (const item of changed) {
            const before = Number(item.quantity) || 0;
            const after = wanted.get(item.id)!;

            const { error: updateError } = await supabase
                .from('stock_items')
                .update({ quantity: after, updated_at: new Date().toISOString() })
                .eq('id', item.id);

            if (updateError) {
                failed.push(item.name);
                continue;
            }

            const firstEntry = !hasHistory.has(item.id);
            const { error: movementError } = await supabase.from('stock_movements').insert({
                item_id: item.id,
                property_id: propertyId,
                organization_id: item.organization_id,
                action: firstEntry ? 'initial' : 'adjust',
                quantity_change: after - before,
                quantity_before: before,
                quantity_after: after,
                user_id: user.id,
                notes: firstEntry ? 'Current stock entry' : 'Stock count updated',
            });

            if (movementError) failed.push(item.name);
            else updated++;
        }

        if (failed.length > 0) {
            return NextResponse.json({
                error: `Could not save ${failed.length} item(s): ${failed.slice(0, 5).join(', ')}`,
                updated,
            }, { status: 500 });
        }

        return NextResponse.json({ success: true, updated });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
