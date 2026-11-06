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

const AUTH_EVIDENCE = /\.auth\.getUser\(|\.auth\.getClaims\(|\bresolve\w*Access\(|\bresolveCaller\(|\bguardProperty\(|\bguardOrg\(|\brequire[A-Z]\w*\(|\bTaskAccessService\b/;
const WRITE_EVIDENCE = /\.(insert|update|upsert|delete)\(|\.rpc\(|\.storage\s*\.\s*from\([^)]*\)\s*\.\s*(upload|remove|move)\(/;
const SIDE_EFFECT_EVIDENCE = /\b(NotificationService|EmailService|WhatsApp\w*Service|WhatsAppEventProcessor|VoiceCallingService|LeadOutreachService|LeadSlaEscalationService|runAutoSlaEscalation|sendDigest|runCouncil|withAgentRun|TaskDailyGeneratorService|runBotHousekeeping|sendMail|sendEmail|sendPush|nodemailer)\b|\bfetch\(/;

/**
 * Database functions declared STABLE or IMMUTABLE in the SQL migrations. Postgres does not let
 * those modify data, so `.rpc('<name>', ...)` on one of them is a read, not a write.
 */
function readOnlyRpcNames() {
    const names = new Set();
    const dirs = ['supabase/migrations', 'backend/db/migrations', 'sql'].map(d => join(ROOT, d));
    const files = [];
    const collect = dir => {
        let entries = [];
        try { entries = readdirSync(dir); } catch { return; }
        for (const n of entries) {
            const p = join(dir, n);
            if (statSync(p).isDirectory()) collect(p);
            else if (n.endsWith('.sql')) files.push(p);
        }
    };
    dirs.forEach(collect);
    const def = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)(?=create\s+(?:or\s+replace\s+)?function|$)/gi;
    const volatileSeen = new Set();
    for (const f of files) {
        const sql = readFileSync(f, 'utf8');
        for (const m of sql.matchAll(def)) {
            const name = m[1].toLowerCase();
            // Only the header up to the body start decides volatility.
            const header = m[2].split(/\bAS\s+\$[A-Za-z_]*\$/i)[0] + ' ' + (m[2].match(/\$[A-Za-z_]*\$[\s\S]*?\$[A-Za-z_]*\$([\s\S]{0,200})/)?.[1] || '');
            if (/\b(stable|immutable)\b/i.test(header)) names.add(name);
            else volatileSeen.add(name);
        }
    }
    // A function redefined anywhere without STABLE/IMMUTABLE is not trusted.
    for (const n of volatileSeen) names.delete(n);
    return names;
}
const READ_ONLY_RPCS = readOnlyRpcNames();
function withoutReadOnlyRpcs(code) {
    return code.replace(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/gi, (all, name) => (READ_ONLY_RPCS.has(name.toLowerCase()) ? `.readOnlyRpc('${name}'` : all));
}

const METHOD_EXPORT =/^export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m;

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (name === 'route.ts' || name === 'route.js') out.push(p);
    }
    return out;
}

/** Split a route file into the GET handler, other exported method handlers, and shared code. */
/**
 * Sign-in checks done inside a helper, e.g. `const viewer = await meetingViewer(orgId)`.
 * For each name imported from the project ('@/...'), read that exported function's own body in
 * its module and count it as a sign-in check only if THAT body checks the session itself
 * (auth.getUser / getClaims) and refuses with 401 when there is no user. One level deep, by
 * design: a helper that only calls another helper is not trusted.
 */
const helperCache = new Map();
function resolveModule(spec) {
    const base = join(ROOT, spec.replace(/^@\//, ''));
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts')]) {
        try {
            if (statSync(cand).isFile()) return cand;
        } catch { /* try next */ }
    }
    return null;
}
function functionBody(src, name) {
    const m = src.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(`));
    if (!m) return null;
    const open = src.indexOf('{', src.indexOf(')', m.index));
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
    }
    return null;
}
function helperChecksSignIn(spec, name) {
    const key = `${spec}#${name}`;
    if (helperCache.has(key)) return helperCache.get(key);
    let ok = false;
    const file = resolveModule(spec);
    if (file) {
        const body = functionBody(readFileSync(file, 'utf8'), name);
        ok = !!body && /\.auth\.getUser\(|\.auth\.getClaims\(/.test(body) && /status:\s*401|Unauthorized/.test(body);
    }
    helperCache.set(key, ok);
    return ok;
}
/** Does the route call an imported helper that itself checks sign-in? */
function callsSignInHelper(src, code) {
    for (const m of src.matchAll(/^\s*import\s*\{([^}]+)\}\s*from\s*['"](@\/[^'"]+)['"]/gm)) {
        for (const raw of m[1].split(',')) {
            const name = raw.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
            if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
            if (new RegExp(`\\b${name}\\(`).test(code) && helperChecksSignIn(m[2], name)) return true;
        }
    }
    return false;
}

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
    // The comment directly above GET: the LAST block comment, not one that starts higher up.
    const trimmed = before.replace(/\s+$/, '');
    let text = '';
    if (trimmed.endsWith('*/')) text = trimmed.slice(trimmed.lastIndexOf('/*') + 2, -2).replace(/^\*/, '');
    // A banner such as "===== GET =====" says nothing: use the earlier block (usually the file header) instead.
    if (text && (text.match(/[A-Za-z]/g) || []).length < 12) {
        const block = before.match(/\/\*\*?([\s\S]*?)\*\/\s*$/);
        text = block ? block[1] : '';
    }
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
    else if (!AUTH_EVIDENCE.test(get + '\n' + shared) && !callsSignInHelper(src, get + '\n' + shared)) reason = 'no visible sign-in check';
    else if (WRITE_EVIDENCE.test(withoutReadOnlyRpcs(get + '\n' + shared))) reason = 'GET path may write data';
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
