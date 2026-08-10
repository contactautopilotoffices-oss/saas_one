/**
 * One-off probe: what does a Zoho Books vendor contact actually contain?
 *
 *   node scripts/probe_zoho_vendor.js
 *
 * Read-only. Exists so the vendor sync is written against the real field names — including
 * whatever custom field the team uses for Udyam/MSME, which is not a standard Zoho field.
 */

const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
}

const CLIENT_ID = env.ZOHO_BOOKS_CLIENT_ID || env.ZOHO_CLIENT_ID;
const CLIENT_SECRET = env.ZOHO_BOOKS_CLIENT_SECRET || env.ZOHO_CLIENT_SECRET;
const REFRESH_TOKEN = env.ZOHO_BOOKS_REFRESH_TOKEN || env.ZOHO_REFRESH_TOKEN;
const DC = (env.ZOHO_BOOKS_DC || 'com').replace(/^\.+/, '').trim();
const ORG_ID = '807372318';

async function accessToken() {
    const res = await fetch(
        `https://accounts.zoho.${DC}/oauth/v2/token?refresh_token=${REFRESH_TOKEN}` +
        `&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=refresh_token`,
        { method: 'POST' });
    const j = await res.json();
    if (!j.access_token) throw new Error('token refresh failed: ' + JSON.stringify(j));
    return { token: j.access_token, api: j.api_domain || `https://www.zohoapis.${DC}` };
}

async function main() {
    const { token, api } = await accessToken();
    const H = { Authorization: `Zoho-oauthtoken ${token}` };

    // 1. How many vendors are there in total?
    const listRes = await fetch(
        `${api}/books/v3/contacts?organization_id=${ORG_ID}&contact_type=vendor&per_page=200&page=1`, { headers: H });
    const list = await listRes.json();
    if (list.code !== 0) throw new Error('contacts list failed: ' + JSON.stringify(list).slice(0, 400));

    const pc = list.page_context || {};
    console.log(`LIST: ${list.contacts.length} on page 1 | has_more=${pc.has_more_page} | per_page=${pc.per_page}`);
    console.log('LIST fields available:', Object.keys(list.contacts[0] || {}).join(', '));
    console.log('');

    // 2. What does the DETAIL record carry that the list does not?
    const sample = list.contacts.find(c => c.gst_no) || list.contacts[0];
    if (!sample) { console.log('no vendors returned'); return; }

    const detRes = await fetch(
        `${api}/books/v3/contacts/${sample.contact_id}?organization_id=${ORG_ID}`, { headers: H });
    const det = await detRes.json();
    const c = det.contact || {};

    console.log(`DETAIL for "${c.contact_name}" (${c.contact_id})`);
    const interesting = [
        'contact_name', 'company_name', 'gst_no', 'pan_no', 'gst_treatment',
        'place_of_contact', 'is_taxable', 'tax_id', 'msme_type', 'udyam_registration_number',
        'currency_code', 'payment_terms', 'payment_terms_label', 'status',
        'email', 'phone', 'mobile', 'website', 'notes',
    ];
    for (const k of interesting) {
        if (c[k] !== undefined && c[k] !== '' && c[k] !== null) console.log(`  ${k.padEnd(28)} = ${JSON.stringify(c[k])}`);
    }

    console.log('\n  billing_address:', JSON.stringify(c.billing_address || {}));
    console.log('  bank accounts  :', JSON.stringify(c.bank_accounts || c.contact_bank_accounts || []).slice(0, 300));

    // 3. Custom fields — where Udyam/MSME will live if it is captured at all.
    const cf = c.custom_fields || [];
    console.log(`\n  custom_fields (${cf.length}):`);
    for (const f of cf) console.log(`    ${String(f.label).padEnd(30)} [${f.api_name}] = ${JSON.stringify(f.value)}`);

    console.log('\n  ALL detail keys:', Object.keys(c).join(', '));
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
