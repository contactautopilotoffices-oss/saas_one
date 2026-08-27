import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { resolveAopAccess, isAopAccessError, readOrgId } from '@/backend/lib/aop/access';
import {
    loadDimensions, loadCells, rollUpSite, rollUpGrand, normaliseMonth, monthLabel, cellKey,
    UNPROVISIONED,
    type AopCell, type AopLineItem, type AopSiteTotals,
} from '@/backend/lib/aop/matrix';

/**
 * GET /api/aop/export?org_id=&month=YYYY-MM
 *
 * Regenerates the workbook the finance team already knows, from the database. This is the
 * escape hatch that makes automating the tracker safe to adopt: nobody is being asked to
 * give up Excel, they are being given a version of it that is always current.
 *
 * The layout mirrors AOP-BudgetVsActual.xlsx — a Summary tab, then a "<Month>-Site wise"
 * tab with one four-column block per site — with two deliberate corrections:
 *
 *  1. The variance header reads "Var (Bud-Act)". The source says "Var (Act-Bud)" but
 *     computes budget minus actual. Copying the wrong label forward would keep the
 *     ambiguity alive in every downstream copy of the file.
 *  2. Status is plain text with colour, not an emoji. Emoji in a spreadsheet break
 *     filtering, sorting and every formula that tries to match on the cell.
 *
 * Totals are recomputed from cost lines, never lifted from the source's own TOTAL rows.
 */

export const dynamic = 'force-dynamic';

// Indian digit grouping. Excel understands the repeated two-digit group natively.
const INR_FMT = '#,##,##0.00';
const COUNT_FMT = '#,##0';

const BRAND = 'FF708F96';        // --primary
const BRAND_SOFT = 'FFEDF2F3';
const OVER = 'FFC0392B';
const UNDER = 'FF1E8449';

const unitFormat = (li: AopLineItem): string =>
    li.unit === 'count' || li.unit === 'sqft' ? COUNT_FMT : INR_FMT;

export async function GET(request: NextRequest) {
    const access = await resolveAopAccess(request, readOrgId(request));
    if (isAopAccessError(access)) return access;

    let dims;
    try {
        dims = await loadDimensions(access.organizationId);
    } catch (e) {
        console.error('[aop export] dimensions', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not build the export' }, { status: 500 });
    }
    if (dims === UNPROVISIONED) {
        return NextResponse.json({ error: 'The AOP tracker is not set up yet' }, { status: 503 });
    }

    const { sites, lineItems, months } = dims;
    if (!months.length) {
        return NextResponse.json({ error: 'No AOP data to export yet' }, { status: 404 });
    }

    const requested = normaliseMonth(new URL(request.url).searchParams.get('month'));
    const month = requested && months.includes(requested) ? requested : months[0];

    let byMonth;
    try {
        byMonth = await loadCells(access.organizationId, [month]);
    } catch (e) {
        console.error('[aop export] cells', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not build the export' }, { status: 500 });
    }
    if (byMonth === UNPROVISIONED) {
        return NextResponse.json({ error: 'The AOP tracker is not set up yet' }, { status: 503 });
    }

    const cells = byMonth.get(month) || [];
    const lineById = new Map<string, AopLineItem>(lineItems.map(li => [li.id, li]));
    const byKey = new Map<string, AopCell>(cells.map(c => [cellKey(c.site_id, c.line_item_id), c]));

    const bySite = new Map<string, AopCell[]>();
    for (const cell of cells) {
        const list = bySite.get(cell.site_id);
        if (list) list.push(cell);
        else bySite.set(cell.site_id, [cell]);
    }
    const siteTotals = new Map<string, AopSiteTotals>(
        sites.map(s => [s.id, rollUpSite(bySite.get(s.id) || [], lineById)]),
    );
    const grand = rollUpGrand(siteTotals);

    const label = monthLabel(month);                       // "Jun 2026"
    const short = label.replace(' 20', '-');               // "Jun-26"

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Autopilot Offices';
    workbook.created = new Date();

    // ---------------------------------------------------------------------
    // Summary — one row per site, plus the pan-India roll-up.
    // ---------------------------------------------------------------------
    const summary = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 2 }] });
    summary.columns = [
        { width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 16 },
        { width: 12 }, { width: 16 },
    ];

    const sTitle = summary.addRow([
        `AOP Tracker | Budget vs Actual | ${label} | Ops cost only, rent excluded`,
    ]);
    sTitle.font = { bold: true, size: 12, color: { argb: BRAND } };
    summary.mergeCells(1, 1, 1, 7);

    const sHead = summary.addRow([
        'Location', `${short} Budget (₹)`, `${short} Actual (₹)`,
        'Variance (Bud-Act)', 'Status', 'Seats', 'Cost / Seat (₹)',
    ]);
    sHead.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sHead.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        c.alignment = { vertical: 'middle', wrapText: true };
    });

    const writeSummaryRow = (
        name: string, t: AopSiteTotals, bold = false,
    ) => {
        const row = summary.addRow([
            name, t.cost.budget, t.cost.actual, t.cost.saving,
            t.cost.saving < 0 ? 'Over Budget' : 'Under Budget',
            t.seat_count ?? null, t.cost_per_seat ?? null,
        ]);
        row.getCell(2).numFmt = INR_FMT;
        row.getCell(3).numFmt = INR_FMT;
        row.getCell(4).numFmt = INR_FMT;
        row.getCell(6).numFmt = COUNT_FMT;
        row.getCell(7).numFmt = INR_FMT;
        const tone = t.cost.saving < 0 ? OVER : UNDER;
        row.getCell(4).font = { color: { argb: tone }, bold };
        row.getCell(5).font = { color: { argb: tone }, bold: true };
        if (bold) row.font = { bold: true };
        return row;
    };

    for (const site of sites) {
        const t = siteTotals.get(site.id);
        // A site with no cells at all this month is genuinely absent from the period
        // (Mafatlal C Wing only appears from June); an empty row would read as zero spend.
        if (!t || (t.cost.budget === 0 && t.cost.actual === 0)) continue;
        writeSummaryRow(site.name, t);
    }

    const panRow = writeSummaryRow('PAN INDIA COST', grand, true);
    panRow.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } };
        c.border = { top: { style: 'thin' } };
    });

    // ---------------------------------------------------------------------
    // "<Month>-Site wise" — the matrix, four columns per site.
    // ---------------------------------------------------------------------
    const grid = workbook.addWorksheet(`${label.split(' ')[0]}-Site wise`, {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
    });

    const activeSites = sites.filter(s => bySite.has(s.id));
    grid.getColumn(1).width = 34;
    activeSites.forEach((_, i) => {
        const base = 2 + i * 4;
        grid.getColumn(base).width = 16;
        grid.getColumn(base + 1).width = 16;
        grid.getColumn(base + 2).width = 16;
        grid.getColumn(base + 3).width = 30;
    });

    const titleRow = grid.addRow([
        `AOP Tracker | Budget vs Actual | ${label} — variance is Budget − Actual; positive means under budget`,
    ]);
    titleRow.font = { bold: true, size: 12, color: { argb: BRAND } };

    // Row 1 carries the site name over the first column of each block, exactly as the
    // source workbook does, so a human eye can still find a site by scanning the top.
    const siteHeaderValues: (string | null)[] = [null];
    const fieldHeaderValues: string[] = ['Cost Category'];
    for (const site of activeSites) {
        siteHeaderValues.push(site.name, null, null, null);
        fieldHeaderValues.push(
            `${short}\nBudget`, `${short}\nActual`, `${short}\nVar (Bud-Act)`, 'Remarks',
        );
    }
    const siteRow = grid.addRow(siteHeaderValues);
    siteRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    siteRow.eachCell({ includeEmpty: true }, c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    activeSites.forEach((_, i) => {
        const base = 2 + i * 4;
        grid.mergeCells(2, base, 2, base + 3);
    });

    const fieldRow = grid.addRow(fieldHeaderValues);
    fieldRow.font = { bold: true, size: 10 };
    fieldRow.height = 28;
    fieldRow.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } };
        c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    });
    fieldRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

    for (const li of lineItems) {
        const values: (string | number | null)[] = [li.name];
        for (const site of activeSites) {
            const cell = byKey.get(cellKey(site.id, li.id));
            const budget = cell?.budget ?? null;
            const actual = cell?.actual ?? null;
            values.push(
                budget, actual,
                // Recomputed, so a cell with an actual but no budget still reads as an
                // overspend rather than a blank.
                budget === null && actual === null ? null : Number(budget ?? 0) - Number(actual ?? 0),
                cell?.remarks ?? null,
            );
        }

        const row = grid.addRow(values);
        const isRollUp = li.kind === 'total';
        row.getCell(1).font = { bold: isRollUp };
        if (isRollUp) {
            row.eachCell({ includeEmpty: true }, c => {
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } };
            });
        }

        const fmt = unitFormat(li);
        activeSites.forEach((_, i) => {
            const base = 2 + i * 4;
            row.getCell(base).numFmt = fmt;
            row.getCell(base + 1).numFmt = fmt;
            row.getCell(base + 2).numFmt = fmt;
            const variance = row.getCell(base + 2).value;
            // Only money lines carry a meaningful over/under signal — a seat count that
            // differs between plan and actual is a data-entry note, not an overspend.
            if (typeof variance === 'number' && li.kind === 'cost') {
                row.getCell(base + 2).font = { color: { argb: variance < 0 ? OVER : UNDER } };
            }
        });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `AOP-BudgetVsActual-${month.slice(0, 7)}.xlsx`;

    return new NextResponse(buffer, {
        headers: {
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control': 'no-store',
        },
    });
}
