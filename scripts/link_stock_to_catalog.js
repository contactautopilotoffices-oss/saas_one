const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalizeName(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .replace(/[\-_,\.\(\)\[\]\/\|"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function linkStockItemsToMasterCatalog() {
    console.log('=== LINKING STOCK ITEMS TO MASTER CATALOG (NON-DESTRUCTIVE) ===');

    // 1. Fetch all catalog items
    const { data: catalogItems, error: catErr } = await supabase
        .from('procurement_catalog')
        .select('id, name')
        .eq('is_active', true);

    if (catErr || !catalogItems) {
        console.error('Error fetching procurement_catalog:', catErr);
        return;
    }

    const catalogLookup = new Map();
    catalogItems.forEach(c => {
        catalogLookup.set(normalizeName(c.name), c.id);
    });

    console.log(`Found ${catalogItems.length} master catalog items.`);

    // 2. Fetch unlinked stock_items
    const { data: stockItems, error: stockErr } = await supabase
        .from('stock_items')
        .select('id, name, property_id, catalog_item_id');

    if (stockErr || !stockItems) {
        console.error('Error fetching stock_items:', stockErr);
        return;
    }

    console.log(`Found ${stockItems.length} stock items in inventory.`);

    let linkedCount = 0;
    for (const item of stockItems) {
        const normStockName = normalizeName(item.name);
        let matchedCatalogId = catalogLookup.get(normStockName);

        if (!matchedCatalogId) {
            // Fuzzy search
            for (const [normCatName, catId] of catalogLookup.entries()) {
                if (normCatName.includes(normStockName) || normStockName.includes(normCatName)) {
                    matchedCatalogId = catId;
                    break;
                }
            }
        }

        if (matchedCatalogId && item.catalog_item_id !== matchedCatalogId) {
            const { error: updErr } = await supabase
                .from('stock_items')
                .update({ catalog_item_id: matchedCatalogId })
                .eq('id', item.id);

            if (!updErr) {
                linkedCount++;
                console.log(`[LINKED] "${item.name}" -> catalog ID ${matchedCatalogId}`);
            }
        }
    }

    console.log(`\n🎉 Linking complete! Linked ${linkedCount} stock items to master catalog.`);
}

linkStockItemsToMasterCatalog();
