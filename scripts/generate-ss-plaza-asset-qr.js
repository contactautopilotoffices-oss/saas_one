#!/usr/bin/env node
'use strict';

/**
 * One-off script: read `Asset Details GF,1F,2F,3F (1).xlsx`, import physical
 * assets into SS Plaza, and generate a printable A4 PDF of round-edged QR
 * stickers. Each sticker encodes the public asset page `/a/<qr_token>`.
 *
 * Usage:
 *   node scripts/generate-ss-plaza-asset-qr.js --dry-run    # validate + preview
 *   node scripts/generate-ss-plaza-asset-qr.js --confirm    # write to DB + PDF
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const { jsPDF } = require('jspdf');

const EXCEL_FILE = 'Asset Details GF,1F,2F,3F (1).xlsx';
const OUTPUT_DIR = path.join(__dirname, '..', 'scratch');
const PDF_FILE = path.join(OUTPUT_DIR, 'asset_qr_labels_ss_plaza.pdf');

const ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';
const PROP_ID = '79ba1aa5-bf91-4956-9dbe-ce9986790b53';
const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ── Category classifier ─────────────────────────────────────────────────────
const CATEGORY_RULES = [
    { code: 'HVAC', patterns: [/\b(vrf|split\s*ac|casette|cassette|fresh\s*air|ahu|fcu|chiller|hvac|dx\s*unit|idu|odu|ac\s*unit|air\s*conditioner|condenser|evaporator)\b/i] },
    { code: 'IT', patterns: [/\b(hub\s*rack|jack\s*panel|hdd|server\s*rack|network\s*rack|switch|router|patch\s*panel|amplifier|public\s*announcement|call\s*station|led\s*tv|speaker|microphone|bms\s*rack|nvr\s*rack|poe\s*rack|bms\s*pc|computer|desktop|monitor|keyboard|mouse|cpu)\b/i] },
    { code: 'SEC', patterns: [/\b(cctv|camera|nvr|poe|access\s*controller|readers?|edr|turnstile|biometric|door\s*release|access\s*control|em\s*lock|electromagnetic\s*lock|door\s*buzzer|buzzer|hhmd|handheld\s*metal\s*detector|door\s*closer|frisking\s*booth)\b/i] },
    { code: 'FIRE', patterns: [/\b(smoke\s*detector|multi\s*detector|repeater\s*panel|fas\s*panel|fire\s*extinguisher|co2|dcp|clean\s*agent|rodent|water\s*leakage|wld|hooter|mcp|manual\s*call\s*point|sprinkler|hydrant)\b/i] },
    { code: 'FURN', patterns: [/\b(led\s*light|round\s*light|linear\s*led|cylinder\s*light|table|desk|chairs?|work\s*station|workstation|cubical|cubicle|bunker\s*bed|bunk\s*bed|pedestal|booth|locker|furniture|fixture|pantry|dining|cafe|sofa|cabinet|cupboard|wardrobe|mirror|wc\s|washroom\s|toilet)\b/i] },
    { code: 'ELEC', patterns: [/\b(ups\s|battery\s*bank|ats\s|breaker|rtcc|dg\s|msb|mlp|ltp|lt\s|incomer|outgoing|feeder|transformer|dg\s*panel|ups\s*msb|utility\s*panel|capacitor|eldb|rpdb|hub\s*room\s*db|bms\s*db|main\s*db|distribution\s*board|inverter|stabilizer|main\s*ltp)\b/i, /\b(exide\s*battery|battery\s*\d|\d+v\s*battery)\b/i, /\b\d+A\b/] },
];

function classifyCategory(name = '', standardName = '') {
    const text = `${name} ${standardName}`.toLowerCase();
    for (const rule of CATEGORY_RULES) {
        if (rule.patterns.some((p) => p.test(text))) return rule.code;
    }
    return 'OTHR';
}

// ── Floor normalizer ────────────────────────────────────────────────────────
const FLOOR_MAP = {
    'basement': 'Basement',
    'gf': 'Ground Floor',
    'ground floor': 'Ground Floor',
    '1st floor': '1st Floor',
    '2nd floor': '2nd Floor',
    '3rd floor corperate': '3rd Floor Corporate',
    '3rd floor tech&digi': '3rd Floor Tech & Digi',
    '3rd floor tech': '3rd Floor Tech & Digi',
    'cafeteria': 'Cafeteria',
};

function normalizeFloor(sheetName) {
    const key = String(sheetName).toLowerCase().trim();
    return FLOOR_MAP[key] || sheetName;
}

// ── Excel parsing helpers ───────────────────────────────────────────────────
function cellText(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).trim();
}

function parseNumber(v) {
    const n = Number(cellText(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function detectHeaderRow(grid) {
    for (let i = 0; i < Math.min(grid.length, 10); i++) {
        const row = grid[i] || [];
        const texts = row.map(cellText);
        const hasKnown = texts.some((t) =>
            /\b(asset\s*description|standard\s*asset|make\s*|model|serial|capacity|quantity|location|panel\s*name|name|asset\s*no|camera\s*no|installation\s*point|type|device\s*name)\b/i.test(t),
        );
        const nonEmpty = texts.filter((t) => t).length;
        if (hasKnown && nonEmpty >= 2) return i;
    }
    return -1;
}

function mapColumns(headerRow) {
    const map = {};
    headerRow.forEach((cell, idx) => {
        const t = cellText(cell).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (t.includes('assetdescription') || t === 'description') map.name = idx;
        else if (t.includes('standardasset') || t === 'standardname') map.standardName = idx;
        else if (t === 'make' || t === 'brand' || t === 'manufacturer') map.make = idx;
        else if (t.includes('model') || t === 'modelno') map.model = idx;
        else if (t.includes('serial') || t === 'sno' || t === 'slno' || t === 'device') map.serial = idx;
        else if (t === 'capacity' || t === 'rating') map.capacity = idx;
        else if (t === 'quantity' || t === 'qty') map.quantity = idx;
        else if (t === 'location' || t === 'area' || t === 'installationpoint') map.location = idx;
        else if (t.includes('panelname') || t === 'name') map.name = idx;
        else if (t.includes('assetno') || t === 'code') map.assetCode = idx;
        else if (t.includes('camera')) map.cameraNo = idx;
        else if (t.includes('doordoorname')) map.location = idx;
    });
    return map;
}

// ── Sheet-specific extractors ───────────────────────────────────────────────
function extractFloorSheetAssets(sheetName, grid) {
    const floor = normalizeFloor(sheetName);
    const headerIdx = detectHeaderRow(grid);
    if (headerIdx === -1) return [];
    const colMap = mapColumns(grid[headerIdx]);
    if (colMap.name === undefined) return [];

    const assets = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const name = cellText(row[colMap.name]);
        if (!name || /^(total|sr|sl\s*no|asset\s*details)/i.test(name)) continue;

        const qty = parseNumber(row[colMap.quantity]);
        const standardName = colMap.standardName !== undefined ? cellText(row[colMap.standardName]) : '';
        const base = {
            name: standardName || name,
            description: name,
            make: colMap.make !== undefined ? cellText(row[colMap.make]) : '',
            model: colMap.model !== undefined ? cellText(row[colMap.model]) : '',
            serial: colMap.serial !== undefined ? cellText(row[colMap.serial]) : '',
            capacity: colMap.capacity !== undefined ? cellText(row[colMap.capacity]) : '',
            floor,
            location: colMap.location !== undefined ? cellText(row[colMap.location]) : '',
            categoryCode: classifyCategory(name, standardName),
        };

        for (let q = 1; q <= qty; q++) {
            const suffix = qty > 1 ? ` (${q}/${qty})` : '';
            assets.push({
                ...base,
                name: `${base.name}${suffix}`,
                assetCode: null,
            });
        }
    }
    return assets;
}

function extractCctvSheetAssets(grid) {
    const headerIdx = detectHeaderRow(grid);
    if (headerIdx === -1) return [];
    const colMap = mapColumns(grid[headerIdx]);

    const assets = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const cameraNo = colMap.cameraNo !== undefined ? cellText(row[colMap.cameraNo]) : '';
        const location = colMap.location !== undefined ? cellText(row[colMap.location]) : '';
        const make = colMap.make !== undefined ? cellText(row[colMap.make]) : '';
        const model = colMap.model !== undefined ? cellText(row[colMap.model]) : '';
        const serial = colMap.serial !== undefined ? cellText(row[colMap.serial]) : '';
        if (!cameraNo && !location) continue;

        const floorMatch = (cameraNo || location).match(/\b(BF|Basement|GF|1F|2F|3F)\b/i);
        let floor = 'Ground Floor';
        if (floorMatch) {
            const f = floorMatch[1].toUpperCase();
            floor = f === 'BF' ? 'Basement' : f === 'GF' ? 'Ground Floor' : `${f[0]}${f[1].toLowerCase()} Floor`;
        }

        assets.push({
            name: `CCTV Camera ${cameraNo || i}`,
            description: `CCTV ${cameraNo}`,
            make,
            model,
            serial,
            capacity: '2MP',
            floor,
            location,
            categoryCode: 'SEC',
            assetCode: null,
        });
    }
    return assets;
}

function extractFeSheetAssets(grid) {
    const headerIdx = detectHeaderRow(grid);
    if (headerIdx === -1) return [];
    const colMap = mapColumns(grid[headerIdx]);

    const assets = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const assetCode = colMap.assetCode !== undefined ? cellText(row[colMap.assetCode]) : '';
        const location = colMap.location !== undefined ? cellText(row[colMap.location]) : '';
        const type = colMap.model !== undefined ? cellText(row[colMap.model]) : (colMap.capacity !== undefined ? cellText(row[colMap.capacity]) : '');
        if (!assetCode && !location) continue;

        const floorMatch = assetCode.match(/\/(BF|GF|1F|2F|3F)\//i);
        let floor = 'Ground Floor';
        if (floorMatch) {
            const f = floorMatch[1].toUpperCase();
            floor = f === 'BF' ? 'Basement' : f === 'GF' ? 'Ground Floor' : `${f[0]}${f[1].toLowerCase()} Floor`;
        }

        assets.push({
            name: `Fire Extinguisher ${type}`,
            description: `Fire Extinguisher ${type}`,
            make: '',
            model: '',
            serial: '',
            capacity: type,
            floor,
            location,
            categoryCode: 'FIRE',
            assetCode,
        });
    }
    return assets;
}

function extractBmsSheetAssets(grid) {
    const headerIdx = detectHeaderRow(grid);
    if (headerIdx === -1) return [];
    const colMap = mapColumns(grid[headerIdx]);

    const assets = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const name = colMap.name !== undefined ? cellText(row[colMap.name]) : '';
        const make = colMap.make !== undefined ? cellText(row[colMap.make]) : '';
        const model = colMap.model !== undefined ? cellText(row[colMap.model]) : '';
        const serial = colMap.serial !== undefined ? cellText(row[colMap.serial]) : '';
        const assetCode = colMap.assetCode !== undefined ? cellText(row[colMap.assetCode]) : '';
        const location = colMap.location !== undefined ? cellText(row[colMap.location]) : '';
        if (!name) continue;

        const floorMatch = assetCode.match(/\/(GF|1F|2F|3F|4F)\//i) || location.match(/\b(GF|1F|2F|3F|4F)\b/i);
        let floor = 'Ground Floor';
        if (floorMatch) {
            const f = floorMatch[1].toUpperCase();
            floor = f === 'GF' ? 'Ground Floor' : `${f[0]}${f[1].toLowerCase()} Floor`;
        }

        assets.push({
            name,
            description: name,
            make,
            model,
            serial,
            capacity: '',
            floor,
            location,
            categoryCode: classifyCategory(name),
            assetCode,
        });
    }
    return assets;
}

function extractHvacSheetAssets(grid) {
    const headerIdx = detectHeaderRow(grid);
    if (headerIdx === -1) return [];
    const colMap = mapColumns(grid[headerIdx]);

    const assets = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const name = colMap.name !== undefined ? cellText(row[colMap.name]) : '';
        const standardName = colMap.standardName !== undefined ? cellText(row[colMap.standardName]) : '';
        const make = colMap.make !== undefined ? cellText(row[colMap.make]) : '';
        const model = colMap.model !== undefined ? cellText(row[colMap.model]) : '';
        const serial = colMap.serial !== undefined ? cellText(row[colMap.serial]) : '';
        const capacity = colMap.capacity !== undefined ? cellText(row[colMap.capacity]) : '';
        const location = colMap.location !== undefined ? cellText(row[colMap.location]) : '';
        const assetCode = colMap.assetCode !== undefined ? cellText(row[colMap.assetCode]) : '';
        if (!name) continue;

        const floorMatch = assetCode.match(/\/(GF|1F|2F|3F)\//i) || location.match(/\b(GF|1F|2F|3F)\b/i);
        let floor = 'Ground Floor';
        if (floorMatch) {
            const f = floorMatch[1].toUpperCase();
            floor = f === 'GF' ? 'Ground Floor' : `${f[0]}${f[1].toLowerCase()} Floor`;
        }

        assets.push({
            name: standardName || name,
            description: name,
            make,
            model,
            serial,
            capacity,
            floor,
            location,
            categoryCode: 'HVAC',
            assetCode,
        });
    }
    return assets;
}

function extractAccessSheetAssets(grid) {
    const headerIdx = detectHeaderRow(grid);
    if (headerIdx === -1) return [];
    const colMap = mapColumns(grid[headerIdx]);

    const assets = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const floor = colMap.name !== undefined ? cellText(row[colMap.name]) : '';
        const location = colMap.location !== undefined ? cellText(row[colMap.location]) : '';
        const controller = colMap.model !== undefined ? cellText(row[colMap.model]) : '';
        if (!location && !controller) continue;

        assets.push({
            name: `Access Door ${location}`,
            description: `Access Controller ${controller}`,
            make: '',
            model: controller,
            serial: '',
            capacity: '',
            floor: floor.toUpperCase() === 'GF' ? 'Ground Floor' : `${floor[0]}${floor[1].toLowerCase()} Floor`,
            location,
            categoryCode: 'SEC',
            assetCode: null,
        });
    }
    return assets;
}

// ── Main parse ──────────────────────────────────────────────────────────────
function parseWorkbook(workbook) {
    const all = [];

    workbook.SheetNames.forEach((sheetName) => {
        const ws = workbook.Sheets[sheetName];
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (grid.length < 2) return;

        const lower = sheetName.toLowerCase();
        let extracted = [];

        if (['gf', '1st floor', '2nd floor', '3rd floor corperate', '3rd floor tech&digi', 'cafeteria'].includes(lower)) {
            // Floor sheets contain summary counts for categories that also have detail sheets.
            // Keep only ELEC / FURN / OTHR rows from floor sheets to avoid duplicating
            // individual CCTV, Fire, HVAC and BMS/IT assets.
            // Also skip lights and UPS/battery rows because Lights/UPS sheets are the master.
            extracted = extractFloorSheetAssets(sheetName, grid).filter((a) => {
                if (!['ELEC', 'FURN', 'OTHR'].includes(a.categoryCode)) return false;
                const text = `${a.name} ${a.description}`.toLowerCase();
                if (/\b(led\s*light|round\s*light|linear\s*led|cylinder\s*light|2\*2\s*light)\b/.test(text)) return false;
                if (/\b(ups|battery\s*bank)\b/.test(text)) return false;
                return true;
            });
        } else if (lower === 'cctv') {
            extracted = extractCctvSheetAssets(grid);
        } else if (lower === 'fe') {
            extracted = extractFeSheetAssets(grid);
        } else if (lower === 'bms') {
            extracted = extractBmsSheetAssets(grid);
        } else if (lower === 'hvac') {
            extracted = extractHvacSheetAssets(grid);
        } else if (lower === 'access') {
            extracted = extractAccessSheetAssets(grid);
        } else if (lower === 'ups') {
            extracted = extractFloorSheetAssets(sheetName, grid);
        } else if (lower === 'lights') {
            extracted = extractFloorSheetAssets(sheetName, grid);
        } else if (lower === 'basement') {
            // Basement is a mixed-format sheet with sections; skip it to avoid duplicates
            // with the cleaner floor/category sheets and manual clean-up overhead.
            extracted = [];
        }

        if (extracted.length) {
            console.log(`  ${sheetName}: ${extracted.length} assets`);
            all.push(...extracted);
        }
    });

    return all;
}

// ── Database insert ─────────────────────────────────────────────────────────
async function resolveCategories(assets) {
    const { data: categories } = await supabase
        .from('asset_categories')
        .select('id, name, code, organization_id')
        .or(`organization_id.eq.${ORG_ID},organization_id.is.null`)
        .eq('is_active', true);

    const map = new Map();
    (categories || []).sort((a, b) => (a.organization_id ? 1 : 0) - (b.organization_id ? 1 : 0));
    for (const c of categories || []) {
        map.set(c.code.toLowerCase(), c.id);
        map.set(c.name.toLowerCase(), c.id);
    }

    const missing = new Set();
    const resolved = assets.map((a) => {
        const categoryId = map.get(a.categoryCode.toLowerCase());
        if (!categoryId) missing.add(a.categoryCode);
        return { ...a, categoryId };
    });

    if (missing.size) {
        console.warn('Missing categories (will use OTHR):', [...missing].join(', '));
        for (const a of resolved) {
            if (!a.categoryId) a.categoryId = map.get('othr');
        }
    }

    return resolved;
}

async function importAssets(assets) {
    const BATCH = 300;
    const created = [];
    const errors = [];

    for (let i = 0; i < assets.length; i += BATCH) {
        const batch = assets.slice(i, i + BATCH);
        if (i % 1500 === 0) console.log(`  ...processing batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(assets.length / BATCH)} (${i}/${assets.length})`);
        const records = [];

        for (const a of batch) {
            let code = a.assetCode || null;
            if (!code) {
                const { data: generated, error: genErr } = await supabase.rpc('generate_asset_code', {
                    p_org_id: ORG_ID,
                    p_property_id: PROP_ID,
                    p_category_code: a.categoryCode,
                });
                if (genErr) {
                    errors.push({ name: a.name, error: genErr.message });
                    continue;
                }
                code = generated;
            }

            records.push({
                organization_id: ORG_ID,
                property_id: PROP_ID,
                category_id: a.categoryId,
                asset_code: code,
                name: a.name,
                asset_type: a.description !== a.name ? a.description : null,
                make: a.make || null,
                model: a.model || null,
                serial_number: a.serial || null,
                floor: a.floor || null,
                location: a.location || null,
                purchase_cost: null,
                vendor_name: null,
                status: 'active',
                notes: `Imported from SS Plaza asset register. Capacity: ${a.capacity || '-'}`,
            });
        }

        if (records.length === 0) continue;

        const { data: inserted, error } = await supabase.from('assets').insert(records).select('id, organization_id, property_id, asset_code, name, qr_token');
        if (error) {
            console.error(`Insert error in batch ${i / BATCH + 1}:`, error.message);
            errors.push(...batch.map((a) => ({ name: a.name, error: error.message })));
            continue;
        }

        created.push(...inserted);

        await supabase.from('asset_events').insert(
            inserted.map((a) => ({
                asset_id: a.id,
                organization_id: a.organization_id,
                property_id: a.property_id,
                event_type: 'imported',
                title: 'Asset imported from Excel',
                created_by: null,
            })),
        );
    }

    return { created, errors };
}

// ── PDF generation ──────────────────────────────────────────────────────────
async function generatePdf(assets) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const doc = new jsPDF('p', 'mm', 'a4');
    const COLS = 3;
    const ROWS = 6;
    const MARGIN = 8;
    const PAGE_W = 210;
    const PAGE_H = 297;
    const CELL_W = (PAGE_W - MARGIN * 2) / COLS;
    const CELL_H = (PAGE_H - MARGIN * 2) / ROWS;
    const CARD_PAD = 1.5;
    const QR_SIZE_MM = 30;
    const QR_TOP_PAD = 1.5;
    const PILL_GAP = 1.5;
    const PILL_H = 6.5;
    const CODE_BASELINE = 2.6;

    const PINK_BORDER = [236, 72, 153];
    const PINK_FILL = [253, 234, 241];
    const CARD_BORDER = [230, 230, 235];
    const TEXT_DARK = [20, 20, 24];
    const TEXT_MUTED = [140, 140, 148];

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

    let col = 0;
    let row = 0;

    for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        const url = `${APP_ORIGIN}/a/${a.qr_token}`;
        const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'H', width: 480, margin: 0 });

        if (i > 0 && col === 0 && row === 0) doc.addPage();

        const x = MARGIN + col * CELL_W;
        const y = MARGIN + row * CELL_H;
        const cardX = x + CARD_PAD;
        const cardY = y + CARD_PAD;
        const cardW = CELL_W - CARD_PAD * 2;
        const cardH = CELL_H - CARD_PAD * 2;

        doc.setDrawColor(...CARD_BORDER);
        doc.setLineWidth(0.25);
        doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, 'S');

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
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : CONFIRM ? 'IMPORT' : 'PREVIEW (use --dry-run or --confirm)'}`);
    console.log('Parsing workbook...');

    const workbook = XLSX.readFile(EXCEL_FILE);
    const rawAssets = parseWorkbook(workbook);
    console.log(`Total parsed: ${rawAssets.length}`);

    const assets = await resolveCategories(rawAssets);
    const categorySummary = {};
    for (const a of assets) {
        categorySummary[a.categoryCode] = (categorySummary[a.categoryCode] || 0) + 1;
    }
    console.log('Category summary:', categorySummary);

    if (DRY_RUN || !CONFIRM) {
        console.log('\nPreview (first 10):');
        assets.slice(0, 10).forEach((a, i) => console.log(`  ${i + 1}. [${a.categoryCode}] ${a.name} — ${a.floor} — ${a.location}`));
        console.log(`\n${assets.length} assets ready. Run with --confirm to import and generate PDF.`);
        return;
    }

    console.log('\nImporting into database...');
    const { created, errors } = await importAssets(assets);
    console.log(`Imported: ${created.length}, Errors: ${errors.length}`);
    if (errors.length) {
        console.log('Sample errors:');
        errors.slice(0, 10).forEach((e) => console.log(`  - ${e.name}: ${e.error}`));
    }

    if (created.length === 0) {
        console.log('No assets imported; skipping PDF.');
        return;
    }

    console.log('\nGenerating PDF...');
    await generatePdf(created);
    console.log(`PDF saved: ${PDF_FILE}`);
    console.log(`Open it and print on A4 adhesive label sheets (3×6 layout).`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
