#!/usr/bin/env node
/**
 * Exchange a Zoho grant code for a refresh token and write it into .env.
 *
 * Works for every Zoho identity this app holds, selected by prefix:
 *
 *   node scripts/zoho-reauth.mjs BOOKS      '<code>' [redirect_uri]
 *   node scripts/zoho-reauth.mjs MAIL       '<code>' [redirect_uri]
 *   node scripts/zoho-reauth.mjs ELEC_MAIL  '<code>' [redirect_uri]
 *
 * Reads   ZOHO_<PREFIX>_CLIENT_ID / _CLIENT_SECRET / _DC
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

const PREFIXES = { BOOKS: 'ZOHO_BOOKS', MAIL: 'ZOHO_MAIL', ELEC_MAIL: 'ZOHO_ELEC_MAIL' };

const [, , which, code, redirectUri] = process.argv;
const prefix = PREFIXES[(which || '').toUpperCase()];
if (!prefix || !code) {
    console.error(`usage: node scripts/zoho-reauth.mjs <BOOKS|MAIL|ELEC_MAIL> '<grant code>' [redirect_uri]`);
    process.exit(1);
}

const raw = readFileSync('.env', 'utf8');
const env = Object.fromEntries(
    raw.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);

const clientId = env[`${prefix}_CLIENT_ID`];
const clientSecret = env[`${prefix}_CLIENT_SECRET`];
const dc = (env[`${prefix}_DC`] || 'com').replace(/^\.+/, '');
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
const data = await res.json();

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
