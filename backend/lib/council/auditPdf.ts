/**
 * Council audit → PDF.
 *
 * The xlsx export (auditExport.ts) is the working register — sortable, filterable,
 * something the ops team edits. This is the opposite artifact: the read-only document
 * you forward to a CEO or attach to a board pack. Same data, different job, so it is a
 * separate builder rather than a flag on the workbook.
 *
 * Rendered by printing HTML through headless Chromium (puppeteer is already a repo
 * dependency, used nowhere else in the request path). We do NOT hand-assemble PDF
 * primitives with jspdf: the audit is long-form prose with tables of unknown length,
 * and manual pagination of that is where PDF builders go to die. Chromium already
 * knows how to break a page.
 *
 * SECURITY: the chairman synthesis is LLM output and the findings contain model-written
 * prose. Every interpolation goes through esc(); the markdown renderer below emits only
 * a fixed set of tags and never passes source text through unescaped. There is no
 * dangerouslySetInnerHTML equivalent here — the HTML is assembled server-side from
 * escaped fragments only.
 *
 * Styling is bounded by the house design system: --primary #708F96, --secondary #AA895F,
 * status colours from app/globals.css, Poppins display / Urbanist body. Fonts are
 * referenced by name only — Chromium falls back to a system sans if they are absent,
 * which degrades the look but never the content.
 */

export interface AuditPdfFinding {
    agent_key: string;
    severity: string;
    title: string;
    detail: string | null;
    evidence: unknown;
    recommendation: string | null;
    status: string | null;
}

export interface AuditPdfSession {
    id: string;
    question: string | null;
    status: string | null;
    trigger: string | null;
    created_at: string | null;
    completed_at: string | null;
    data_pack: unknown;
}

export interface AuditPdfInput {
    orgName: string;
    session: AuditPdfSession;
    synthesis: string | null;
    findings: AuditPdfFinding[];
    /** Optional: who each finding was routed to, keyed by finding id. */
    assignments?: Map<string, string>;
}

const BRAND = '#708F96';
const SEVERITY: Record<string, { fg: string; bg: string }> = {
    P0: { fg: '#B91C1C', bg: '#FEE2E2' },
    P1: { fg: '#B45309', bg: '#FEF3C7' },
    P2: { fg: '#1D4ED8', bg: '#DBEAFE' },
};

const AGENT_NAMES: Record<string, string> = {
    ops: 'Bose · Operations',
    compliance: 'Mehta · Compliance',
    qa: 'Iyer · QA',
    product: 'Rao · Product Lifecycle',
    cto: 'Verma · CTO Security',
    procurement: 'Nair · Procurement',
    energy: 'Deshpande · Energy',
    tenant: 'Kulkarni · Tenant Experience',
    chairman: 'The Chairman',
};

function esc(v: unknown): string {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Inline markdown: bold, italic, code. Runs AFTER esc(), so it only ever sees safe text. */
function inline(safe: string): string {
    return safe
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

/**
 * Minimal, deliberately boring markdown → HTML for the chairman synthesis.
 * Handles what the chairman prompt actually emits: #/##/### headings, - and 1. lists,
 * | tables |, and paragraphs. Anything else falls through as an escaped paragraph.
 * No library, because the only untrusted input in this file is the text it renders.
 */
function markdown(src: string): string {
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let list: 'ul' | 'ol' | null = null;
    let table: string[][] | null = null;

    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    const closeTable = () => {
        if (!table || !table.length) { table = null; return; }
        const [head, ...body] = table;
        out.push('<table class="md-table"><thead><tr>');
        for (const c of head) out.push(`<th>${inline(esc(c))}</th>`);
        out.push('</tr></thead><tbody>');
        for (const row of body) {
            out.push('<tr>');
            for (const c of row) out.push(`<td>${inline(esc(c))}</td>`);
            out.push('</tr>');
        }
        out.push('</tbody></table>');
        table = null;
    };

    for (const raw of lines) {
        const line = raw.trimEnd();

        // Table rows: | a | b |. The |---|---| separator is dropped.
        if (/^\s*\|.*\|\s*$/.test(line)) {
            closeList();
            const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
            if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
            (table ||= []).push(cells);
            continue;
        }
        closeTable();

        if (!line.trim()) { closeList(); continue; }

        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
            closeList();
            const level = Math.min(h[1].length + 1, 5);   // # -> h2, the doc owns h1
            out.push(`<h${level}>${inline(esc(h[2]))}</h${level}>`);
            continue;
        }

        const ul = line.match(/^\s*[-*]\s+(.*)$/);
        if (ul) {
            if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
            out.push(`<li>${inline(esc(ul[1]))}</li>`);
            continue;
        }

        const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (ol) {
            // The chairman writes "1. item" then indented bullets then "2. item", which
            // interrupts the <ol>. Reopening without `start` restarts every entry at 1 —
            // producing a P0 list numbered 1, 1, 1 in a document going to a CEO. Carry
            // the author's own ordinal across the interruption.
            if (list !== 'ol') { closeList(); out.push(`<ol start="${Number(ol[1]) || 1}">`); list = 'ol'; }
            out.push(`<li>${inline(esc(ol[2]))}</li>`);
            continue;
        }

        closeList();
        out.push(`<p>${inline(esc(line))}</p>`);
    }
    closeList();
    closeTable();
    return out.join('\n');
}

/** Evidence jsonb → "field — value" lines. Non-objects degrade to their JSON. */
function evidenceLines(evidence: unknown): string[] {
    if (!evidence) return [];
    if (typeof evidence !== 'object' || Array.isArray(evidence)) {
        return [String(JSON.stringify(evidence)).slice(0, 300)];
    }
    return Object.entries(evidence as Record<string, unknown>)
        .slice(0, 12)
        .map(([k, v]) => `${k} — ${typeof v === 'string' ? v : JSON.stringify(v)}`);
}

const fmtDate = (iso: string | null): string => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
        });
    } catch { return iso; }
};

function buildHtml(input: AuditPdfInput): string {
    const { orgName, session, synthesis, findings, assignments } = input;

    const counts = { P0: 0, P1: 0, P2: 0 } as Record<string, number>;
    for (const f of findings) if (counts[f.severity] !== undefined) counts[f.severity]++;

    const order: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
    const sorted = [...findings].sort(
        (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9),
    );

    const sections = session.data_pack && typeof session.data_pack === 'object'
        ? (session.data_pack as { sections?: Record<string, { source?: string; fetched_at?: string; note?: string }> }).sections || {}
        : {};

    const findingCard = (f: AuditPdfFinding, i: number) => {
        const sev = SEVERITY[f.severity] || { fg: '#374151', bg: '#F3F4F6' };
        const ev = evidenceLines(f.evidence);
        const who = assignments?.get((f as unknown as { id?: string }).id || '');
        return `
        <article class="finding">
          <div class="finding-head">
            <span class="sev" style="color:${sev.fg};background:${sev.bg}">${esc(f.severity)}</span>
            <h3>${esc(i + 1)}. ${esc(f.title)}</h3>
          </div>
          <p class="agent">${esc(AGENT_NAMES[f.agent_key] || f.agent_key)}${
              who ? ` &nbsp;·&nbsp; <span class="assigned">Routed to ${esc(who)}</span>` : ''
          }</p>
          ${f.detail ? `<p>${inline(esc(f.detail))}</p>` : ''}
          ${ev.length ? `<div class="evidence"><span class="lbl">Evidence</span><ul>${
              ev.map(e => `<li>${esc(e)}</li>`).join('')
          }</ul></div>` : ''}
          ${f.recommendation ? `<div class="ask"><span class="lbl">Ask</span><p>${inline(esc(f.recommendation))}</p></div>` : ''}
        </article>`;
    };

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Council Audit</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: Urbanist, "Helvetica Neue", Arial, sans-serif; color:#1F2937; font-size:10.5pt; line-height:1.55; margin:0; }
  h1,h2,h3,h4 { font-family: Poppins, Urbanist, sans-serif; color:#111827; line-height:1.25; }
  h1 { font-size:22pt; margin:0 0 4pt; letter-spacing:-.4pt; }
  h2 { font-size:13pt; margin:18pt 0 6pt; padding-bottom:4pt; border-bottom:1.5pt solid ${BRAND}; }
  h3 { font-size:11pt; margin:0; }
  h4,h5 { font-size:10.5pt; margin:10pt 0 4pt; }
  p { margin:.4em 0; }
  code { font-family: ui-monospace, Menlo, monospace; font-size:9pt; background:#F3F4F6; padding:1pt 3pt; border-radius:3px; }

  .cover { border-left:4pt solid ${BRAND}; padding-left:12pt; margin-bottom:14pt; }
  .eyebrow { text-transform:uppercase; letter-spacing:1.4pt; font-size:7.5pt; color:${BRAND}; font-weight:700; margin:0 0 2pt; }
  .sub { color:#6B7280; font-size:9pt; margin:2pt 0 0; }
  .question { font-style:italic; color:#374151; margin-top:8pt; }

  .meta { width:100%; border-collapse:collapse; margin:10pt 0 4pt; font-size:9pt; }
  .meta td { padding:3pt 0; border-bottom:.5pt solid #E5E7EB; }
  .meta td:first-child { color:#6B7280; width:34%; }

  .tally { display:flex; gap:6pt; margin:10pt 0 0; }
  .tally span { font-weight:700; font-size:9pt; padding:3pt 9pt; border-radius:99pt; }

  .finding { border:.75pt solid #E5E7EB; border-radius:5pt; padding:9pt 11pt; margin:8pt 0; page-break-inside:avoid; }
  .finding-head { display:flex; gap:7pt; align-items:baseline; }
  .sev { font-weight:700; font-size:8pt; padding:1.5pt 6pt; border-radius:3pt; letter-spacing:.4pt; }
  .agent { color:#6B7280; font-size:8.5pt; margin:3pt 0 5pt; }
  .assigned { color:${BRAND}; font-weight:600; }
  .lbl { display:block; text-transform:uppercase; letter-spacing:1pt; font-size:7pt; color:#6B7280; font-weight:700; margin-bottom:2pt; }
  .evidence { background:#F9FAFB; border-radius:4pt; padding:6pt 9pt; margin:6pt 0; }
  .evidence ul { margin:0; padding-left:12pt; }
  .evidence li { font-size:8.5pt; color:#374151; font-variant-numeric:tabular-nums; }
  .ask { border-left:2.5pt solid ${BRAND}; padding-left:8pt; margin-top:6pt; }
  .ask p { margin:0; font-size:9.5pt; }

  .md-table { width:100%; border-collapse:collapse; margin:8pt 0; font-size:9pt; }
  .md-table th { background:#F3F4F6; text-align:left; padding:4pt 6pt; border:.5pt solid #E5E7EB; font-size:8pt; text-transform:uppercase; letter-spacing:.5pt; }
  .md-table td { padding:4pt 6pt; border:.5pt solid #E5E7EB; font-variant-numeric:tabular-nums; }

  .pack { width:100%; border-collapse:collapse; font-size:8.5pt; margin-top:6pt; }
  .pack th { text-align:left; color:#6B7280; font-size:7.5pt; text-transform:uppercase; letter-spacing:.6pt; padding:3pt 4pt; border-bottom:.75pt solid #E5E7EB; }
  .pack td { padding:3pt 4pt; border-bottom:.5pt solid #F3F4F6; }
  .ok { color:#047857; } .bad { color:#B91C1C; }

  footer { position:fixed; bottom:-12mm; left:0; right:0; font-size:7.5pt; color:#9CA3AF; }
</style></head>
<body>
  <div class="cover">
    <p class="eyebrow">${esc(orgName)} · Agent Council</p>
    <h1>Council Audit</h1>
    <p class="sub">${esc(fmtDate(session.created_at))} · ${esc(session.trigger || 'manual')} convening · ${esc(findings.length)} findings</p>
    ${session.question ? `<p class="question">“${esc(session.question)}”</p>` : ''}
    <div class="tally">
      <span style="color:${SEVERITY.P0.fg};background:${SEVERITY.P0.bg}">P0 · ${counts.P0}</span>
      <span style="color:${SEVERITY.P1.fg};background:${SEVERITY.P1.bg}">P1 · ${counts.P1}</span>
      <span style="color:${SEVERITY.P2.fg};background:${SEVERITY.P2.bg}">P2 · ${counts.P2}</span>
    </div>
  </div>

  ${synthesis ? `<h2>Chairman's synthesis</h2>${markdown(synthesis)}` : '<h2>Chairman\'s synthesis</h2><p><em>No synthesis was produced for this session.</em></p>'}

  <h2>Findings register</h2>
  ${sorted.length ? sorted.map(findingCard).join('') : '<p><em>No findings were filed.</em></p>'}

  <h2>Evidence pack</h2>
  <p class="sub">Every figure above traces to one of these sections. A section marked
  unavailable was not readable at the time of the convening — the council was told so,
  and treated the absence as a finding rather than guessing.</p>
  <table class="pack">
    <thead><tr><th>Section</th><th>Source</th><th>Fetched</th><th>State</th></tr></thead>
    <tbody>
      ${Object.entries(sections).map(([k, s]) => `<tr>
        <td>${esc(k)}</td>
        <td>${esc(s?.source || '—')}</td>
        <td>${esc(s?.fetched_at ? fmtDate(s.fetched_at) : '—')}</td>
        <td class="${s?.note ? 'bad' : 'ok'}">${esc(s?.note ? 'unavailable' : 'ok')}</td>
      </tr>`).join('') || '<tr><td colspan="4">No data pack was stored with this session.</td></tr>'}
    </tbody>
  </table>

  <table class="meta">
    <tr><td>Session</td><td>${esc(session.id)}</td></tr>
    <tr><td>Status</td><td>${esc(session.status || '—')}</td></tr>
    <tr><td>Completed</td><td>${esc(fmtDate(session.completed_at))}</td></tr>
  </table>
</body></html>`;
}

/**
 * Render the audit to a PDF buffer. Throws on launch/render failure — the route
 * reports it rather than returning a corrupt download (FP-04).
 */
export async function buildCouncilAuditPdf(input: AuditPdfInput): Promise<Buffer> {
    // Imported lazily: puppeteer pulls in a browser binary and must not be loaded by
    // every route that happens to import this module's types.
    const puppeteer = (await import('puppeteer')).default;

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(buildHtml(input), { waitUntil: 'load', timeout: 30_000 });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate:
                `<div style="width:100%;font-size:7.5pt;color:#9CA3AF;padding:0 16mm;`
                + `font-family:Arial,sans-serif;display:flex;justify-content:space-between">`
                + `<span>${esc(input.orgName)} · Agent Council audit — generated, not hand-written</span>`
                + `<span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
            margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
        });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

/** Exposed for tests/preview without spawning Chromium. */
export const _buildHtmlForTest = buildHtml;
