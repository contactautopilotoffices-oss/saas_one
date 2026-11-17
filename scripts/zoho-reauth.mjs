#!/usr/bin/env node
/**
 * Exchange a Zoho grant code for a refresh token and write it into .env.
 *
 * Works for every Zoho identity this app holds, selected by prefix:
 *
 *   node scripts/zoho-reauth.mjs BOOKS      '<code>' [redirect_uri]
 *   node scripts/zoho-reauth.mjs MAIL       '<code>' [redirect_uri]
 *   node scripts/zoho-reauth.mjs ELEC_MAIL  '<code>' [redirect_uri]
 *   node scripts/zoho-reauth.mjs WORKDRIVE  '<code>' [redirect_uri]
 *
 * Reads   ZOHO_<PREFIX>_CLIENT_ID / _CLIENT_SECRET / _DC
 *         (WORKDRIVE falls back to the ZOHO_BOOKS_* client when it has none of its own —
 *          one Self Client can mint a second token with WorkDrive scopes, and the Books
 *          token is untouched. That client is the purchase@worksquare.in Self Client, so the
 *          grant code must be generated while signed in as purchase@. Read-only scopes:
 *          WorkDrive.users.READ,WorkDrive.team.READ,WorkDrive.teamfolders.READ,WorkDrive.files.READ)
 * Writes  ZOHO_<PREFIX>_REFRESH_TOKEN
 *
 * Grant codes expire in as little as 3 minutes, so this exists to be READY
 * BEFORE you generate one. Nothing is printed but a masked prefix.
 *
 * NOTE: ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are the SSO LOGIN client and are
 * deliberately NOT reachable here. They have scope 'openid profile email' and
 * nothing to do with Books or Mail.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const PREFIXES = { BOOKS: 'ZOHO_BOOKS', MAIL: 'ZOHO_MAIL', ELEC_MAIL: 'ZOHO_ELEC_MAIL', WORKDRIVE: 'ZOHO_WORKDRIVE' };

const [, , which, code, redirectUri] = process.argv;
const prefix = PREFIXES[(which || '').toUpperCase()];
if (!prefix || !code) {
    console.error(`usage: node scripts/zoho-reauth.mjs <BOOKS|MAIL|ELEC_MAIL|WORKDRIVE> '<grant code>' [redirect_uri]`);
    process.exit(1);
}
// A real grant code looks like 1000.abc123….def456. Catch a pasted placeholder before Zoho does.
if (!/^\d{4}\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(code)) {
    console.error(`That does not look like a Zoho grant code (expected something like 1000.xxxx.yyyy).\n` +
        `Generate one at api-console.zoho.com → Self Client → Generate Code, then paste it in place of '<grant code>'.`);
    process.exit(1);
}

const raw = readFileSync('.env', 'utf8');
const env = Object.fromEntries(
    raw.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);

const clientPrefix = prefix === 'ZOHO_WORKDRIVE' && !env.ZOHO_WORKDRIVE_CLIENT_ID ? 'ZOHO_BOOKS' : prefix;
if (clientPrefix !== prefix) console.log(`No ${prefix}_CLIENT_ID — using the ${clientPrefix} client.`);
const clientId = env[`${clientPrefix}_CLIENT_ID`];
const clientSecret = env[`${clientPrefix}_CLIENT_SECRET`];
const dc = (env[`${clientPrefix}_DC`] || 'com').replace(/^\.+/, '');
if (!clientId || !clientSecret) {
    console.error(`${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET missing from .env — add the new app's credentials first.`);
    process.exit(1);
}

const params = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code });
if (redirectUri) params.set('redirect_uri', redirectUri);

const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
});
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch {
    console.error(`Zoho returned a non-JSON page (HTTP ${res.status}) — usually a malformed code or the wrong data centre (.${dc}).`);
    process.exit(1);
}

if (!data.refresh_token) {
    console.error('\nNo refresh token returned. Zoho said:\n' + JSON.stringify(data, null, 2));
    console.error(`
  invalid_code     the code expired (~3 min) or was already used — generate a fresh one
  invalid_client   wrong DC. This app is registered on .${dc}; check ${prefix}_DC
  redirect_uri…    Server-based app: pass the EXACT redirect_uri registered on it
`);
    process.exit(1);
}

copyFileSync('.env', `.env.bak.reauth.${Date.now()}`);
const line = `${prefix}_REFRESH_TOKEN=${data.refresh_token}`;
const re = new RegExp(`^${prefix}_REFRESH_TOKEN=.*$`, 'm');
writeFileSync('.env', re.test(raw) ? raw.replace(re, line) : raw.replace(/\n*$/, `\n${line}\n`));

console.log(`
${prefix}_REFRESH_TOKEN written  (prefix ${data.refresh_token.slice(0, 12)}…, length ${data.refresh_token.length})
  api_domain : ${data.api_domain ?? '(not returned)'}
  scope      : ${data.scope ?? '(not returned)'}
  .env backed up alongside

Verify:  npx tsx scripts/zoho-verify.ts
`);
