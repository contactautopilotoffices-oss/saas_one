#!/usr/bin/env node
/**
 * Builds the MCP route catalogue: the list of the app's read (GET) API routes that
 * Claude may call on a signed-in user's behalf through /api/mcp.
 *
 * Run:  node scripts/mcp/build-catalog.mjs
 * Out:  backend/lib/mcp/catalog.generated.json
 *
 * A route is INCLUDED only when all of these hold:
 *   1. It exports a GET handler.
 *   2. Its path is not in a blocked area (cron, webhooks, internal, auth, ...).
 *   3. The file visibly checks who is calling (auth.getUser / getClaims, or one of the
 *      app's resolve...Access / require... helpers). Routes with no visible check are
 *      left out, because the MCP must never become a way round a missing check.
 *   4. The GET code path shows no sign of writing data or sending messages.
 * Every exclusion is recorded with its reason so it can be reviewed.
 *
 * This is a static scan. It is deliberately conservative: when in doubt, exclude.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const API_DIR = join(ROOT, 'app', 'api');
const OUT = join(ROOT, 'backend', 'lib', 'mcp', 'catalog.generated.json');

// Areas never exposed, whatever the code says.
const BLOCKED_TOP = new Set([
    'cron', 'webhooks', 'internal', 'diag', 'test-mcp', 'auth', 'session', 'public',
    'push-tokens', 'mcp', 'oauth', 'email-actions', 'invite-links', 'storage', 'proctor',
]);
// Path segments that mean "not a plain JSON read" (files, OAuth hops, public tokens).
const BLOCKED_SEGMENT = /(^|\/)(oauth|callback|connect|export|export-all|template|download|scan|webhook|webhooks|cron|preview-pdf|pdf|file|files|image|images|thumbnail|signed-url|token|\[token\])(\/|$)/i;

const AUTH_EVIDENCE = /\.auth\.getUser\(|\.auth\.getClaims\(|\bresolve\w*Access\(|\bresolveCaller\(|\brequire[A-Z]\w*\(|\bTaskAccessService\b/;
const WRITE_EVIDENCE = /\.(insert|update|upsert|delete)\(|\.rpc\(|\.storage\s*\.\s*from\([^)]*\)\s*\.\s*(upload|remove|move)\(/;
const SIDE_EFFECT_EVIDENCE = /\b(NotificationService|EmailService|WhatsApp\w*Service|WhatsAppEventProcessor|VoiceCallingService|LeadOutreachService|LeadSlaEscalationService|runAutoSlaEscalation|sendDigest|runCouncil|withAgentRun|TaskDailyGeneratorService|runBotHousekeeping|sendMail|sendEmail|sendPush|nodemailer)\b|\bfetch\(/;

const METHOD_EXPORT = /^export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m;

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (name === 'route.ts' || name === 'route.js') out.push(p);
    }
    return out;
}

/** Split a route file into the GET handler, other exported method handlers, and shared code. */
function splitHandlers(src) {
    const lines = src.split('\n');
    const blocks = [];
    let current = { method: null, lines: [] };
    for (const line of lines) {
        const m = line.match(METHOD_EXPORT);
        if (m) {
            blocks.push(current);
            current = { method: m[1], lines: [line] };
        } else {
            current.lines.push(line);
        }
    }
    blocks.push(current);
    const getBlock = blocks.find(b => b.method === 'GET');
    // Shared code = top-level code and helpers that are not inside another method's block.
    // Import lines are dropped: importing a service is not using it (a POST may use it).
    const shared = blocks
        .filter(b => b.method === null)
        .map(b => b.lines.filter(l => !/^\s*import\s/.test(l)).join('\n'))
        .join('\n');
    return { get: getBlock ? getBlock.lines.join('\n') : null, shared };
}

function leadingComment(src) {
    const idx = src.search(/^export\s+(?:async\s+)?(?:function|const)\s+GET\b/m);
    if (idx < 0) return '';
    const before = src.slice(0, idx);
    const block = before.match(/\/\*\*?([\s\S]*?)\*\/\s*$/);
    let text = '';
    if (block) text = block[1];
    else {
        const lineComments = before.match(/((?:^\s*\/\/.*\n)+)\s*$/m);
        if (lineComments) text = lineComments[1];
    }
    if (!text) {
        const first = src.match(/\/\*\*([\s\S]*?)\*\//);
        if (first) text = first[1];
    }
    return text
        .split('\n')
        .map(l => l.replace(/^\s*(\*|\/\/)\s?/, '').trim())
        .filter(l => l && !/^@/.test(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 400);
}

function queryParams(getSrc) {
    const names = new Set();
    for (const m of getSrc.matchAll(/\b(?:searchParams|sp|params|query|qs)\.get\(\s*['"]([\w.-]+)['"]\s*\)/g)) names.add(m[1]);
    return [...names].sort();
}

const files = walk(API_DIR).sort();
const included = [];
const excluded = [];

for (const file of files) {
    const rel = relative(API_DIR, file).split(sep).join('/');
    const routeDir = rel.replace(/\/?route\.(ts|js)$/, '');
    const pattern = '/api/' + routeDir;
    const src = readFileSync(file, 'utf8');
    const { get, shared } = splitHandlers(src);
    if (!get) continue; // no GET: not a read route

    const top = routeDir.split('/')[0];
    const pathParams = [...routeDir.matchAll(/\[(?:\.\.\.)?([\w-]+)\]/g)].map(m => m[1]);
    const readable = pattern.replace(/\[(?:\.\.\.)?([\w-]+)\]/g, '{$1}');

    let reason = null;
    if (BLOCKED_TOP.has(top)) reason = `blocked area "${top}"`;
    else if (BLOCKED_SEGMENT.test(routeDir)) reason = 'file, OAuth or public-token route';
    else if (/\[\.\.\./.test(routeDir)) reason = 'catch-all route';
    else if (!AUTH_EVIDENCE.test(get + '\n' + shared)) reason = 'no visible sign-in check';
    else if (WRITE_EVIDENCE.test(get + '\n' + shared)) reason = 'GET path may write data';
    else if (SIDE_EFFECT_EVIDENCE.test(get + '\n' + shared)) reason = 'GET path may send messages or call outside services';

    if (reason) {
        excluded.push({ path: readable, reason });
        continue;
    }
    included.push({
        path: readable,
        module: top,
        pathParams,
        queryParams: queryParams(get),
        description: leadingComment(src),
    });
}

const out = {
    generatedBy: 'scripts/mcp/build-catalog.mjs',
    note: 'Generated file. Do not edit by hand; re-run the script after adding or changing API routes.',
    counts: { included: included.length, excluded: excluded.length },
    routes: included,
    excluded,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`MCP catalogue: ${included.length} routes included, ${excluded.length} excluded -> ${relative(ROOT, OUT)}`);
const byReason = excluded.reduce((acc, e) => { acc[e.reason.startsWith('blocked area') ? 'blocked area' : e.reason] = (acc[e.reason.startsWith('blocked area') ? 'blocked area' : e.reason] || 0) + 1; return acc; }, {});
for (const [r, n] of Object.entries(byReason)) console.log(`  excluded, ${r}: ${n}`);
