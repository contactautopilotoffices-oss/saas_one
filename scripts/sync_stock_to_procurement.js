const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function syncStockToProcurement() {
    console.log('--- SYNCING STOCK ITEMS TO PROCUREMENT CATALOG ---');

    // 1. Fetch all stock items
    const { data: stockItems, error: fetchError } = await supabase
        .from('stock_items')
        .select('*');

    if (fetchError) {
        console.error('Error fetching stock items:', fetchError);
        return;
    }

    console.log(`Found ${stockItems.length} items in inventory.`);

    let syncedCount = 0;

    for (const item of stockItems) {
        // 2. Check if already in catalog
        const { data: existing } = await supabase
            .from('procurement_catalog')
            .select('id')
            .eq('stock_item_id', item.id)
            .maybeSingle();

        if (existing) {
            console.log(`Item "${item.name}" already in catalog. Skipping.`);
            continue;
        }

        // 3. Insert into catalog
        const { error: insertError } = await supabase
            .from('procurement_catalog')
            .insert({
                organization_id: item.organization_id,
                name: item.name,
                description: item.description,
                category: item.category,
                unit: item.unit || 'pcs',
                estimated_price: item.per_unit_cost || 0,
                stock_item_id: item.id,
                photo_url: null // Stock items don't have photos yet in this schema
            });

        if (insertError) {
            console.error(`Failed to sync "${item.name}":`, insertError);
        } else {
            console.log(`Synced: ${item.name}`);
            syncedCount++;
        }
    }

    console.log(`--- FINISHED. Synced ${syncedCount} new items to catalog. ---`);
}

syncStockToProcurement();
