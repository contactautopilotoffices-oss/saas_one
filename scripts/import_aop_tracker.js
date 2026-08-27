/**
 * Import AOP-BudgetVsActual.xlsx into the aop_* tables.
 *
 *   node scripts/import_aop_tracker.js               # dry run, prints what it would write
 *   node scripts/import_aop_tracker.js --commit      # actually writes
 *
 * Run this only AFTER 20260802000001_aop_tracker.sql has been applied.
 *
 * Design notes that matter if you change this:
 *
 * - The month comes from the SHEET, and a disagreeing column header is reported, not obeyed.
 *
 *   The June sheet's NOIDA SKYMARK block is headed "May-26 Budget / May-26 Actual". The
 *   obvious reading is that May's figures were pasted into the June sheet, so the header
 *   should win. The Summary tab settles it the other way: it lists Noida June-26 as
 *   budget 512,216 / actual 359,988, which is exactly what sits in the JUNE sheet's Noida
 *   column, while Summary May-26 (512,216 / 513,678) matches the MAY sheet's column. The
 *   header is stale; the data is genuinely June's.
 *
 *   This was caught by reconciling the parse against the Summary tab rather than trusting
 *   either signal — see the DRY RUN output. Obeying the header left April matching to the
 *   rupee but June short by exactly 512,216 / 359,988, i.e. one misfiled Noida column.
 *
 * - Columns are located by matching header TEXT, not by offset. Site blocks are 3 or 4
 *   columns wide depending on whether that site has a Remarks column.
 *
 * - Re-running is safe: every write is an upsert on the natural key.
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');
const WORKBOOK = path.resolve(process.cwd(), 'AOP-BudgetVsActual.xlsx');

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
const env = {};
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
    const parts = line.split('=');
    if (parts.length < 2) continue;
    let val = parts.slice(1).join('=').trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
    }
    env[parts[0].trim()] = val;
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const MONTHS = {
    jan: 1, feb: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * AOP site label -> properties.name.
 *
 * The AOP tracks 16 sites at a finer grain than the properties table (Rabale by floor,
 * Mafatlal by wing) and includes a Delhi site with no property row. Four sites are left
 * deliberately unmapped rather than guessed — a wrong property link would silently
 * misattribute spend, which is worse than no link. They can be mapped later in the UI.
 *
 * '3I SAKINAKA' in particular is tempting to map to 'Andheri' or 'Mumbai'; Sakinaka is in
 * Andheri East, but 'MYGATE ANDHERI' is already the Andheri property, so leaving it null
 * is the honest answer until someone confirms.
 */
const SITE_TO_PROPERTY = {
    'RABALE -2ND FLOOR': 'Rabale',
    'RABALE -7TH FLOOR': 'Rabale',
    '3I SAKINAKA': null,
    'MYGATE ANDHERI': 'Andheri',
    'INDORE': 'Indore',
    'KOLKATA': 'Bajaj Kolkata',
    'DELHI': null,
    'AMR BANGALORE': 'AMR Altruist',
    'SS PLAZA BANGALORE': 'SS Plaza',
    'ETPL': 'ETPL Digitide',
    'MAFATLAL D WING': 'Mafatlal Chambers , D wing',
    'MAFATLAL B WING': null,
    'RUPA SOLITAIRE': 'RUPA SOLITAIRE',
    'MAFATLAL A WING': null,
    'NOIDA SKYMARK': 'Noida',
    'MAFATLAL-C WING': 'Mafatlal Chambers , C wing',
};

const SITE_CITY = {
    'RABALE -2ND FLOOR': 'Navi Mumbai', 'RABALE -7TH FLOOR': 'Navi Mumbai',
    '3I SAKINAKA': 'Mumbai', 'MYGATE ANDHERI': 'Mumbai', 'INDORE': 'Indore',
    'KOLKATA': 'Kolkata', 'DELHI': 'Delhi', 'AMR BANGALORE': 'Bengaluru',
    'SS PLAZA BANGALORE': 'Bengaluru', 'ETPL': 'Thane',
    'MAFATLAL D WING': 'Mumbai', 'MAFATLAL B WING': 'Mumbai',
    'MAFATLAL A WING': 'Mumbai', 'MAFATLAL-C WING': 'Mumbai',
    'RUPA SOLITAIRE': 'Navi Mumbai', 'NOIDA SKYMARK': 'Noida',
};

/**
 * Row-axis classification. The sheet mixes real costs with denominators and roll-ups; a
 * naive SUM over every row would add Seat Count to rupees and double-count the totals.
 */
const LINE_ITEM_KIND = {
    'TOTAL OPS BUDGET': 'total',
    'TOTAL SPEND (Ops + Rent)': 'total',
    'TOTAL (Ops + Rent)': 'total',
    // Rent is NOT an ops cost. It is a flat Rs 3,00,00,055/month and the business's own
    // headline "PAN INDIA COST" excludes it — verified by reconciliation against the
    // Summary tab, which only balances once rent is held out.
    'Rent + CAM to Landlord': 'rent',
    'Seat Count': 'metric',
    'Sqft Area': 'metric',
    'Per Seat Budget (Ops, ₹)': 'metric',
    'Per Sqft Cost (Ops, ₹)': 'metric',
    'CAFE RENT RECD': 'revenue',
    'Electricity Revenue': 'revenue',
};

const LINE_ITEM_UNIT = {
    'Seat Count': 'count',
    'Sqft Area': 'sqft',
    'Per Seat Budget (Ops, ₹)': 'INR_per_seat',
    'Per Sqft Cost (Ops, ₹)': 'INR_per_sqft',
};

/** Lines a future automated feed should own, so the MIS stops being hand-keyed. */
const LINE_ITEM_FEED = {
    'Electricity': 'electricity',
    'Diesel': 'diesel',
    'Petty Cash': 'petty_cash',
    'Water Tanker': 'water',
};

const slug = (s) => String(s).toLowerCase()
    .replace(/[₹()]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const num = (v) => {
    if (v === null || v === undefined || v === '' || v === '-' || v === ' -') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** "June-26 Budget" -> {month: 6, year: 2026} */
function parseMonthToken(header) {
    if (!header) return null;
    const m = String(header).replace(/\n/g, ' ').match(/([A-Za-z]+)\s*-\s*(\d{2})/);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    return { month, year: 2000 + Number(m[2]) };
}

function classifyHeader(header) {
    const h = String(header || '').replace(/\n/g, ' ').toLowerCase();
    if (/\bremarks?\b/.test(h)) return 'remarks';
    if (/\bvar\b|\(act-bud\)/.test(h)) return 'variance';
    if (/\bactual\b/.test(h)) return 'actual';
    if (/\bbudget\b/.test(h)) return 'budget';
    return null;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
function parseWorkbook() {
    const wb = XLSX.readFile(WORKBOOK);
    const sheets = wb.SheetNames.filter((n) => /site\s*wise/i.test(n));
    const warnings = [];
    const siteLabels = new Set();
    const lineLabels = [];
    const entries = [];

    for (const sheetName of sheets) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
        if (rows.length < 3) continue;

        // The sheet name carries a month but NO year ("June-Site wise"). Hardcoding '-26'
        // here would import next financial year's "April-Site wise" as April 2026 and, because
        // aop_entries upserts on (site, line_item, period_month), silently overwrite FY26 in
        // place — data loss with no error. So: take the MONTH from the sheet name (which the
        // Summary-tab reconciliation proved authoritative) and the YEAR from the column
        // headers, which do carry one ("June-26").
        const sheetMonthNum = MONTHS[sheetName.split('-')[0].trim().toLowerCase()] || null;

        // Build the column map: walk row 0 for site-group starts, row 1 for field headers.
        const blocks = [];
        let current = null;
        for (let c = 1; c < rows[0].length; c++) {
            if (rows[0][c]) {
                current = { site: String(rows[0][c]).trim(), cols: {}, month: null };
                blocks.push(current);
            }
            if (!current) continue;
            const kind = classifyHeader(rows[1][c]);
            if (kind && !current.cols[kind]) current.cols[kind] = c;
            if (!current.month) current.month = parseMonthToken(rows[1][c]);
        }

        // Year comes from the headers. Use the most common one in the sheet so a single
        // stale block (the Noida case) cannot drag the whole sheet into the wrong year.
        const yearVotes = new Map();
        for (const b of blocks) {
            if (b.month) yearVotes.set(b.month.year, (yearVotes.get(b.month.year) || 0) + 1);
        }
        const sheetYear = [...yearVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

        if (sheetMonthNum && !sheetYear) {
            warnings.push({
                severity: 'error', sheet_name: sheetName, site_label: null,
                message: `No year could be read from any column header in "${sheetName}". ` +
                    `Refusing to guess — add a year to the headers (e.g. "June-27 Budget") and re-import.`,
            });
        }

        for (const block of blocks) {
            // The sheet is authoritative for the MONTH; the headers supply the YEAR.
            const effective = (sheetMonthNum && sheetYear)
                ? { month: sheetMonthNum, year: sheetYear }
                : block.month;
            if (!effective) {
                warnings.push({
                    severity: 'error', sheet_name: sheetName, site_label: block.site,
                    message: `No month could be determined for "${block.site}" — block skipped.`,
                });
                continue;
            }

            // The Noida case: header month disagrees with the sheet it sits in.
            if (block.month && block.month.month !== effective.month) {
                warnings.push({
                    severity: 'warning', sheet_name: sheetName, site_label: block.site,
                    message:
                        `"${block.site}" in sheet "${sheetName}" has stale column headers reading ` +
                        `"${monthName(block.month.month)}-${String(block.month.year).slice(2)}". ` +
                        `Imported as ${monthName(effective.month)} ${effective.year} to match the sheet, ` +
                        `which the workbook's own Summary tab confirms. Fix the headers in the source ` +
                        `workbook so the next import does not have to guess.`,
                });
            }

            siteLabels.add(block.site);
            const period = `${effective.year}-${String(effective.month).padStart(2, '0')}-01`;

            for (let r = 2; r < rows.length; r++) {
                const label = rows[r][0] && String(rows[r][0]).trim();
                if (!label) continue;
                if (!lineLabels.includes(label)) lineLabels.push(label);

                const budget = block.cols.budget !== undefined ? num(rows[r][block.cols.budget]) : null;
                const actual = block.cols.actual !== undefined ? num(rows[r][block.cols.actual]) : null;
                const remarksRaw = block.cols.remarks !== undefined ? rows[r][block.cols.remarks] : null;
                const remarks = remarksRaw && String(remarksRaw).trim() !== '-' ? String(remarksRaw).trim() : null;

                if (budget === null && actual === null && !remarks) continue;

                entries.push({
                    site: block.site, line: label, period_month: period,
                    budget, actual, remarks,
                    source_ref: `${path.basename(WORKBOOK)}#${sheetName}`,
                });
            }
        }
    }

    // Collision check. Re-labelling the Noida block to May means two different sheets now
    // claim the same (site, line, month) cell. Upserting would let whichever wrote last
    // win, silently. Identical duplicates are fine and get deduped; DIFFERING duplicates
    // are a genuine contradiction in the source and must be surfaced, not resolved by luck.
    const byCell = new Map();
    const deduped = [];
    for (const e of entries) {
        const key = `${e.site}|${e.line}|${e.period_month}`;
        const prior = byCell.get(key);
        if (!prior) {
            byCell.set(key, e);
            deduped.push(e);
            continue;
        }
        if (prior.budget !== e.budget || prior.actual !== e.actual) {
            warnings.push({
                severity: 'error', sheet_name: e.source_ref, site_label: e.site,
                message:
                    `Contradictory figures for "${e.site}" / "${e.line}" in ` +
                    `${e.period_month.slice(0, 7)}: ${prior.source_ref} says ` +
                    `budget=${prior.budget} actual=${prior.actual}, ` +
                    `${e.source_ref} says budget=${e.budget} actual=${e.actual}. ` +
                    `Kept the first. Resolve in the source workbook.`,
            });
        }
    }

    return { warnings, siteLabels: [...siteLabels], lineLabels, entries: deduped };
}

const monthName = (m) =>
    ['', 'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'][m];

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
async function main() {
    if (!fs.existsSync(WORKBOOK)) {
        console.error(`Workbook not found at ${WORKBOOK}`);
        process.exit(1);
    }

    const { warnings, siteLabels, lineLabels, entries } = parseWorkbook();

    console.log(`Parsed ${entries.length} cells across ${siteLabels.length} sites ` +
        `and ${lineLabels.length} line items.`);
    const periods = [...new Set(entries.map((e) => e.period_month))].sort();
    console.log(`Periods: ${periods.join(', ')}`);

    if (warnings.length) {
        console.log(`\n${warnings.length} import warning(s):`);
        for (const w of warnings) console.log(`  [${w.severity}] ${w.message}`);
    }

    // Resolve the organisation from the properties we expect to map against.
    const { data: orgs, error: orgErr } = await supabase
        .from('organizations').select('id, name');
    if (orgErr) throw orgErr;
    const org = orgs.find((o) => String(o.name).trim().toLowerCase() === 'autopilot offices');
    if (!org) {
        console.error('Could not find the "Autopilot Offices" organization.');
        process.exit(1);
    }
    console.log(`\nOrganization: ${org.name.trim()} (${org.id})`);

    const { data: properties } = await supabase
        .from('properties').select('id, name').eq('organization_id', org.id);
    const propByName = new Map((properties || []).map((p) => [p.name, p.id]));

    const unmapped = siteLabels.filter((s) => !SITE_TO_PROPERTY[s]);
    const missingTarget = siteLabels.filter(
        (s) => SITE_TO_PROPERTY[s] && !propByName.has(SITE_TO_PROPERTY[s]));
    if (unmapped.length) {
        console.log(`\n${unmapped.length} site(s) intentionally unmapped to a property: ${unmapped.join(', ')}`);
    }
    if (missingTarget.length) {
        console.log(`WARNING — mapping target missing from properties: ${missingTarget.map(
            (s) => `${s} -> "${SITE_TO_PROPERTY[s]}"`).join(', ')}`);
    }

    if (!COMMIT) {
        // Reconcile against the workbook's own Summary tab before trusting the parse.
        // If our cost-line roll-up does not reproduce PAN INDIA COST, the row
        // classification is wrong and the import would poison the MIS.
        const wb = XLSX.readFile(WORKBOOK);
        const summary = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { header: 1, defval: null, raw: true });
        const panIndia = summary.find((r) => r[0] && /PAN INDIA/i.test(String(r[0])));

        const totals = {};
        for (const e of entries) {
            if ((LINE_ITEM_KIND[e.line] || 'cost') !== 'cost') continue;
            const k = e.period_month;
            totals[k] = totals[k] || { budget: 0, actual: 0 };
            totals[k].budget += e.budget || 0;
            totals[k].actual += e.actual || 0;
        }

        console.log('\nReconciliation — our cost roll-up vs the workbook Summary tab:');
        const summaryCols = { '2026-04-01': [1, 2], '2026-05-01': [5, 6], '2026-06-01': [9, 10] };
        for (const k of Object.keys(totals).sort()) {
            const cols = summaryCols[k];
            const expB = cols && panIndia ? num(panIndia[cols[0]]) : null;
            const expA = cols && panIndia ? num(panIndia[cols[1]]) : null;
            const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
            const delta = (ours, exp) =>
                exp === null ? '  (no Summary figure)'
                    : Math.abs(ours - exp) < 1 ? '  ✓ matches'
                        : `  ✗ off by ${fmt(ours - exp)} (Summary: ${fmt(exp)})`;
            console.log(`  ${k.slice(0, 7)}  budget ${fmt(totals[k].budget).padEnd(16)}${delta(totals[k].budget, expB)}`);
            console.log(`           actual ${fmt(totals[k].actual).padEnd(16)}${delta(totals[k].actual, expA)}`);
        }

        console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
        const sample = entries.filter((e) => e.line === 'Electricity').slice(0, 5);
        console.log('\nSample (Electricity):');
        for (const s of sample) {
            console.log(`  ${s.period_month}  ${s.site.padEnd(22)} budget=${s.budget}  actual=${s.actual}`);
        }
        return;
    }

    // --- sites ---
    const siteRows = siteLabels.map((label, i) => ({
        organization_id: org.id,
        code: slug(label),
        name: label,
        property_id: propByName.get(SITE_TO_PROPERTY[label]) || null,
        city: SITE_CITY[label] || null,
        sort_order: i,
    }));
    const { error: siteErr } = await supabase
        .from('aop_sites').upsert(siteRows, { onConflict: 'organization_id,code' });
    if (siteErr) throw siteErr;
    console.log(`\nUpserted ${siteRows.length} sites.`);

    // --- line items ---
    const lineRows = lineLabels.map((label, i) => ({
        organization_id: org.id,
        code: slug(label),
        name: label,
        kind: LINE_ITEM_KIND[label] || 'cost',
        unit: LINE_ITEM_UNIT[label] || 'INR',
        feed_source: LINE_ITEM_FEED[label] || null,
        sort_order: i,
    }));
    const { error: lineErr } = await supabase
        .from('aop_line_items').upsert(lineRows, { onConflict: 'organization_id,code' });
    if (lineErr) throw lineErr;
    console.log(`Upserted ${lineRows.length} line items.`);

    // --- id lookups ---
    const { data: dbSites } = await supabase
        .from('aop_sites').select('id, code').eq('organization_id', org.id);
    const { data: dbLines } = await supabase
        .from('aop_line_items').select('id, code').eq('organization_id', org.id);
    const siteId = new Map((dbSites || []).map((s) => [s.code, s.id]));
    const lineId = new Map((dbLines || []).map((l) => [l.code, l.id]));

    // --- entries ---
    const entryRows = entries.map((e) => ({
        organization_id: org.id,
        site_id: siteId.get(slug(e.site)),
        line_item_id: lineId.get(slug(e.line)),
        period_month: e.period_month,
        budget: e.budget,
        actual: e.actual,
        remarks: e.remarks,
        source: 'xlsx_import',
        source_ref: e.source_ref,
    })).filter((r) => r.site_id && r.line_item_id);

    let written = 0;
    for (let i = 0; i < entryRows.length; i += 500) {
        const chunk = entryRows.slice(i, i + 500);
        const { error } = await supabase
            .from('aop_entries')
            .upsert(chunk, { onConflict: 'site_id,line_item_id,period_month' });
        if (error) throw error;
        written += chunk.length;
        process.stdout.write(`\rUpserted ${written}/${entryRows.length} entries…`);
    }
    console.log(`\rUpserted ${written} entries.                    `);

    // --- warnings ---
    if (warnings.length) {
        await supabase.from('aop_import_warnings')
            .insert(warnings.map((w) => ({ ...w, organization_id: org.id })));
        console.log(`Recorded ${warnings.length} import warning(s) for review in the UI.`);
    }

    // --- verification against the workbook's own Summary tab ---
    const { data: check } = await supabase
        .from('aop_site_month_summary')
        .select('period_month, actual_total, budget_total')
        .eq('organization_id', org.id);
    const byMonth = {};
    for (const row of check || []) {
        const k = row.period_month;
        byMonth[k] = byMonth[k] || { budget: 0, actual: 0 };
        byMonth[k].budget += Number(row.budget_total || 0);
        byMonth[k].actual += Number(row.actual_total || 0);
    }
    console.log('\nPan-India totals now in the database (cost lines only):');
    for (const k of Object.keys(byMonth).sort()) {
        console.log(`  ${k}  budget ₹${Math.round(byMonth[k].budget).toLocaleString('en-IN')}` +
            `   actual ₹${Math.round(byMonth[k].actual).toLocaleString('en-IN')}`);
    }
    console.log('\nCompare these against the workbook\'s "Summary" tab PAN INDIA COST row.');
}

main().catch((e) => { console.error(e); process.exit(1); });
