/**
 * DRY RUN — simulate the planned AOP costing feed against a costing workbook.
 * Never writes. Reads the workbook and the live aop_* tables, then reports where the
 * planned flow would BLOCK, need REVIEW, ROUTE to an owner, or PASS.
 *
 *   node scripts/aop_costing_dryrun.js "<costing workbook .xlsx>" [--out report.md]
 *
 * The workbook is the site teams' monthly costing return ("Costing For Sept'26n.xlsx"):
 * one tab per month, cost lines down the rows, one column per site, actuals only.
 * The same parser is meant to sit behind the WorkDrive sync once the token exists — run
 * scripts/workdrive-fetch.mjs to download the pinned file, then point this at it.
 *
 * Assumptions it makes, each one an open decision in the plan, printed in the report:
 *   - A month the finance workbook already loaded (any source='xlsx_import' row) is CLOSED,
 *     so costing figures for it are compared but never applied.
 *   - Delhi columns ("Geebee - Del", "Mahindra - Del") stay unmapped until someone decides
 *     whether they are one AOP site.
 *   - Costing is lowest in the source ranking: it only fills empty actuals.
 *
 * Failure-mode codes follow the "AOP costing — decision layer" deck:
 *   P0-A right format, wrong number · P0-B wrong source wins · P0-D duplicate/partial writes
 *   P1-F data changes after approval · P1-G month closes incomplete
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null;
const WORKBOOK = argv.find((a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));
if (!WORKBOOK || !fs.existsSync(WORKBOOK)) {
    console.error('usage: node scripts/aop_costing_dryrun.js "<costing workbook .xlsx>" [--out report.md]');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// env (same reader as scripts/import_aop_tracker.js)
// ---------------------------------------------------------------------------
const env = {};
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
    const parts = line.split('=');
    if (parts.length < 2) continue;
    let val = parts.slice(1).join('=').trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
    env[parts[0].trim()] = val;
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Costing-sheet column header (normalised) -> aop_sites.name. null = needs a decision. */
const SITE_ALIAS = {
    'ss plaza blr': 'SS PLAZA BANGALORE',
    'amr blr': 'AMR BANGALORE',
    'rupa': 'RUPA SOLITAIRE',
    'etpl': 'ETPL',
    'rabale 2nd floor': 'RABALE -2ND FLOOR',
    'rabale 7th floor': 'RABALE -7TH FLOOR',
    'kolkata': 'KOLKATA',
    '3i infotech': '3I SAKINAKA',
    'my gate': 'MYGATE ANDHERI',
    'd wing': 'MAFATLAL D WING',
    'b wing': 'MAFATLAL B WING',
    'mafatlal c wing': 'MAFATLAL-C WING',
    'noida': 'NOIDA SKYMARK',
    'indore': 'INDORE',
    // Two sheet columns, one AOP site? Open decision — do not guess.
    'geebee del': null,
    'mahindra del': null,
};

const OUTLIER_RATIO = 3;        // over 3x or under 1/3 of the site-line's history
const OUTLIER_FLOOR = 50000;    // ...and at least Rs 50k on one side
const MONEY_TOLERANCE = 1;      // Rs

const inr = (v) => v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN');
const lakh = (v) => v == null ? '—' : `₹${(v / 1e5).toFixed(2)} L`;
const ym = (d) => d.slice(0, 7);

/** Classify one raw cell. */
function readCell(raw) {
    if (raw === null || raw === undefined) return { kind: 'blank' };
    if (typeof raw === 'number') return { kind: 'number', value: Math.round(raw * 100) / 100 };
    const s = String(raw).trim();
    if (s === '') return { kind: 'blank' };
    if (/^-?[\d,]+(\.\d+)?$/.test(s)) return { kind: 'textnum', value: Math.round(Number(s.replace(/,/g, '')) * 100) / 100, raw: s };
    if (/^(-|–|—|na|n\/a|nil)$/i.test(s)) return { kind: 'na', raw: s };
    return { kind: 'placeholder', raw: s };
}

/** "April-26", "May'26", "Sept'26" -> '2026-04-01'. */
function monthFromTab(name) {
    const m = String(name).trim().match(/^([A-Za-z]+)\W*(\d{2})$/);
    if (!m) return null;
    const mon = MONTHS[m[1].toLowerCase()];
    return mon ? `${2000 + Number(m[2])}-${String(mon).padStart(2, '0')}-01` : null;
}

async function fetchAll(table, cols, filter) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        let q = supabase.from(table).select(cols).order('id').range(from, from + 999);
        if (filter) q = filter(q);
        const { data, error } = await q;
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...data);
        if (data.length < 1000) return out;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
    const findings = [];
    const add = (f) => findings.push(f);

    const fileBuf = fs.readFileSync(WORKBOOK);
    const sha = crypto.createHash('sha256').update(fileBuf).digest('hex');
    const wb = XLSX.read(fileBuf, { type: 'buffer' });

    // ---- live AOP state (read-only) ------------------------------------------
    const sites = await fetchAll('aop_sites', 'id, organization_id, name, is_active');
    if (!sites.length) { console.error('aop_sites is empty — nothing to simulate against.'); process.exit(1); }
    const orgId = sites[0].organization_id;
    const lines = await fetchAll('aop_line_items', 'id, code, name, kind', (q) => q.eq('organization_id', orgId));
    const cells = await fetchAll('aop_entries', 'id, site_id, line_item_id, period_month, budget, actual, source, source_ref', (q) => q.eq('organization_id', orgId));

    const siteByName = new Map(sites.map((s) => [s.name, s]));
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    const lineByNorm = new Map(lines.map((l) => [norm(l.name), l]));
    const lineName = new Map(lines.map((l) => [l.id, l.name]));
    const lineKind = new Map(lines.map((l) => [l.id, l.kind]));
    const key = (s, l, m) => `${s}|${l}|${m}`;
    const dbCell = new Map(cells.map((c) => [key(c.site_id, c.line_item_id, c.period_month), c]));
    const closedMonths = new Set(cells.filter((c) => c.source === 'xlsx_import').map((c) => c.period_month));
    const budgetCellsByMonth = new Map();
    for (const c of cells) if (c.budget != null && lineKind.get(c.line_item_id) === 'cost') {
        budgetCellsByMonth.set(c.period_month, (budgetCellsByMonth.get(c.period_month) || 0) + 1);
    }

    // History per site-line for outlier checks: every DB actual + every earlier costing tab.
    // One figure per month: the live table (finance) is loaded first and wins over a costing tab.
    const history = new Map();
    const pushHist = (s, l, m, v) => {
        if (v == null || v <= 0) return;
        const k = `${s}|${l}`;
        if (!history.has(k)) history.set(k, new Map());
        if (!history.get(k).has(m)) history.get(k).set(m, v);
    };
    for (const c of cells) if (lineKind.get(c.line_item_id) === 'cost') pushHist(c.site_id, c.line_item_id, c.period_month, Number(c.actual));

    // ---- parse every tab -----------------------------------------------------
    const months = [];
    for (const tab of wb.SheetNames) {
        const month = monthFromTab(tab);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null, raw: true });
        if (!month) { add({ decision: 'PASS', code: 'AUTO', owner: 'system', month: null, msg: `Tab "${tab}" has no month in its name — ignored.` }); continue; }

        const header = rows[0] || [];
        const totalRowIdx = rows.findIndex((r) => r && String(r[0] ?? '').trim().toLowerCase() === 'total');
        const body = rows.slice(1, totalRowIdx > 0 ? totalRowIdx : undefined).filter((r) => r && String(r[1] ?? '').trim());
        const M = { tab, month, parsed: [], textnums: 0, placeholders: 0, blockers: 0, sitesSeen: new Set(), empty: true };
        months.push(M);

        // Columns -> AOP sites
        const cols = [];
        const seenSite = new Map();
        for (let c = 2; c < header.length; c++) {
            const label = String(header[c] ?? '').trim();
            const hasData = body.some((r) => { const k = readCell(r[c]).kind; return k === 'number' || k === 'textnum'; });
            if (!label) {
                if (hasData) { add({ decision: 'BLOCK', code: 'G1', owner: 'site team', month, msg: `Column ${XLSX.utils.encode_col(c)} has figures but no site name.` }); M.blockers++; }
                continue;
            }
            const n = norm(label);
            if (!(n in SITE_ALIAS)) {
                add({ decision: 'BLOCK', code: 'G1', owner: 'super admin', month, site: label, msg: `Unknown site column "${label}" — map it to an AOP site or remove it.` });
                if (hasData) M.blockers++;
                continue;
            }
            const target = SITE_ALIAS[n];
            if (target === null) {
                if (hasData) {
                    add({ decision: 'BLOCK', code: 'G1', owner: 'super admin', month, site: label, msg: `"${label}" has figures but no AOP site yet (Delhi: one site or two? — open decision).` });
                    M.blockers++;
                }
                continue;
            }
            const site = siteByName.get(target);
            if (!site) { add({ decision: 'BLOCK', code: 'G1', owner: 'super admin', month, site: label, msg: `Alias points to "${target}", which is not in aop_sites.` }); M.blockers++; continue; }
            if (seenSite.has(site.id)) { add({ decision: 'BLOCK', code: 'G1', owner: 'site team', month, site: label, msg: `"${label}" and "${seenSite.get(site.id)}" both map to ${target}.` }); M.blockers++; continue; }
            seenSite.set(site.id, label);
            if (label !== label.trimStart() || String(header[c]) !== label) add({ decision: 'PASS', code: 'AUTO', owner: 'system', month, site: label, msg: `Header "${header[c]}" had stray spaces — matched anyway.` });
            cols.push({ c, label, site });
        }

        // Rows -> AOP line items
        const seenLine = new Set();
        for (const r of body) {
            const label = String(r[1]).trim();
            const line = lineByNorm.get(norm(label));
            const rowHasData = cols.some(({ c }) => { const k = readCell(r[c]).kind; return k === 'number' || k === 'textnum'; });
            if (!line) {
                if (rowHasData) {
                    add({ decision: 'BLOCK', code: 'G1', owner: 'super admin', month, line: label, msg: `Line "${label}" has figures but no AOP line — add it as a line or fold it into another (open decision).` });
                    M.blockers++;
                } else {
                    add({ decision: 'PASS', code: 'AUTO', owner: 'system', month, line: label, msg: `Line "${label}" has no AOP line, but is empty this month.` });
                }
                continue;
            }
            if (seenLine.has(line.id)) { add({ decision: 'BLOCK', code: 'G1', owner: 'site team', month, line: label, msg: `Line "${label}" appears twice.` }); M.blockers++; continue; }
            seenLine.add(line.id);

            for (const { c, label: siteLabel, site } of cols) {
                const cell = readCell(r[c]);
                if (cell.kind === 'blank' || cell.kind === 'na') continue;
                if (cell.kind === 'placeholder') {
                    M.placeholders++;
                    add({ decision: 'ROUTE', code: 'P1-G', owner: 'site team', month, site: siteLabel, line: label, msg: `"${cell.raw}" instead of a figure — not written; month cannot close until it is filled.` });
                    continue;
                }
                if (cell.kind === 'textnum') M.textnums++;
                if (cell.value < 0) add({ decision: 'REVIEW', code: 'P0-A', owner: 'accounts', month, site: siteLabel, line: label, msg: `Negative actual ${inr(cell.value)} — credit note?` });
                M.empty = false;
                M.sitesSeen.add(site.id);
                M.parsed.push({ site, siteLabel, line, value: cell.value, textnum: cell.kind === 'textnum' });
            }
        }

        // Control totals: the sheet's own Total row vs what we parsed.
        if (totalRowIdx > 0) {
            for (const { c, label, site } of cols) {
                const sheetTotal = readCell(rows[totalRowIdx][c]);
                if (sheetTotal.kind !== 'number' && sheetTotal.kind !== 'textnum') continue;
                // Every numeric cell in the column, mapped line or not — so only text/WIP cells explain a gap.
                const parsed = body.reduce((s, r) => { const v = readCell(r[c]); return s + (v.kind === 'number' || v.kind === 'textnum' ? v.value : 0); }, 0);
                if (Math.abs(sheetTotal.value - parsed) > MONEY_TOLERANCE) {
                    add({ decision: 'REVIEW', code: 'P0-A', owner: 'site team', month, site: label, msg: `Excel's Total row says ${lakh(sheetTotal.value)}, the cells add up to ${lakh(parsed)} — numbers typed as text are missing from Excel's sum.` });
                }
            }
        }
        if (M.textnums) add({ decision: 'PASS', code: 'AUTO', owner: 'system', month, msg: `${M.textnums} figure(s) typed as text (e.g. "2,81,059") read as numbers.` });
        if (M.empty) add({ decision: 'PASS', code: 'AUTO', owner: 'system', month, msg: `Tab "${tab}" has no figures — skipped (template or not filled yet).` });
    }

    // ---- per-month checks against history and the live table -----------------
    months.sort((a, b) => a.month.localeCompare(b.month));
    const prevCostingCol = new Map();      // siteId -> {month, values: Map(lineId -> v)}
    const applyPlan = [];

    for (const M of months) {
        if (M.empty) continue;
        const closed = closedMonths.has(M.month);
        M.closed = closed;
        M.counts = { new: 0, same: 0, differs: 0, conflict: 0 };

        // Outliers vs history before this month (P0-A)
        for (const p of M.parsed) {
            const prior = [...(history.get(`${p.site.id}|${p.line.id}`) || new Map())].filter(([m]) => m < M.month).map(([, v]) => v);
            if (prior.length) {
                const avg = prior.reduce((s, v) => s + v, 0) / prior.length;
                const ratio = avg > 0 ? p.value / avg : null;
                if (ratio != null && (ratio > OUTLIER_RATIO || ratio < 1 / OUTLIER_RATIO) && Math.max(p.value, avg) >= OUTLIER_FLOOR) {
                    add({ decision: 'REVIEW', code: 'P0-A', owner: 'site team', month: M.month, site: p.siteLabel, line: p.line.name, msg: `${inr(p.value)} vs ${inr(avg)} average of ${prior.length} earlier month(s) — ${ratio.toFixed(2)}x. Typo or real?` });
                }
            }
        }

        // Identical whole column to the previous costing month (copy-paste month)
        const bySite = new Map();
        for (const p of M.parsed) { if (!bySite.has(p.site.id)) bySite.set(p.site.id, new Map()); bySite.get(p.site.id).set(p.line.id, p.value); }
        for (const [siteId, vals] of bySite) {
            const prev = prevCostingCol.get(siteId);
            if (prev && vals.size >= 4 && vals.size === prev.values.size && [...vals].every(([l, v]) => prev.values.get(l) === v)) {
                add({ decision: 'REVIEW', code: 'P0-A', owner: 'site team', month: M.month, site: siteName.get(siteId), msg: `Every figure identical to ${ym(prev.month)} — copied forward?` });
            }
            prevCostingCol.set(siteId, { month: M.month, values: vals });
        }

        // Compare with the live table, respecting the ranking (P0-B)
        for (const p of M.parsed) {
            const db = dbCell.get(key(p.site.id, p.line.id, M.month));
            const dbActual = db && db.actual != null ? Number(db.actual) : null;
            if (dbActual == null) {
                M.counts.new++;
                if (!closed) applyPlan.push({ site_id: p.site.id, line_item_id: p.line.id, period_month: M.month, actual: p.value });
            } else if (Math.abs(dbActual - p.value) <= MONEY_TOLERANCE) {
                M.counts.same++;
            } else {
                M.counts.differs++;
                if (!closed) {
                    M.counts.conflict++;
                    add({ decision: 'REVIEW', code: 'P0-B', owner: 'accounts', month: M.month, site: p.siteLabel, line: p.line.name, msg: `Sheet ${inr(p.value)} vs ${inr(dbActual)} already in AOP (${db.source}). Costing ranks lowest — kept AOP figure.` });
                }
            }
        }
        if (closed) {
            add({ decision: 'PASS', code: 'P0-B', owner: 'system', month: M.month, msg: `Month already loaded from the finance workbook → treated as CLOSED. ${M.parsed.length} costing figures compared, none applied: ${M.counts.same} match, ${M.counts.differs} differ, ${M.counts.new} fill cells finance left empty.` });
        }

        // Expected vs received (P1-G) and budget presence — only matters for open months
        if (!closed) {
            const missing = sites.filter((s) => s.is_active && !M.sitesSeen.has(s.id)).map((s) => s.name);
            if (missing.length) add({ decision: 'ROUTE', code: 'P1-G', owner: 'site team', month: M.month, msg: `${missing.length} active AOP site(s) sent nothing: ${missing.join(', ')}. Month cannot close until they report or are excepted.` });
            const budgets = budgetCellsByMonth.get(M.month) || 0;
            if (!budgets) add({ decision: 'BLOCK', code: 'P1-G', owner: 'super admin', month: M.month, msg: `No budget loaded for ${ym(M.month)}. Actuals can be reviewed, but the month cannot close — and today's screens would paint every cell as overspend.` });
        }

        for (const p of M.parsed) pushHist(p.site.id, p.line.id, M.month, p.value);
    }

    // ---- downstream: what today's screens would show if the plan were applied ---
    const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
    function headline(cellList) {
        const ms = [...new Set(cellList.map((c) => c.period_month))].sort().reverse();
        const m = ms[0];
        const t = { budget: 0, actual: 0, saving: 0, overCells: 0 };
        const siteSaving = new Map();
        for (const c of cellList) {
            if (c.period_month !== m || lineKind.get(c.line_item_id) !== 'cost') continue;
            t.budget += n(c.budget); t.actual += n(c.actual); t.saving += n(c.budget) - n(c.actual);
            if (n(c.budget) - n(c.actual) < 0) t.overCells++;
            siteSaving.set(c.site_id, (siteSaving.get(c.site_id) || 0) + n(c.budget) - n(c.actual));
        }
        return { month: m, ...t, sitesOver: [...siteSaving.values()].filter((v) => v < 0).length, sites: siteSaving.size };
    }
    const before = headline(cells);
    const merged = cells.concat(applyPlan.map((a) => ({ ...a, budget: null, source: 'costing_sheet' })));
    const after = headline(merged);

    // Idempotency (P0-D): replay the same file on top of the applied state.
    const appliedKeys = new Set(merged.filter((c) => c.actual != null).map((c) => key(c.site_id, c.line_item_id, c.period_month)));
    const replayNew = applyPlan.filter((a) => !appliedKeys.has(key(a.site_id, a.line_item_id, a.period_month))).length;

    // ---- report --------------------------------------------------------------
    const counts = (d) => findings.filter((f) => f.decision === d).length;
    const L = [];
    L.push(`# AOP costing feed — dry run`);
    L.push('');
    L.push(`- File: \`${path.basename(WORKBOOK)}\` · sha256 \`${sha.slice(0, 16)}…\` (approval would be bound to this hash — P1-F)`);
    L.push(`- Live AOP: ${sites.length} sites · ${lines.length} line items · ${cells.length} cells · finance months: ${[...closedMonths].sort().map(ym).join(', ') || 'none'}`);
    L.push(`- Nothing was written. Assumptions: finance months = closed · Delhi columns unmapped · costing ranks lowest.`);
    L.push('');
    L.push(`**Decisions: ${counts('BLOCK')} BLOCK · ${counts('REVIEW')} REVIEW · ${counts('ROUTE')} ROUTE · ${counts('PASS')} PASS**`);
    L.push('');
    L.push(`## Per month`);
    L.push('');
    L.push(`| Month | Tab | Status | Figures | Fill empty | Match AOP | Differ | BLOCK | Can submit (G2) | Can close (G4) |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---|`);
    for (const M of months) {
        const fm = findings.filter((f) => f.month === M.month);
        const blocks = fm.filter((f) => f.decision === 'BLOCK').length;
        const canSubmit = !M.empty && !M.closed && fm.filter((f) => f.decision === 'BLOCK' && f.code === 'G1').length === 0;
        const canClose = !M.empty && !M.closed && blocks === 0 && !fm.some((f) => f.decision === 'ROUTE');
        const status = M.empty ? 'empty' : M.closed ? 'closed (finance)' : 'open';
        const c = M.counts || { new: 0, same: 0, differs: 0 };
        L.push(`| ${ym(M.month)} | ${M.tab} | ${status} | ${M.parsed.length} | ${M.closed ? `(${c.new})` : c.new} | ${c.same} | ${c.differs} | ${blocks} | ${M.empty || M.closed ? '—' : canSubmit ? 'yes' : 'NO'} | ${M.empty || M.closed ? '—' : canClose ? 'yes' : 'NO'} |`);
    }
    L.push('');
    L.push(`## If the open months were applied today`);
    L.push('');
    L.push(`| | Headline month | Budget | Actual | Saving (+ = under) | Sites over budget | Cost cells over budget |`);
    L.push(`|---|---|---|---|---|---|---|`);
    L.push(`| Now | ${ym(before.month)} | ${lakh(before.budget)} | ${lakh(before.actual)} | ${lakh(before.saving)} | ${before.sitesOver}/${before.sites} | ${before.overCells} |`);
    L.push(`| After | ${ym(after.month)} | ${lakh(after.budget)} | ${lakh(after.actual)} | ${lakh(after.saving)} | ${after.sitesOver}/${after.sites} | ${after.overCells} |`);
    L.push('');
    if (after.month !== before.month && after.budget === 0) {
        L.push(`**Breaks:** the headline jumps to ${ym(after.month)}, which has no budget, so Command Center, the AI brief and the AOP screen would show ${lakh(-after.saving)} of "overspend" across ${after.sitesOver} sites. The month-close gate (G4) is what prevents this.`);
        L.push('');
    }
    L.push(`- Would write ${applyPlan.length} cells (actuals only, empty cells only). Replaying the same file afterwards writes ${replayNew} — ${replayNew === 0 ? 'idempotent (P0-D ok)' : 'NOT idempotent'}.`);
    L.push('');
    L.push(`## Findings`);
    const order = { BLOCK: 0, ROUTE: 1, REVIEW: 2, PASS: 3 };
    for (const d of ['BLOCK', 'ROUTE', 'REVIEW', 'PASS']) {
        const fs_ = findings.filter((f) => f.decision === d).sort((a, b) => String(a.month).localeCompare(String(b.month)) || order[a.decision] - order[b.decision]);
        if (!fs_.length) continue;
        L.push('');
        L.push(`### ${d} (${fs_.length})`);
        L.push('');
        for (const f of fs_) {
            const where = [f.month ? ym(f.month) : null, f.site, f.line].filter(Boolean).join(' · ');
            L.push(`- **${f.code}** → ${f.owner}${where ? ` · ${where}` : ''} — ${f.msg}`);
        }
    }
    const report = L.join('\n') + '\n';
    if (OUT) { fs.writeFileSync(OUT, report); console.log(`Report written to ${OUT}`); }
    console.log(report);
})().catch((e) => { console.error(e.message); process.exit(1); });
