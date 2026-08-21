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

async function detailedJune26Analysis() {
    const filePath = "C:\\Users\\harsh\\Downloads\\June26.xlsx";
    const workbook = XLSX.readFile(filePath);

    // 1. Fetch DB Catalog
    const { data: dbCatalog } = await supabase
        .from('procurement_catalog')
        .select('id, name, unit, category, estimated_price')
        .eq('is_active', true);

    const dbLookup = new Map();
    dbCatalog.forEach(c => dbLookup.set(normalizeName(c.name), c));

    console.log(`Database Catalog count: ${dbCatalog.length}`);

    // Set of words that indicate header rows, not actual products
    const IGNORE_PHRASES = [
        'requisition format', 'product name/type', 'specific brand', 'details (color',
        'unit of measurement', 'we require', 'name:', 'sub:', 'place:', 'date:',
        'signed by', 'center name', 'sr. no', 'sr no', 'headings', 'description',
        'company name', 'mention in case', 'authorized', 'total', 'grand total'
    ];

    const extractedProducts = new Map(); // normalized -> { originalName, brand, details, unit, sheetCounts: Map<sheet, { reqQty, stockQty }> }

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!Array.isArray(row) || row.length < 3) continue;

            // In our standard template: Col 0 or 1 is Sr No, Col 1 or 2 is Product Name
            // Let's inspect Col 1 and Col 2
            let productName = '';
            let brand = '';
            let details = '';
            let reqQty = 0;
            let stockQty = 0;
            let unit = 'pcs';

            for (let c = 0; c < 4; c++) {
                const val = String(row[c] || '').trim();
                const normVal = normalizeName(val);

                if (val && !/^\d+$/.test(val) && val.length > 2) {
                    const isIgnored = IGNORE_PHRASES.some(p => normVal.includes(p));
                    if (!isIgnored) {
                        productName = val;
                        brand = String(row[c+1] || '').trim();
                        details = String(row[c+2] || '').trim();
                        reqQty = parseFloat(row[c+3] || '0');
                        stockQty = parseFloat(row[c+4] || '0');
                        unit = String(row[c+5] || 'pcs').trim() || 'pcs';
                        break;
                    }
                }
            }

            if (productName) {
                const norm = normalizeName(productName);
                if (!extractedProducts.has(norm)) {
                    extractedProducts.set(norm, {
                        originalName: productName,
                        brand: brand && brand !== 'NA' ? brand : '',
                        details: details && details !== 'NA' ? details : '',
                        unit: unit || 'pcs',
                        sheets: new Map([[sheetName, { reqQty, stockQty }]])
                    });
                } else {
                    extractedProducts.get(norm).sheets.set(sheetName, { reqQty, stockQty });
                }
            }
        }
    }

    console.log(`\n======================================================`);
    console.log(`TOTAL CLEAN EXTRACTED PRODUCTS FROM ALL SITES: ${extractedProducts.size}`);
    console.log(`======================================================\n`);

    const presentInDb = [];
    const missingFromDb = [];

    for (const [norm, prod] of extractedProducts.entries()) {
        let matched = dbLookup.get(norm);
        if (!matched) {
            // fuzzy match
            for (const [dbNorm, dbC] of dbLookup.entries()) {
                if (dbNorm.includes(norm) || norm.includes(dbNorm)) {
                    matched = dbC;
                    break;
                }
            }
        }

        const sheetNamesList = Array.from(prod.sheets.keys()).join(', ');

        if (matched) {
            presentInDb.push({
                product: prod.originalName,
                matchedDbName: matched.name,
                unit: prod.unit,
                sites: sheetNamesList
            });
        } else {
            missingFromDb.push({
                product: prod.originalName,
                brand: prod.brand,
                details: prod.details,
                unit: prod.unit,
                sites: sheetNamesList
            });
        }
    }

    console.log(`✅ PRESENT IN DB (${presentInDb.length} items)`);
    console.log(`⚠️ MISSING FROM DB (${missingFromDb.length} items)\n`);

    console.log('Sample Present in DB (First 10):');
    console.table(presentInDb.slice(0, 10));

    console.log('\nSample Missing from DB (First 20):');
    console.table(missingFromDb.slice(0, 20));

    // Save full analysis to a JSON report for quick review
    const fs = require('fs');
    fs.writeFileSync('scripts/june26_analysis_report.json', JSON.stringify({
        totalExtracted: extractedProducts.size,
        presentCount: presentInDb.length,
        missingCount: missingFromDb.length,
        presentInDb,
        missingFromDb
    }, null, 2));
    console.log('\nDetailed report written to scripts/june26_analysis_report.json');
}

detailedJune26Analysis();
