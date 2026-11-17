#!/usr/bin/env node
/**
 * Download the pinned AOP costing workbook from Zoho WorkDrive. Read-only.
 *
 *   node scripts/workdrive-fetch.mjs '<WorkDrive file link or resource id>' [out.xlsx]
 *
 * Then simulate it:
 *   node scripts/aop_costing_dryrun.js out.xlsx
 *
 * Needs ZOHO_WORKDRIVE_REFRESH_TOKEN (mint it with: node scripts/zoho-reauth.mjs WORKDRIVE '<code>',
 * scope WorkDrive.files.READ). Client id/secret/DC fall back to ZOHO_BOOKS_* exactly as the
 * reauth script does, so both always agree on which client issued the token.
 *
 * Pinning by resource id, not by searching a folder, is deliberate: renamed or moved files
 * still resolve, and "Costing (1).xlsx" copies can never be picked up by accident.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [, , ref, outArg] = process.argv;
if (!ref) {
    console.error(`usage: node scripts/workdrive-fetch.mjs '<WorkDrive file link or resource id>' [out.xlsx]`);
    process.exit(1);
}

const raw = readFileSync('.env', 'utf8');
const env = Object.fromEntries(
    raw.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);

const clientPrefix = env.ZOHO_WORKDRIVE_CLIENT_ID ? 'ZOHO_WORKDRIVE' : 'ZOHO_BOOKS';
const clientId = env[`${clientPrefix}_CLIENT_ID`];
const clientSecret = env[`${clientPrefix}_CLIENT_SECRET`];
const dc = (env[`${clientPrefix}_DC`] || 'com').replace(/^\.+/, '');
const refreshToken = env.ZOHO_WORKDRIVE_REFRESH_TOKEN;
if (!refreshToken) {
    console.error('ZOHO_WORKDRIVE_REFRESH_TOKEN missing from .env — run: node scripts/zoho-reauth.mjs WORKDRIVE \'<grant code>\'');
    process.exit(1);
}

// A WorkDrive link looks like https://workdrive.zoho.in/file/<resource_id> (or …/folder/<id>/…/file/<id>).
const resourceId = (ref.match(/\/file\/([A-Za-z0-9]+)/) || [])[1] || (/^[A-Za-z0-9]{20,}$/.test(ref) ? ref : null);
if (!resourceId) {
    console.error('Could not find a file id in that link. Open the file in WorkDrive and copy the link from the address bar.');
    process.exit(1);
}

const tokenRes = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
});
const token = await tokenRes.json();
if (!token.access_token) {
    console.error('Token refresh failed: ' + JSON.stringify(token));
    process.exit(1);
}
const auth = { Authorization: `Zoho-oauthtoken ${token.access_token}` };

// Metadata first: name, type, last modified — what the approval record will cite.
const metaRes = await fetch(`https://www.zohoapis.${dc}/workdrive/api/v1/files/${resourceId}`, {
    headers: { ...auth, Accept: 'application/vnd.api+json' },
});
const meta = await metaRes.json().catch(() => ({}));
if (!metaRes.ok) {
    console.error(`File lookup failed (${metaRes.status}): ${JSON.stringify(meta)}`);
    console.error('400/403: the token\'s Zoho user cannot see this file — share it with that user. 401: scope missing (needs WorkDrive.files.READ).');
    process.exit(1);
}
const a = meta?.data?.attributes || {};
console.log(`File     : ${a.name ?? '(unnamed)'}`);
console.log(`Type     : ${a.extn || a.type || 'unknown'}`);
console.log(`Modified : ${a.modified_time ?? a.modified_time_i18 ?? 'unknown'}${a.modified_by ? ` by ${a.modified_by}` : ''}`);

const fileRes = await fetch(`https://www.zohoapis.${dc}/workdrive/api/v1/download/${resourceId}`, { headers: auth });
if (!fileRes.ok) {
    console.error(`Download failed (${fileRes.status}): ${(await fileRes.text()).slice(0, 300)}`);
    process.exit(1);
}
const buf = Buffer.from(await fileRes.arrayBuffer());
// .xlsx is a zip. A native Zoho Sheet comes back in another format; the parser needs .xlsx.
if (buf.subarray(0, 2).toString() !== 'PK') {
    console.error('Downloaded content is not an .xlsx workbook. If this is a native Zoho Sheet, keep the costing file as .xlsx in WorkDrive (or export it once) and pin that file.');
    process.exit(1);
}
// AOP-*.xlsx is gitignored, so a downloaded workbook cannot be committed by accident.
const out = outArg || `AOP-costing-${resourceId}.xlsx`;
writeFileSync(out, buf);
console.log(`Saved    : ${out} (${buf.length.toLocaleString()} bytes)`);
console.log(`sha256   : ${createHash('sha256').update(buf).digest('hex')}`);
console.log(`\nNext: node scripts/aop_costing_dryrun.js "${out}"`);
