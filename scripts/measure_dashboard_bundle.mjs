// Dashboard performance, Phase 0 — how much JavaScript the dashboard makes the browser load up front.
//
//   npm run build
//   node scripts/measure_dashboard_bundle.mjs [--json out.json]
//
// Reads the production build only (.next): no network, no database. It finds the client component
// UnifiedDashboard.tsx in the dashboard page's client reference manifest and measures every chunk the browser must
// load synchronously for it (the same measure as the 11 Oct audit), in raw, gzip and Brotli bytes. Re-run after each
// phase and compare. Lazily loaded chunks (next/dynamic) are not in this list — that is the point of Phase 1.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const NEXT = path.join(ROOT, '.next');
const PAGE = '/(dashboard)/[orgId]/dashboard/page';
const MODULE = 'UnifiedDashboard.tsx';

const manifestFile = path.join(NEXT, 'server', 'app', '(dashboard)', '[orgId]', 'dashboard', 'page_client-reference-manifest.js');
if (!fs.existsSync(manifestFile)) {
    console.error('No production build found. Run "npm run build" first.');
    process.exit(1);
}

const ctx = {};
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(manifestFile, 'utf8'), ctx);
const manifest = ctx.__RSC_MANIFEST?.[PAGE];
if (!manifest) { console.error(`Page ${PAGE} not found in the manifest.`); process.exit(1); }

const key = Object.keys(manifest.clientModules).find(k => k.replace(/\\/g, '/').endsWith(`/${MODULE}`));
if (!key) { console.error(`${MODULE} not found in the manifest.`); process.exit(1); }

// `chunks` alternates chunk id and file path; keep the files.
const files = [...new Set(manifest.clientModules[key].chunks.filter(c => typeof c === 'string' && c.startsWith('static/')))];

const kb = n => Math.round(n / 1024);
const rows = files.map(f => {
    const buf = fs.readFileSync(path.join(NEXT, decodeURIComponent(f)));   // paths are URL-encoded ("%5BorgId%5D")
    return {
        file: f,
        raw: buf.length,
        gzip: zlib.gzipSync(buf, { level: 9 }).length,
        brotli: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    };
});
const total = rows.reduce((t, r) => ({ raw: t.raw + r.raw, gzip: t.gzip + r.gzip, brotli: t.brotli + r.brotli }), { raw: 0, gzip: 0, brotli: 0 });
const largest = [...rows].sort((a, b) => b.brotli - a.brotli).slice(0, 5);
const buildId = fs.existsSync(path.join(NEXT, 'BUILD_ID')) ? fs.readFileSync(path.join(NEXT, 'BUILD_ID'), 'utf8').trim() : null;

const result = {
    measuredAt: new Date().toISOString(), buildId, page: PAGE, module: MODULE,
    files: rows.length, rawKB: kb(total.raw), gzipKB: kb(total.gzip), brotliKB: kb(total.brotli),
    largest: largest.map(r => ({ file: r.file, rawKB: kb(r.raw), brotliKB: kb(r.brotli) })),
};

console.log(`Dashboard (${PAGE}) — JavaScript loaded up front for ${MODULE}`);
console.log(`  files:        ${result.files}`);
console.log(`  uncompressed: ${result.rawKB.toLocaleString()} KB`);
console.log(`  gzip:         ${result.gzipKB.toLocaleString()} KB`);
console.log(`  Brotli:       ${result.brotliKB.toLocaleString()} KB`);
console.log('  largest files (Brotli):');
for (const r of result.largest) console.log(`    ${String(r.brotliKB).padStart(5)} KB  (${r.rawKB} KB raw)  ${r.file}`);

// Per role: the shell above PLUS that role's dashboard, which is loaded lazily (next/dynamic, Phase 1). This is what a
// user of that role downloads before their dashboard shows — the fair number to compare with the old all-in-one total.
const loadableFile = path.join(NEXT, 'react-loadable-manifest.json');
if (fs.existsSync(loadableFile)) {
    const loadable = JSON.parse(fs.readFileSync(loadableFile, 'utf8'));
    const roleKeys = Object.keys(loadable).filter(k => k.replace(/\\/g, '/').includes(`/${MODULE} -> `));
    const sizeOf = new Map(rows.map(r => [r.file, r]));
    const measure = f => {
        if (!sizeOf.has(f)) {
            const buf = fs.readFileSync(path.join(NEXT, decodeURIComponent(f)));
            sizeOf.set(f, { file: f, raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length,
                brotli: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length });
        }
        return sizeOf.get(f);
    };
    result.roles = roleKeys.map(k => {
        const all = [...new Set([...files, ...loadable[k].files.filter(f => f.endsWith('.js'))])].map(measure);
        const sum = all.reduce((t, r) => ({ raw: t.raw + r.raw, brotli: t.brotli + r.brotli }), { raw: 0, brotli: 0 });
        return { dashboard: k.split(' -> ')[1].split('/').pop(), files: all.length, rawKB: kb(sum.raw), brotliKB: kb(sum.brotli) };
    }).sort((a, b) => b.brotliKB - a.brotliKB);
    if (result.roles.length) {
        console.log('\n  per role — shell + that role\'s dashboard (tabs still load later, when opened):');
        for (const r of result.roles) console.log(`    ${String(r.brotliKB).padStart(5)} KB Brotli  ${String(r.files).padStart(3)} files  ${r.dashboard}`);
    }
}

const i = process.argv.indexOf('--json');
if (i > -1 && process.argv[i + 1]) {
    fs.writeFileSync(process.argv[i + 1], JSON.stringify(result, null, 2));
    console.log(`\nSaved to ${process.argv[i + 1]}`);
}
