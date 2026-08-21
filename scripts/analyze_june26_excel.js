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

async function analyzeJune26File() {
    const filePath = "C:\\Users\\harsh\\Downloads\\June26.xlsx";
    console.log(`Reading Excel file: ${filePath}`);

    let workbook;
    try {
        workbook = XLSX.readFile(filePath);
    } catch (err) {
        console.error('Failed to read Excel file:', err);
        return;
    }

    console.log(`Sheet Names found (${workbook.SheetNames.length}):`, workbook.SheetNames);

    // 1. Fetch existing catalog from database
    const { data: dbCatalog, error: dbErr } = await supabase
        .from('procurement_catalog')
        .select('id, name, unit, category, estimated_price')
        .eq('is_active', true);

    if (dbErr) {
        console.error('Database fetch error:', dbErr);
        return;
    }

    const dbLookup = new Map();
    dbCatalog.forEach(c => {
        dbLookup.set(normalizeName(c.name), c);
    });

    console.log(`\nExisting Master Catalog items in Database: ${dbCatalog.length}`);

    // 2. Parse all sheets
    const allExtractedItems = new Map(); // normalized_name -> { name, unit, price, sheets: Set() }
    const sheetSummaries = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        let sheetItemCount = 0;
        const sheetItems = [];

        // Try to identify header row and columns
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!Array.isArray(row) || row.length === 0) continue;

            // Look for row that has product/item name
            // Often columns: S.No | Product / Item | Brand | Size | Req Qty | Avail Qty | Unit | Rate | Amount
            for (let c = 0; c < row.length; c++) {
                const cellVal = String(row[c] || '').trim();
                // Simple heuristic: if cell is string, length > 2, not a header
                if (cellVal.length > 2 && 
                    !['sr no', 's.no', 'item', 'item name', 'product', 'particulars', 'description', 'brand', 'unit', 'qty', 'rate', 'price', 'amount', 'total', 'grand total', 'place', 'date', 'signed', 'center'].includes(cellVal.toLowerCase()) &&
                    !cellVal.toLowerCase().startsWith('total') &&
                    !cellVal.toLowerCase().startsWith('note') &&
                    !cellVal.toLowerCase().startsWith('place') &&
                    !cellVal.toLowerCase().startsWith('center')
                ) {
                    // Check if adjacent cells have quantities or units
                    const possibleUnit = String(row[c+1] || row[c+2] || row[c+3] || '').trim();
                    const possibleRate = parseFloat(row[c+2] || row[c+3] || row[c+4] || '0');

                    // If it looks like an item row
                    if (cellVal.length > 3 && !/^\d+$/.test(cellVal)) {
                        const norm = normalizeName(cellVal);
                        if (norm.length > 2) {
                            if (!allExtractedItems.has(norm)) {
                                allExtractedItems.set(norm, {
                                    originalName: cellVal,
                                    unit: possibleUnit || 'pcs',
                                    rate: possibleRate || 0,
                                    sheets: new Set([sheetName])
                                });
                            } else {
                                allExtractedItems.get(norm).sheets.add(sheetName);
                            }
                            sheetItems.push(cellVal);
                            sheetItemCount++;
                            break; // only take first item column per row
                        }
                    }
                }
            }
        }

        sheetSummaries.push({
            sheetName,
            totalRows: rows.length,
            detectedItems: sheetItemCount,
            sample: sheetItems.slice(0, 3)
        });
    }

    console.log('\n--- SHEET BREAKDOWN ---');
    console.log(JSON.stringify(sheetSummaries, null, 2));

    // 3. Match against Database
    const matched = [];
    const missing = [];

    for (const [norm, item] of allExtractedItems.entries()) {
        const dbItem = dbLookup.get(norm);
        if (dbItem) {
            matched.push({
                excelName: item.originalName,
                dbName: dbItem.name,
                dbUnit: dbItem.unit,
                sheets: Array.from(item.sheets)
            });
        } else {
            // Try fuzzy check
            let fuzzyMatch = null;
            for (const [dbNorm, dbC] of dbLookup.entries()) {
                if (dbNorm.includes(norm) || norm.includes(dbNorm)) {
                    fuzzyMatch = dbC;
                    break;
                }
            }

            if (fuzzyMatch) {
                matched.push({
                    excelName: item.originalName,
                    dbName: fuzzyMatch.name + ' (Fuzzy)',
                    dbUnit: fuzzyMatch.unit,
                    sheets: Array.from(item.sheets)
                });
            } else {
                missing.push({
                    excelName: item.originalName,
                    unit: item.unit,
                    sheets: Array.from(item.sheets)
                });
            }
        }
    }

    console.log(`\n=== RESULTS ===`);
    console.log(`Total Unique Items in Excel: ${allExtractedItems.size}`);
    console.log(`✅ Items Already in Database: ${matched.length}`);
    console.log(`⚠️ Missing / New Items in Excel: ${missing.length}`);
    console.log('\nSample Matched Items (First 5):', matched.slice(0, 5));
    console.log('\nSample Missing Items (First 15):', missing.slice(0, 15));
}

analyzeJune26File();
