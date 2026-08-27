import ExcelJS from 'exceljs';

/**
 * Council audit workbook — mirrors the Saniel weekly-audit format
 * (docs/COUNCIL_SPEC.md): a plain-text summary with the chairman's synthesis, the
 * findings register with severity-tinted P0/P1/P2 cells, and the data pack the
 * council reasoned over. Styling follows the exceljs pattern already used by
 * app/api/aop/export/route.ts.
 */

const BRAND = 'FF708F96';        // --primary
const BRAND_SOFT = 'FFEDF2F3';

// Severity tints: light fill + strong text, so the cell stays readable and the
// severity column can still be filtered/sorted on plain text (no emoji, per the
// AOP export's hard-won lesson).
const SEVERITY_STYLE: Record<string, { fill: string; font: string }> = {
    P0: { fill: 'FFF8D7DA', font: 'FFC0392B' },
    P1: { fill: 'FFFFF3CD', font: 'FFB9770E' },
    P2: { fill: 'FFD4EDDA', font: 'FF1E8449' },
};

export interface CouncilExportSession {
    id: string;
    question: string | null;
    status: string | null;
    trigger: string | null;
    created_at: string | null;
    completed_at: string | null;
    data_pack: unknown;
}

export interface CouncilExportFinding {
    agent_key: string | null;
    severity: string | null;
    title: string | null;
    detail: string | null;
    evidence: unknown;
    recommendation: string | null;
    status: string | null;
}

export interface CouncilAuditWorkbookInput {
    orgName: string;
    session: CouncilExportSession;
    /** Chairman synthesis markdown (stage 3); null when the session never reached it */
    synthesis: string | null;
    findings: CouncilExportFinding[];
}

function compact(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * The chairman's synthesis is markdown written for humans, not a grid. Render it as
 * plain-text sections: headings become bold section rows (markers stripped),
 * everything else lands one spreadsheet row per line so the text survives copy-paste
 * into a mail or doc without grid artifacts.
 */
function writeSynthesis(sheet: ExcelJS.Worksheet, markdown: string) {
    for (const rawLine of markdown.split('\n')) {
        const line = rawLine.trimEnd();
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            sheet.addRow([]);
            const row = sheet.addRow([heading[2]]);
            row.font = { bold: true, size: 12, color: { argb: BRAND } };
        } else if (line.trim() === '') {
            sheet.addRow([]);
        } else {
            const row = sheet.addRow([line]);
            row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
        }
    }
}

/**
 * data_pack is a jsonb bag of sections (each tagged with source + fetched_at by the
 * collector, shape owned by backend/lib/council/dataPack.ts). Flattened generically
 * to section / key / value rows so the export never breaks when a section is added.
 */
function writeDataPack(sheet: ExcelJS.Worksheet, dataPack: unknown) {
    const head = sheet.addRow(['Section', 'Key', 'Value']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    });

    if (!dataPack || typeof dataPack !== 'object' || Array.isArray(dataPack)) {
        const row = sheet.addRow(['data_pack', '', compact(dataPack) || 'No data pack recorded for this session']);
        row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
        return;
    }

    for (const [section, value] of Object.entries(dataPack as Record<string, unknown>)) {
        const sectionRow = sheet.addRow([section]);
        sectionRow.font = { bold: true };
        sectionRow.eachCell(c => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } };
        });

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
                const row = sheet.addRow(['', key, compact(inner)]);
                row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
            }
        } else {
            const row = sheet.addRow(['', '', compact(value)]);
            row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
        }
    }
}

export async function buildCouncilAuditWorkbook({
    orgName,
    session,
    synthesis,
    findings,
}: CouncilAuditWorkbookInput): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Autopilot Offices — Agent Council';
    workbook.created = new Date();

    const sessionDate = (session.created_at || new Date().toISOString()).slice(0, 10);

    // ---------------------------------------------------------------------
    // Sheet 1 — Audit Summary: org, date, the council's question, then the
    // chairman synthesis as plain-text sections.
    // ---------------------------------------------------------------------
    const summary = workbook.addWorksheet('Audit Summary');
    summary.columns = [{ width: 110 }];

    const title = summary.addRow([`Council Audit | ${orgName} | ${sessionDate}`]);
    title.font = { bold: true, size: 14, color: { argb: BRAND } };
    summary.addRow([]);

    const meta: [string, string][] = [
        ['Organization', orgName],
        ['Session date', sessionDate],
        ['Session id', session.id],
        ['Trigger', session.trigger || 'manual'],
        ['Status', session.status || 'unknown'],
        ['Completed at', session.completed_at ? session.completed_at.slice(0, 19).replace('T', ' ') : '—'],
    ];
    for (const [label, value] of meta) {
        const row = summary.addRow([`${label}: ${value}`]);
        row.getCell(1).font = { bold: label === 'Organization' };
    }
    summary.addRow([]);

    const qHead = summary.addRow(['Council question']);
    qHead.font = { bold: true, size: 12, color: { argb: BRAND } };
    const qRow = summary.addRow([session.question || 'Weekly audit (no explicit question)']);
    qRow.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    summary.addRow([]);

    const sHead = summary.addRow(['Chairman synthesis']);
    sHead.font = { bold: true, size: 12, color: { argb: BRAND } };
    if (synthesis) {
        writeSynthesis(summary, synthesis);
    } else {
        summary.addRow(['No synthesis recorded — the session did not reach the chairman stage.']);
    }

    // ---------------------------------------------------------------------
    // Sheet 2 — Findings register. An empty session still gets the header and an
    // explicit note row, so "no findings" reads as a result, not a broken export.
    // ---------------------------------------------------------------------
    const register = workbook.addWorksheet('Findings', { views: [{ state: 'frozen', ySplit: 1 }] });
    register.columns = [
        { width: 10 },   // Severity
        { width: 14 },   // Agent
        { width: 36 },   // Title
        { width: 60 },   // Detail
        { width: 40 },   // Evidence
        { width: 50 },   // Recommendation
        { width: 12 },   // Status
    ];

    const fHead = register.addRow(['Severity', 'Agent', 'Title', 'Detail', 'Evidence', 'Recommendation', 'Status']);
    fHead.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fHead.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        c.alignment = { vertical: 'middle' };
    });

    if (findings.length === 0) {
        const row = register.addRow(['—', '—', 'No findings recorded for this session', '', '', '', '']);
        row.font = { italic: true, color: { argb: 'FF64748B' } };
    }

    for (const finding of findings) {
        const severity = (finding.severity || '').toUpperCase();
        const row = register.addRow([
            severity || '—',
            finding.agent_key || '',
            finding.title || '',
            finding.detail || '',
            compact(finding.evidence),
            finding.recommendation || '',
            finding.status || 'open',
        ]);
        const style = SEVERITY_STYLE[severity];
        if (style) {
            const cell = row.getCell(1);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
            cell.font = { bold: true, color: { argb: style.font } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        for (const col of [3, 4, 5, 6]) {
            row.getCell(col).alignment = { wrapText: true, vertical: 'top' };
        }
    }

    // ---------------------------------------------------------------------
    // Sheet 3 — Data Pack: the figures the council reasoned over, flattened to
    // section / key / value rows.
    // ---------------------------------------------------------------------
    const pack = workbook.addWorksheet('Data Pack', { views: [{ state: 'frozen', ySplit: 1 }] });
    pack.columns = [{ width: 24 }, { width: 36 }, { width: 90 }];
    writeDataPack(pack, session.data_pack);

    return workbook;
}
