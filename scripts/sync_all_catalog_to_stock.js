const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
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

async function syncCatalogToAllPropertyStock() {
    console.log('=== SYNCING CATALOG & REQUISITION ITEMS TO STOCK MANAGEMENT ===');

    const organizationId = '211e1330-ad83-446d-941f-dcea48396798';

    // 1. Fetch properties
    const { data: properties } = await supabase.from('properties').select('id, name');
    console.log(`Found ${properties.length} properties.`);

    // 2. Fetch catalog items
    const { data: catalogItems } = await supabase
        .from('procurement_catalog')
        .select('id, name, unit, category, estimated_price')
        .eq('is_active', true);

    console.log(`Found ${catalogItems.length} catalog items.`);

    // 3. For each property, check existing stock_items and insert missing standard items
    for (const prop of properties) {
        const { data: existingStock } = await supabase
            .from('stock_items')
            .select('id, name, catalog_item_id')
            .eq('property_id', prop.id);

        const existingSet = new Set((existingStock || []).map(s => normalizeName(s.name)));

        const toInsert = [];
        for (const cat of catalogItems) {
            const norm = normalizeName(cat.name);
            if (!existingSet.has(norm)) {
                const itemCode = `STK-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
                toInsert.push({
                    organization_id: organizationId,
                    property_id: prop.id,
                    catalog_item_id: cat.id,
                    name: cat.name,
                    category: cat.category || 'HK',
                    unit: cat.unit || 'pcs',
                    item_code: itemCode,
                    quantity: 0, // default 0 until counted or received
                    min_threshold: 10,
                    unit_price: cat.estimated_price || 0
                });
                existingSet.add(norm);
            }
        }

        if (toInsert.length > 0) {
            const { error: insErr } = await supabase.from('stock_items').insert(toInsert);
            if (!insErr) {
                console.log(`✅ ${prop.name}: Added ${toInsert.length} items to stock management inventory.`);
            } else {
                console.error(`❌ ${prop.name} error:`, insErr.message);
            }
        } else {
            console.log(`ℹ️ ${prop.name}: Already has all catalog items in stock inventory.`);
        }
    }

    console.log('\n🎉 ALL PROPERTIES NOW HAVE FULL STOCK MANAGEMENT INVENTORIES!');
}

syncCatalogToAllPropertyStock();
