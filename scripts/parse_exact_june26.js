const XLSX = require('xlsx');
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

async function parseExactJune26() {
    const filePath = "C:\\Users\\harsh\\Downloads\\June26.xlsx";
    const workbook = XLSX.readFile(filePath);

    // 1. Fetch DB Catalog
    const { data: dbCatalog } = await supabase
        .from('procurement_catalog')
        .select('id, name, unit, category, estimated_price')
        .eq('is_active', true);

    const dbLookup = new Map();
    dbCatalog.forEach(c => dbLookup.set(normalizeName(c.name), c));

    console.log(`Database Master Catalog items: ${dbCatalog.length}`);

    const extractedProducts = new Map(); // normalized_name -> { name, brand, details, unit, sites: Set() }
    const siteBreakdown = {};

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        let headerRowIdx = -1;
        let nameColIdx = 2;
        let brandColIdx = 3;
        let detailsColIdx = 4;
        let unitColIdx = 6;

        // Find table header row
        for (let r = 0; r < Math.min(rows.length, 25); r++) {
            const row = rows[r];
            for (let c = 0; c < row.length; c++) {
                const cell = String(row[c] || '').toLowerCase();
                if (cell.includes('product name') || cell.includes('particulars') || cell.includes('item name') || cell.includes('product')) {
                    headerRowIdx = r;
                    nameColIdx = c;
                    brandColIdx = c + 1;
                    detailsColIdx = c + 2;
                    unitColIdx = c + 4;
                    break;
                }
            }
            if (headerRowIdx !== -1) break;
        }

        let countForSite = 0;
        const siteItems = [];

        if (headerRowIdx !== -1) {
            for (let r = headerRowIdx + 1; r < rows.length; r++) {
                const row = rows[r];
                if (!Array.isArray(row) || row.length === 0) continue;

                const rawName = String(row[nameColIdx] || '').trim();
                const rawBrand = String(row[brandColIdx] || '').trim();
                const rawDetails = String(row[detailsColIdx] || '').trim();
                const rawUnit = String(row[unitColIdx] || 'pcs').trim() || 'pcs';

                if (rawName && 
                    rawName.length > 1 && 
                    !rawName.toLowerCase().startsWith('total') &&
                    !rawName.toLowerCase().startsWith('grand') &&
                    !rawName.toLowerCase().startsWith('signed') &&
                    !rawName.toLowerCase().startsWith('place') &&
                    !rawName.toLowerCase().startsWith('date') &&
                    !rawName.toLowerCase().startsWith('center') &&
                    !rawName.toLowerCase().startsWith('sub')
                ) {
                    const norm = normalizeName(rawName);
                    if (norm.length > 1) {
                        countForSite++;
                        siteItems.push(rawName);

                        if (!extractedProducts.has(norm)) {
                            extractedProducts.set(norm, {
                                name: rawName,
                                brand: rawBrand && rawBrand !== 'Any Brand' && rawBrand !== 'NA' ? rawBrand : 'NA',
                                details: rawDetails && rawDetails !== '-' && rawDetails !== 'NA' ? rawDetails : '',
                                unit: rawUnit || 'pcs',
                                sites: new Set([sheetName])
                            });
                        } else {
                            extractedProducts.get(norm).sites.add(sheetName);
                        }
                    }
                }
            }
        }

        siteBreakdown[sheetName] = {
            totalDetected: countForSite,
            sample: siteItems.slice(0, 3)
        };
    }

    console.log('\n--- SITE BY SITE ITEMS FOUND ---');
    console.table(siteBreakdown);

    // Cross reference against Database
    const matched = [];
    const missing = [];

    for (const [norm, prod] of extractedProducts.entries()) {
        let dbItem = dbLookup.get(norm);
        if (!dbItem) {
            // Check fuzzy
            for (const [dbNorm, dbC] of dbLookup.entries()) {
                if (dbNorm.includes(norm) || norm.includes(dbNorm)) {
                    dbItem = dbC;
                    break;
                }
            }
        }

        const sitesList = Array.from(prod.sites).join(', ');
        if (dbItem) {
            matched.push({
                sheetItemName: prod.name,
                matchedDbCatalogName: dbItem.name,
                unit: prod.unit,
                presentInSites: sitesList
            });
        } else {
            missing.push({
                sheetItemName: prod.name,
                brand: prod.brand,
                details: prod.details,
                unit: prod.unit,
                presentInSites: sitesList
            });
        }
    }

    console.log(`\n=============================================================`);
    console.log(`TOTAL UNIQUE PRODUCTS IN JUNE26.XLSX: ${extractedProducts.size}`);
    console.log(`✅ ALREADY IN MASTER CATALOG (DB):    ${matched.length}`);
    console.log(`⚠️ MISSING / NEW ITEMS TO ADD:        ${missing.length}`);
    console.log(`=============================================================\n`);

    console.log('Sample Matched Items:');
    console.table(matched.slice(0, 10));

    console.log('\nSample Missing Items:');
    console.table(missing.slice(0, 20));

    const fs = require('fs');
    fs.writeFileSync('scripts/june26_final_verification.json', JSON.stringify({
        totalUniqueProducts: extractedProducts.size,
        matchedCount: matched.length,
        missingCount: missing.length,
        matchedItems: matched,
        missingItems: missing
    }, null, 2));

    console.log('\nFull JSON breakdown written to scripts/june26_final_verification.json');
}

parseExactJune26();
