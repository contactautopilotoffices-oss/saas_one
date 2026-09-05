#!/usr/bin/env node
/**
 * Exchange a Zoho grant code for a refresh token and write it into .env.
 *
 * Zoho self-client grant codes expire in as little as 3 minutes, so this script
 * exists to be READY BEFORE you generate one — paste and run, don't compose.
 *
 *   node scripts/zoho-books-reauth.mjs '<grant code>' [redirect_uri]
 *
 * redirect_uri is required ONLY for a Server-based app; omit it for a Self Client.
 * Nothing is printed except a masked prefix; the token goes straight to .env.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const [, , code, redirectUri] = process.argv;
if (!code) {
    console.error('usage: node scripts/zoho-books-reauth.mjs \'<grant code>\' [redirect_uri]');
    process.exit(1);
}

const env = Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const clientId = env.ZOHO_BOOKS_CLIENT_ID || env.ZOHO_CLIENT_ID;
const clientSecret = env.ZOHO_BOOKS_CLIENT_SECRET || env.ZOHO_CLIENT_SECRET;
const dc = (env.ZOHO_BOOKS_DC || 'com').replace(/^\.+/, '');

if (!clientId || !clientSecret) {
    console.error('ZOHO_BOOKS_CLIENT_ID / _SECRET missing from .env');
    process.exit(1);
}

const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
});
if (redirectUri) params.set('redirect_uri', redirectUri);

const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
});
const data = await res.json();

if (!data.refresh_token) {
    console.error('\nNo refresh token returned. Zoho said:');
    console.error(JSON.stringify(data, null, 2));
    console.error(`
Common causes:
  invalid_code        the code expired (they last ~3 min) or was already used — generate a fresh one
  invalid_client      wrong DC. This app is registered on .${dc}; check the console you used
  redirect_uri...     Server-based app: pass the EXACT redirect_uri registered on the app
`);
    process.exit(1);
}

// Back up before touching the only copy of the credentials.
copyFileSync('.env', `.env.bak.reauth.${Date.now()}`);

let text = readFileSync('.env', 'utf8');
const line = `ZOHO_BOOKS_REFRESH_TOKEN=${data.refresh_token}`;
text = /^ZOHO_BOOKS_REFRESH_TOKEN=.*$/m.test(text)
    ? text.replace(/^ZOHO_BOOKS_REFRESH_TOKEN=.*$/m, line)
    : text.replace(/\n*$/, `\n${line}\n`);
writeFileSync('.env', text);

console.log(`
Refresh token written to .env  (prefix ${data.refresh_token.slice(0, 12)}…, length ${data.refresh_token.length})
  api_domain : ${data.api_domain ?? '(not returned)'}
  scope      : ${data.scope ?? '(not returned)'}
  .env backed up alongside

Next:  npx tsx scripts/zoho-books-verify.ts
`);
