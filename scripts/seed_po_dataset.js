const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalizeText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[\-_,\.\(\)\[\]\/\|"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Canonical property alias mapping
const PROPERTY_ALIAS_MAP = {
    'etpl thane': 'ETPL Digitide',
    'etpl- thane': 'ETPL Digitide',
    'noida': 'Noida',
    'sky mark - noida': 'Noida',
    'arcil sky mark - noida': 'Noida',
    '3i sakinaka': '3i Cresent',
    '3i - crescent solitaire': '3i Cresent',
    'sigma 2nd floor': 'Rabale',
    '2nd floor - sigma it park': 'Rabale',
    'sigma 7th floor': 'Rabale',
    '7th floor - sigma it park': 'Rabale',
    'ss plaza': 'SS Plaza',
    'mahindra finance - delhi': 'Mahindra Finance - Delhi',
    'amr tech park': 'AMR Altruist',
    'charni road': 'Mafatlal Chambers , D wing',
    'd wing': 'Mafatlal Chambers , D wing',
    'c wing': 'Mafatlal Chambers , C wing',
    'b wing - mafatlal chambers': 'Mafatlal Chambers , B wing',
    'b wing - mafatlal': 'Mafatlal Chambers , B wing',
    'mafatlal chember -a wing': 'Mafatlal Chambers , A wing',
    'mafatlal ws': 'Mafatlal Chambers , A wing',
    'kolkata - bfdl': 'Bajaj Kolkata',
    'nrk star - indore': 'Indore',
    'mygate': 'MyGate',
    'mygate - vkg': 'MyGate',
};

async function seedPODataset(rawTsvData) {
    console.log('=== SEEDING HISTORICAL PO DATASET ===');

    const organizationId = '211e1330-ad83-446d-941f-dcea48396798';

    // 1. Fetch all properties
    const { data: properties } = await supabase.from('properties').select('id, name');
    const propNameToId = new Map();
    (properties || []).forEach(p => {
        propNameToId.set(normalizeText(p.name), p.id);
    });

    function resolvePropId(rawPropName) {
        const norm = normalizeText(rawPropName);
        if (PROPERTY_ALIAS_MAP[norm]) {
            const canonical = normalizeText(PROPERTY_ALIAS_MAP[norm]);
            if (propNameToId.has(canonical)) return propNameToId.get(canonical);
        }
        if (propNameToId.has(norm)) return propNameToId.get(norm);
        for (const [canonicalNorm, pId] of propNameToId.entries()) {
            if (norm.includes(canonicalNorm) || canonicalNorm.includes(norm)) {
                return pId;
            }
        }
        return null;
    }

    // 2. Parse lines
    const lines = rawTsvData.trim().split('\n');
    console.log(`Parsing ${lines.length} lines from PO dataset...`);

    const masterItemsMap = new Map();
    const sitePricesToInsert = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim() || line.startsWith('Line Item')) continue;

        const parts = line.split('\t');
        if (parts.length < 2) continue;

        const rawItemName = (parts[0] || '').trim();
        const price = parseFloat(parts[1] || '0');
        const unit = (parts[2] || 'pcs').trim() || 'pcs';
        const hsn = (parts[3] || '').trim();
        const applicableSites = (parts[4] || '').split(',').map(s => s.trim()).filter(Boolean);

        if (!rawItemName || price <= 0) continue;

        const cleanName = rawItemName
            .replace(/\[.*?\]/g, '')
            .replace(/\|\s*HSN\s*\d+/gi, '')
            .replace(/—\s*₹\d+/g, '')
            .replace(/\(FS\)/g, '')
            .trim();

        const normItem = normalizeText(cleanName);
        if (!masterItemsMap.has(normItem)) {
            let cat = 'HK';
            const lower = cleanName.toLowerCase();
            if (lower.includes('coffee') || lower.includes('tea') || lower.includes('sugar') || lower.includes('milk') || lower.includes('beverage') || lower.includes('biscuit')) {
                cat = 'Beverages';
            } else if (lower.includes('paper') || lower.includes('pen') || lower.includes('marker') || lower.includes('file') || lower.includes('register') || lower.includes('tape') || lower.includes('pencil')) {
                cat = 'Stationery';
            } else if (lower.includes('machine') || lower.includes('pipe') || lower.includes('motor') || lower.includes('wheel')) {
                cat = 'Technical';
            }

            masterItemsMap.set(normItem, {
                organization_id: organizationId,
                name: cleanName,
                category: cat,
                unit: unit || 'pcs',
                estimated_price: price,
                unit_price: price,
                is_active: true
            });
        }

        // Map applicable site prices
        for (const siteName of applicableSites) {
            const propId = resolvePropId(siteName);
            if (propId) {
                sitePricesToInsert.push({
                    organization_id: organizationId,
                    normItem,
                    property_id: propId,
                    unit_price: price,
                    source: `PO_HISTORICAL: ${siteName}`,
                    is_active: true
                });
            }
        }
    }

    console.log(`Extracted ${masterItemsMap.size} unique master items and ${sitePricesToInsert.length} site price entries.`);

    // 3. Upsert master items
    const masterItemsList = Array.from(masterItemsMap.values());
    for (const item of masterItemsList) {
        const { data: existing } = await supabase
            .from('procurement_catalog')
            .select('id')
            .eq('organization_id', organizationId)
            .ilike('name', item.name)
            .maybeSingle();

        if (!existing) {
            const { data: ins } = await supabase.from('procurement_catalog').insert(item).select('id').single();
            if (ins) item.id = ins.id;
        } else {
            item.id = existing.id;
        }
    }

    // 4. Upsert site prices
    let insertedPrices = 0;
    for (const sp of sitePricesToInsert) {
        const masterItem = masterItemsMap.get(sp.normItem);
        if (masterItem && masterItem.id) {
            const { error: spErr } = await supabase
                .from('item_site_prices')
                .upsert({
                    organization_id: sp.organization_id,
                    item_id: masterItem.id,
                    property_id: sp.property_id,
                    unit_price: sp.unit_price,
                    source: sp.source,
                    is_active: true,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'item_id,property_id,is_active' });

            if (!spErr) insertedPrices++;
            else console.error('Site price insert error:', spErr);
        }
    }

    console.log(`✅ Successfully seeded: ${masterItemsMap.size} master catalog items and ${insertedPrices} site-specific prices!`);
}

module.exports = { seedPODataset };
