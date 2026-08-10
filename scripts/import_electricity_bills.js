/**
 * Import "Electricity Tracker Excel.xlsx" into electricity_billing_accounts + electricity_bills.
 *
 *   node scripts/import_electricity_bills.js            # dry run
 *   node scripts/import_electricity_bills.js --commit   # write
 *
 * Run only AFTER 20260802000002_electricity_bills.sql has been applied (which itself
 * depends on 20260802000001_aop_tracker.sql for has_aop_access()).
 *
 * Sheet shape: two identity columns (Electricity Board, Site Name) followed by seven
 * month blocks laid out left to right (Nov-2025 .. May-2026). The blocks are NOT a fixed
 * width — later months gained "Days Pending", "Payment Status", "Payment Date" and Feb
 * even has a one-off "Percentage Saving" column. So blocks are detected by finding each
 * "Bill Date" header, and fields inside a block are matched by header text, never offset.
 *
 * The row-0 month captions ("Nov Month Billing 2025") sit on merged cells whose anchor
 * does not line up with the block start, so they are read as an ordered list and zipped
 * onto the detected blocks rather than matched by column.
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');
/** Emit the parsed rows as JSON and exit — no credentials, no network. Used when the
 *  workbook must be applied through a different channel (e.g. reviewed SQL). */
const JSON_ONLY = process.argv.includes('--json');
/** --file=<path> targets a refreshed workbook; the sheet shape is detected either way. */
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const WORKBOOK = path.resolve(process.cwd(), fileArg ? fileArg.slice('--file='.length) : 'Electricity Tracker Excel.xlsx');

// .env is only needed to WRITE. Reading it unconditionally made --json impossible on a
// checkout with no local credentials, which is exactly when a review-then-apply flow is
// wanted. Parsing stays credential-free.
let supabase = null;
if (!JSON_ONLY) {
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
    supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

const MONTHS = {
    jan: 1, feb: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Site label in this sheet -> properties.name. Null = deliberately unmapped. */
const SITE_TO_PROPERTY = {
    'SS Plaza': 'SS Plaza',
    'AMR Tech Park': 'AMR Altruist',
    'Rupa Solitaire - Mahape': 'RUPA SOLITAIRE',
    '3i - Crescent Solitaire': null,
    'Mafatlal - WS': null,          // sheet does not say which wing
    'NRK Star - Indore': 'Indore',
    'ETPL - Thane': 'ETPL Digitide',
    '7th Floor Sigma IT Park 701': 'Rabale',
    '2nd Floor Sigma IT Park 202': 'Rabale',
    '2nd Floor Sigma IT Park 201': 'Rabale',
    '7th Floor Sigma IT Park 703': 'Rabale',
    '4th Floor Centre point - Mygate': 'Andheri',
    '7th Floor Centre point - Mygate': 'Andheri',
};

/** Excel serial -> ISO date. Excel's epoch is 1899-12-30 (it thinks 1900 was a leap year). */
function excelDate(v) {
    if (v === null || v === undefined || v === '' || v === '-' || v === ' -') return null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (!t || t === '-') return null;
        const parsed = new Date(t);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    }
    if (typeof v !== 'number' || v < 20000 || v > 60000) return null;   // outside ~1954..2064
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}

function money(v) {
    if (v === null || v === undefined || v === '' ) return null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (!t || t === '-' || t === ' -') return null;
        const n = Number(t.replace(/[,₹\s]/g, ''));
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    }
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function normHeader(h) {
    return String(h || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function fieldOf(header) {
    const h = normHeader(header);
    if (h === 'bill date') return 'bill_date';
    if (h === 'due date') return 'due_date';
    if (h === 'total amount') return 'total_amount';
    if (h === 'early payment date') return 'early_payment_date';
    if (h === 'early payment amount') return 'early_payment_amount';
    if (h === 'after due date amount' || h === 'amount after due date') return 'after_due_date_amount';
    if (h === 'payment status') return 'payment_status';
    if (h === 'payment date') return 'payment_date';
    return null;   // Days Pending / Percentage Saving are derived; the view recomputes them
}

/**
 * "Bangalore Electricity Supply Company Limited (0.25% Discount on Early Payment...)" and
 * "Adani Electricity Mumbai Limited 302" both encode extra data in the provider string:
 * a published discount rate, and a consumer/connection reference respectively.
 * "M - Lokesh" is a person, not a board — kept verbatim so it is visibly wrong in the UI
 * rather than silently normalised into something that looks authoritative.
 */
function parseProvider(raw) {
    const text = String(raw || '').trim();
    let discountPct = null;
    const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) discountPct = Number(pct[1]);

    let name = text.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

    let consumerRef = null;
    const trailing = name.match(/\s(\d{2,6})$/);
    if (trailing) {
        consumerRef = trailing[1];
        name = name.slice(0, trailing.index).trim();
    }
    return { provider: name, consumerRef, discountPct };
}

function parseWorkbook() {
    const wb = XLSX.readFile(WORKBOOK);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

    // Month captions, in left-to-right order.
    const captions = [];
    for (let c = 0; c < rows[0].length; c++) {
        const v = rows[0][c];
        if (!v) continue;
        const m = String(v).match(/([A-Za-z]+)\s+Month\s+Billing\s+(\d{4})/i);
        if (m && MONTHS[m[1].toLowerCase()]) {
            captions.push({ month: MONTHS[m[1].toLowerCase()], year: Number(m[2]), label: String(v).trim() });
        }
    }

    // Block starts = every "Bill Date" header on the header row.
    const HEADER_ROW = 2;
    const starts = [];
    for (let c = 0; c < rows[HEADER_ROW].length; c++) {
        if (normHeader(rows[HEADER_ROW][c]) === 'bill date') starts.push(c);
    }

    if (starts.length !== captions.length) {
        console.warn(`WARNING: found ${starts.length} month blocks but ${captions.length} month captions. ` +
            `Zipping the first ${Math.min(starts.length, captions.length)}.`);
    }

    const blocks = [];
    for (let i = 0; i < Math.min(starts.length, captions.length); i++) {
        const from = starts[i];
        const to = i + 1 < starts.length ? starts[i + 1] : rows[HEADER_ROW].length;
        const cols = {};
        for (let c = from; c < to; c++) {
            const f = fieldOf(rows[HEADER_ROW][c]);
            if (f && cols[f] === undefined) cols[f] = c;
        }
        blocks.push({ ...captions[i], cols });
    }

    const accounts = new Map();
    const bills = [];
    const warnings = [];

    for (let r = HEADER_ROW + 1; r < rows.length; r++) {
        const boardRaw = rows[r][0];
        const siteRaw = rows[r][1];
        if (!boardRaw || !siteRaw) continue;
        if (/^total|^percentage|^savings/i.test(String(boardRaw).trim())) continue;

        const site = String(siteRaw).trim();
        const { provider, consumerRef, discountPct } = parseProvider(boardRaw);
        const key = `${provider}|${site}|${consumerRef || ''}`;
        if (!accounts.has(key)) {
            accounts.set(key, { provider, site_label: site, consumer_ref: consumerRef, discount_pct: discountPct });
        }

        for (const b of blocks) {
            const get = (f) => (b.cols[f] !== undefined ? rows[r][b.cols[f]] : null);
            const total = money(get('total_amount'));
            const billDate = excelDate(get('bill_date'));
            const dueDate = excelDate(get('due_date'));
            if (total === null && billDate === null && dueDate === null) continue;   // month not billed

            const statusRaw = String(get('payment_status') || '').trim().toLowerCase();
            const status = statusRaw.startsWith('done') || statusRaw === 'paid' ? 'paid' : 'pending';
            const paymentDate = excelDate(get('payment_date'));

            if (status === 'paid' && !paymentDate) {
                warnings.push(`${site} (${provider}${consumerRef ? ' ' + consumerRef : ''}) ` +
                    `${b.label}: marked paid with no payment date recorded.`);
            }

            bills.push({
                accountKey: key,
                billing_month: `${b.year}-${String(b.month).padStart(2, '0')}-01`,
                bill_date: billDate,
                due_date: dueDate,
                total_amount: total,
                early_payment_date: excelDate(get('early_payment_date')),
                early_payment_amount: money(get('early_payment_amount')),
                after_due_date_amount: money(get('after_due_date_amount')),
                payment_status: status,
                payment_date: paymentDate,
                source: 'xlsx_import',
            });
        }
    }

    return { accounts: [...accounts.values()], accountKeys: [...accounts.keys()], bills, blocks, warnings };
}

async function main() {
    if (!fs.existsSync(WORKBOOK)) {
        console.error(`Workbook not found at ${WORKBOOK}`);
        process.exit(1);
    }

    const { accounts, bills, blocks, warnings } = parseWorkbook();

    if (JSON_ONLY) {
        process.stdout.write(JSON.stringify({ accounts, bills, warnings,
            blocks: blocks.map((b) => `${b.year}-${String(b.month).padStart(2, '0')}`) }, null, 0));
        return;
    }

    console.log(`Month blocks detected: ${blocks.map((b) => `${b.year}-${String(b.month).padStart(2, '0')}`).join(', ')}`);
    console.log(`Billing accounts: ${accounts.length}`);
    console.log(`Bills: ${bills.length}`);

    // What the tile will be about: discount won vs discount available.
    //
    // Three buckets, not two. A bill with no recorded payment date cannot be scored either
    // way, and lumping those into "missed" would invent a loss that may never have happened
    // — the sheet's own footer only ever quotes the AVAILABLE saving (Jan Rs 21,489,
    // Feb Rs 21,863 = total-due minus total-early), never a realised one.
    let available = 0, captured = 0, missed = 0, unknown = 0, withDiscount = 0;
    for (const b of bills) {
        if (b.total_amount === null || b.early_payment_amount === null) continue;
        const gap = b.total_amount - b.early_payment_amount;
        if (gap <= 0) continue;
        withDiscount++;
        available += gap;
        if (!b.payment_date || !b.early_payment_date) unknown += gap;
        else if (b.payment_date <= b.early_payment_date) captured += gap;
        else missed += gap;
    }
    const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
    console.log(`\nEarly-payment discount across the imported period:`);
    console.log(`  bills offering a discount     : ${withDiscount}`);
    console.log(`  discount available            : ${inr(available)}`);
    console.log(`  captured (paid on/before date): ${inr(captured)}`);
    console.log(`  missed  (paid after the date) : ${inr(missed)}`);
    console.log(`  unverifiable (no dates logged): ${inr(unknown)}`);

    if (warnings.length) {
        console.log(`\n${warnings.length} row(s) marked paid without a payment date:`);
        for (const w of warnings.slice(0, 8)) console.log(`  ${w}`);
        if (warnings.length > 8) console.log(`  …and ${warnings.length - 8} more`);
    }

    const { data: orgs } = await supabase.from('organizations').select('id, name');
    const org = (orgs || []).find((o) => String(o.name).trim().toLowerCase() === 'autopilot offices');
    if (!org) { console.error('Could not find the "Autopilot Offices" organization.'); process.exit(1); }

    const { data: properties } = await supabase
        .from('properties').select('id, name').eq('organization_id', org.id);
    const propByName = new Map((properties || []).map((p) => [p.name, p.id]));

    const unmapped = accounts.filter((a) => !SITE_TO_PROPERTY[a.site_label]);
    if (unmapped.length) {
        console.log(`\n${unmapped.length} account(s) not linked to a property: ` +
            `${[...new Set(unmapped.map((a) => a.site_label))].join(', ')}`);
    }

    if (!COMMIT) {
        console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
        console.log('\nSample accounts:');
        for (const a of accounts.slice(0, 6)) {
            console.log(`  ${a.site_label.padEnd(32)} ${a.provider}${a.consumer_ref ? ' #' + a.consumer_ref : ''}` +
                `${a.discount_pct ? '  (' + a.discount_pct + '% published)' : ''}`);
        }
        return;
    }

    const accountRows = accounts.map((a) => ({
        organization_id: org.id,
        property_id: propByName.get(SITE_TO_PROPERTY[a.site_label]) || null,
        provider: a.provider,
        consumer_ref: a.consumer_ref,
        site_label: a.site_label,
        early_payment_discount_pct: a.discount_pct,
    }));
    const { error: accErr } = await supabase.from('electricity_billing_accounts')
        .upsert(accountRows, { onConflict: 'organization_id,provider,site_label,consumer_ref' });
    if (accErr) throw accErr;
    console.log(`\nUpserted ${accountRows.length} billing accounts.`);

    const { data: dbAccounts } = await supabase
        .from('electricity_billing_accounts')
        .select('id, provider, site_label, consumer_ref').eq('organization_id', org.id);
    const idByKey = new Map((dbAccounts || []).map(
        (a) => [`${a.provider}|${a.site_label}|${a.consumer_ref || ''}`, a.id]));

    const billRows = bills.map((b) => {
        const { accountKey, ...rest } = b;
        return { organization_id: org.id, account_id: idByKey.get(accountKey), ...rest };
    }).filter((b) => b.account_id);

    let written = 0;
    for (let i = 0; i < billRows.length; i += 500) {
        const chunk = billRows.slice(i, i + 500);
        const { error } = await supabase.from('electricity_bills')
            .upsert(chunk, { onConflict: 'account_id,billing_month' });
        if (error) throw error;
        written += chunk.length;
    }
    console.log(`Upserted ${written} bills.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
