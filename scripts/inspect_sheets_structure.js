const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.readFile('C:\\Users\\harsh\\Downloads\\June26.xlsx');

const result = {};

for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    // Find all rows where there is a numeric Sr No followed by an item name
    const items = [];
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;

        // Check if row has an item
        // e.g. [..., 1, "Toilet Roll", "Any Brand", "-", 1300, "Pc", ...]
        for (let c = 0; c < row.length - 2; c++) {
            const possibleSrNo = row[c];
            const possibleName = String(row[c+1] || '').trim();
            const possibleBrand = String(row[c+2] || '').trim();
            const possibleDetails = String(row[c+3] || '').trim();
            const possibleQty = row[c+4];
            const possibleUnit = String(row[c+5] || '').trim();

            if (typeof possibleSrNo === 'number' && possibleName.length > 2 && !possibleName.toLowerCase().startsWith('headings')) {
                items.push({
                    srNo: possibleSrNo,
                    name: possibleName,
                    brand: possibleBrand,
                    details: possibleDetails,
                    qty: possibleQty,
                    unit: possibleUnit
                });
                break;
            }
        }
    }

    result[name] = {
        totalRows: rows.length,
        itemCount: items.length,
        sampleItems: items.slice(0, 5)
    };
}

console.log(JSON.stringify(result, null, 2));
