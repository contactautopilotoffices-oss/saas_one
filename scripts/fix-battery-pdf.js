#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const { jsPDF } = require('jspdf');

const EXCEL_FILE = 'Asset Details GF,1F,2F,3F (1).xlsx';
const OUTPUT_DIR = path.join(__dirname, '..', 'scratch');
const PDF_FILE = path.join(OUTPUT_DIR, 'asset_qr_labels_ss_plaza_batteries.pdf');

const ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';
const PROP_ID = '79ba1aa5-bf91-4956-9dbe-ce9986790b53';
const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function cellText(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

function parseNumber(v) {
    const n = Number(cellText(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 1;
}

async function main() {
    const workbook = XLSX.readFile(EXCEL_FILE);

    // Parse UPS sheet and floor sheets for Battery / Battery Bank rows.
    const batteryRows = [];

    const upsSheet = workbook.Sheets['UPS'];
    if (upsSheet) {
        const data = XLSX.utils.sheet_to_json(upsSheet, { header: 1, defval: '' });
        const header = data[0] || [];
        const nameIdx = header.findIndex((h) => /asset\s*description/i.test(cellText(h)));
        const stdIdx = header.findIndex((h) => /standard\s*asset/i.test(cellText(h)));
        const makeIdx = header.findIndex((h) => /make/i.test(cellText(h)));
        const modelIdx = header.findIndex((h) => /model/i.test(cellText(h)));
        const serialIdx = header.findIndex((h) => /serial/i.test(cellText(h)));
        const capIdx = header.findIndex((h) => /capacity/i.test(cellText(h)));
        const qtyIdx = header.findIndex((h) => /quantity/i.test(cellText(h)));
        const locIdx = header.findIndex((h) => /location/i.test(cellText(h)));

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const name = cellText(row[nameIdx]);
            const std = cellText(row[stdIdx]);
            if (!/battery/i.test(name) && !/battery/i.test(std)) continue;
            const qty = parseNumber(row[qtyIdx]);
            for (let q = 1; q <= qty; q++) {
                batteryRows.push({
                    name: `${std || name}${qty > 1 ? ` (${q}/${qty})` : ''}`,
                    description: name,
                    make: cellText(row[makeIdx]),
                    model: cellText(row[modelIdx]),
                    serial: cellText(row[serialIdx]),
                    capacity: cellText(row[capIdx]),
                    floor: 'Ground Floor',
                    location: cellText(row[locIdx]) || 'GF UPS Room',
                });
            }
        }
    }

    for (const sheetName of ['GF', '1st floor', '2nd floor', '3rd floor Corperate', '3rd Floor Tech&digi']) {
        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (data.length < 2) continue;
        const header = data[1] || [];
        const nameIdx = header.findIndex((h) => /asset\s*description/i.test(cellText(h)));
        const stdIdx = header.findIndex((h) => /standard\s*asset/i.test(cellText(h)));
        const makeIdx = header.findIndex((h) => /make/i.test(cellText(h)));
        const modelIdx = header.findIndex((h) => /model/i.test(cellText(h)));
        const serialIdx = header.findIndex((h) => /serial/i.test(cellText(h)));
        const capIdx = header.findIndex((h) => /capacity/i.test(cellText(h)));
        const qtyIdx = header.findIndex((h) => /quantity/i.test(cellText(h)));
        const locIdx = header.findIndex((h) => /location/i.test(cellText(h)));

        const floor = sheetName.toLowerCase() === 'gf' ? 'Ground Floor' : sheetName.replace(/floor/i, 'Floor');

        for (let i = 2; i < data.length; i++) {
            const row = data[i];
            const name = cellText(row[nameIdx]);
            const std = cellText(row[stdIdx]);
            if (!/battery/i.test(name) && !/battery/i.test(std)) continue;
            const qty = parseNumber(row[qtyIdx]);
            for (let q = 1; q <= qty; q++) {
                batteryRows.push({
                    name: `${std || name}${qty > 1 ? ` (${q}/${qty})` : ''}`,
                    description: name,
                    make: cellText(row[makeIdx]),
                    model: cellText(row[modelIdx]),
                    serial: cellText(row[serialIdx]),
                    capacity: cellText(row[capIdx]),
                    floor,
                    location: cellText(row[locIdx]),
                });
            }
        }
    }

    console.log(`Battery rows to import: ${batteryRows.length}`);

    // Resolve ELEC category.
    const { data: cat } = await supabase.from('asset_categories').select('id').eq('code', 'ELEC').maybeSingle();
    if (!cat) throw new Error('ELEC category not found');

    // Insert in batches, generating unique codes.
    const BATCH = 50;
    const created = [];
    const errors = [];

    for (let i = 0; i < batteryRows.length; i += BATCH) {
        const batch = batteryRows.slice(i, i + BATCH);
        const records = [];
        for (const row of batch) {
            const { data: code, error: genErr } = await supabase.rpc('generate_asset_code', {
                p_org_id: ORG_ID,
                p_property_id: PROP_ID,
                p_category_code: 'ELEC',
            });
            if (genErr) {
                errors.push({ name: row.name, error: genErr.message });
                continue;
            }
            records.push({
                organization_id: ORG_ID,
                property_id: PROP_ID,
                category_id: cat.id,
                asset_code: code,
                name: row.name,
                asset_type: row.description !== row.name ? row.description : null,
                make: row.make || null,
                model: row.model || null,
                serial_number: row.serial || null,
                floor: row.floor || null,
                location: row.location || null,
                status: 'active',
                notes: `Imported from SS Plaza asset register. Capacity: ${row.capacity || '-'}`,
            });
        }
        if (records.length === 0) continue;

        const { data: inserted, error } = await supabase.from('assets').insert(records).select('id, organization_id, property_id, asset_code, name, qr_token');
        if (error) {
            console.error(`Batch ${i / BATCH + 1} insert error:`, error.message);
            errors.push(...batch.map((r) => ({ name: r.name, error: error.message })));
            continue;
        }
        created.push(...inserted);
        await supabase.from('asset_events').insert(
            inserted.map((a) => ({
                asset_id: a.id,
                organization_id: a.organization_id,
                property_id: a.property_id,
                event_type: 'imported',
                title: 'Asset imported from Excel (battery fix)',
                created_by: null,
            })),
        );
    }

    console.log(`Imported: ${created.length}, Errors: ${errors.length}`);
    if (created.length === 0) return;

    // Generate PDF.
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const doc = new jsPDF('p', 'mm', 'a4');
    const COLS = 3, ROWS = 6, MARGIN = 8;
    const PAGE_W = 210, PAGE_H = 297;
    const CELL_W = (PAGE_W - MARGIN * 2) / COLS;
    const CELL_H = (PAGE_H - MARGIN * 2) / ROWS;
    const CARD_PAD = 1.5, QR_SIZE_MM = 30, QR_TOP_PAD = 1.5;
    const PILL_GAP = 1.5, PILL_H = 6.5, CODE_BASELINE = 2.6;
    const PINK_BORDER = [236, 72, 153], PINK_FILL = [253, 234, 241];
    const CARD_BORDER = [230, 230, 235], TEXT_DARK = [20, 20, 24], TEXT_MUTED = [140, 140, 148];

    function fitText(text, maxW, startSize, minSize) {
        let size = startSize;
        doc.setFontSize(size);
        while (size > minSize && doc.getTextWidth(text) > maxW) {
            size -= 0.5;
            doc.setFontSize(size);
        }
        if (doc.getTextWidth(text) <= maxW) return text;
        let cut = text;
        while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxW) cut = cut.slice(0, -1);
        return `${cut.trimEnd()}…`;
    }

    let col = 0, row = 0;
    for (let i = 0; i < created.length; i++) {
        const a = created[i];
        const url = `${APP_ORIGIN}/a/${a.qr_token}`;
        const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'H', width: 480, margin: 0 });
        if (i > 0 && col === 0 && row === 0) doc.addPage();

        const x = MARGIN + col * CELL_W;
        const y = MARGIN + row * CELL_H;
        const cardX = x + CARD_PAD;
        const cardY = y + CARD_PAD;
        const cardW = CELL_W - CARD_PAD * 2;

        doc.setDrawColor(...CARD_BORDER);
        doc.setLineWidth(0.25);
        doc.roundedRect(cardX, cardY, cardW, CELL_H - CARD_PAD * 2, 2.5, 2.5, 'S');

        const qrX = x + (CELL_W - QR_SIZE_MM) / 2;
        const qrY = cardY + QR_TOP_PAD;
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, QR_SIZE_MM, QR_SIZE_MM, undefined, 'FAST');

        const pillY = qrY + QR_SIZE_MM + PILL_GAP;
        const pillW = cardW - 3;
        const pillX = x + (CELL_W - pillW) / 2;
        doc.setFillColor(...PINK_FILL);
        doc.setDrawColor(...PINK_BORDER);
        doc.setLineWidth(0.3);
        doc.roundedRect(pillX, pillY, pillW, PILL_H, PILL_H / 2, PILL_H / 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...TEXT_DARK);
        const name = fitText(a.name, pillW - 4, 8, 6);
        doc.text(name, x + CELL_W / 2, pillY + PILL_H / 2 + 1, { align: 'center' });

        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...TEXT_MUTED);
        doc.text(a.asset_code, x + CELL_W / 2, pillY + PILL_H + CODE_BASELINE, { align: 'center' });

        col++;
        if (col >= COLS) { col = 0; row++; }
        if (row >= ROWS) { row = 0; }
    }

    doc.save(PDF_FILE);
    console.log(`Battery PDF saved: ${PDF_FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
