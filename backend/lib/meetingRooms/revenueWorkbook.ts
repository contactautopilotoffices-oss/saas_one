import ExcelJS from 'exceljs';
import type { RevenueBookingLine, RevenueReport } from './revenue';

/**
 * Excel workbook for the meeting room revenue sheet (GET /api/meeting-rooms/revenue?format=xlsx).
 * Tabs: Summary, Client Revenue, Room Revenue, All Bookings, then one tab per client.
 * The report's view (clients, internal or all) decides which bookings it covers.
 */

const VIEW_LABEL: Record<RevenueReport['view'], string> = {
    clients: 'Clients only',
    internal: 'Internal users only',
    all: 'All users',
};

const typeLabel = (c: RevenueReport['clients'][number]) =>
    c.category === 'internal' ? 'Internal' : c.type === 'company' ? 'Company' : 'Tenant';

/** Text that Excel would read as a formula (=, +, -, @) is prefixed with a quote so it stays text. */
const safeText = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const INR_FMT = '#,##,##0.00';
const HRS_FMT = '0.00';
const BRAND = 'FF708F96'; // --primary, same as the AOP export
const BRAND_SOFT = 'FFEDF2F3';

function monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function styleHeader(row: ExcelJS.Row) {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        c.alignment = { vertical: 'middle', wrapText: true };
    });
}

function styleTotal(row: ExcelJS.Row) {
    row.font = { bold: true };
    row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } }; });
}

function formatCells(row: ExcelJS.Row, inrCols: number[], hrsCols: number[]) {
    inrCols.forEach(i => { row.getCell(i).numFmt = INR_FMT; });
    hrsCols.forEach(i => { row.getCell(i).numFmt = HRS_FMT; });
}

/** Excel sheet names: max 31 chars, no []:*?/\ and unique within the workbook. */
function sheetName(raw: string, used: Set<string>): string {
    const base = (raw.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Client').slice(0, 28);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
    used.add(name.toLowerCase());
    return name;
}

const BOOKING_HEADERS = [
    'Date', 'Start', 'End', 'Room', 'Booked By', 'Notes', 'Hours', 'Rate / Hr (₹)',
    'Credit Hrs', 'Exceeded Hrs', 'Credit Value (₹)', 'Exceeded Revenue (₹)', 'Total Value (₹)',
];

function addBookingRow(ws: ExcelJS.Worksheet, b: RevenueBookingLine, clientName?: string) {
    const values = [
        b.date, b.startTime, b.endTime, safeText(b.roomName), safeText(b.bookedBy), safeText(b.comment || ''),
        b.hours, b.hourlyRate,
        b.creditHours, b.exceededHours, b.creditValue, b.exceededRevenue, b.totalValue,
    ];
    const row = ws.addRow(clientName !== undefined ? [safeText(clientName), ...values] : values);
    const o = clientName !== undefined ? 1 : 0;
    formatCells(row, [8 + o, 11 + o, 12 + o, 13 + o], [7 + o, 9 + o, 10 + o]);
}

export async function buildRevenueWorkbook(report: RevenueReport, propertyName: string, month: string) {
    const label = monthLabel(month);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Autopilot Offices';
    wb.created = new Date();
    const used = new Set<string>();

    // Summary
    const summary = wb.addWorksheet(sheetName('Summary', used));
    summary.columns = [{ width: 34 }, { width: 20 }];
    const title = summary.addRow([`Meeting Room Revenue | ${safeText(propertyName)} | ${label} | ${VIEW_LABEL[report.view]}`]);
    title.font = { bold: true, size: 12, color: { argb: BRAND } };
    summary.addRow([]);
    styleHeader(summary.addRow(['Metric', 'Value']));
    const t = report.totals;
    const summaryRows: [string, number, 'inr' | 'hrs' | 'count'][] = [
        ['Bookings', t.bookingCount, 'count'],
        ['Hours booked', t.bookedHours, 'hrs'],
        ['Hours covered by credits', t.creditHours, 'hrs'],
        ['Hours exceeding credits', t.exceededHours, 'hrs'],
        ['Internal hours (no charge)', t.internalHours, 'hrs'],
        ['Credit value (₹)', t.creditValue, 'inr'],
        ['Exceeded revenue, billable (₹)', t.exceededRevenue, 'inr'],
        ['Total value (₹)', t.totalValue, 'inr'],
    ];
    summaryRows.forEach(([k, v, kind]) => {
        const row = summary.addRow([k, v]);
        if (kind === 'inr') row.getCell(2).numFmt = INR_FMT;
        if (kind === 'hrs') row.getCell(2).numFmt = HRS_FMT;
        if (k.startsWith('Exceeded revenue')) row.font = { bold: true };
    });
    summary.addRow([]);
    summary.addRow(['How it is calculated']).font = { bold: true };
    [
        'Each client uses its free monthly credit hours first, in booking date and time order.',
        'Hours after the credits are used up are exceeded hours. These are the billable amount.',
        'A client with no credit plan has no free hours, so all of its hours are exceeded hours.',
        'Value = hours x the room price per hour. Prices are before GST.',
        'Clients are companies and users with a tenant role. Only clients count as revenue.',
        'Everyone else (HR, CRM/BD, IT, Design, staff, admins) is internal: hours only, no charge.',
        'Cancelled bookings are not counted.',
    ].forEach(line => summary.addRow([line]));
    if (report.roomsWithoutRate.length) {
        summary.addRow([]);
        const warn = summary.addRow([`Price not set for: ${report.roomsWithoutRate.join(', ')}. These hours are valued at 0.`]);
        warn.font = { bold: true, color: { argb: 'FFB45309' } };
    }

    // Client revenue
    const clientWs = wb.addWorksheet(sheetName('Client Revenue', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    clientWs.columns = [
        { width: 32 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 12 },
        { width: 13 }, { width: 13 }, { width: 14 }, { width: 16 }, { width: 20 }, { width: 16 },
    ];
    styleHeader(clientWs.addRow([
        'Client', 'Type', 'Monthly Credits (Hrs)', 'Bookings', 'Hours Booked', 'Credit Hrs',
        'Exceeded Hrs', 'Internal Hrs', 'Unused Credit Hrs', 'Credit Value (₹)', 'Exceeded Revenue (₹)', 'Total Value (₹)',
    ]));
    report.clients.forEach(c => {
        const row = clientWs.addRow([
            safeText(c.name), typeLabel(c),
            c.category === 'internal' ? 'n/a' : c.hasCreditPlan ? c.monthlyCreditHours : 'No plan',
            c.bookingCount, c.bookedHours, c.creditHours, c.exceededHours, c.internalHours, c.unusedCreditHours,
            c.creditValue, c.exceededRevenue, c.totalValue,
        ]);
        formatCells(row, [10, 11, 12], [5, 6, 7, 8, 9]);
        if (c.hasCreditPlan) row.getCell(3).numFmt = HRS_FMT;
    });
    const clientTotal = clientWs.addRow([
        'TOTAL', '', '', report.clients.reduce((s, c) => s + c.bookingCount, 0),
        t.bookedHours, t.creditHours, t.exceededHours, t.internalHours,
        report.clients.reduce((s, c) => s + c.unusedCreditHours, 0),
        t.creditValue, t.exceededRevenue, t.totalValue,
    ]);
    formatCells(clientTotal, [10, 11, 12], [5, 6, 7, 8, 9]);
    styleTotal(clientTotal);

    // Room revenue
    const roomWs = wb.addWorksheet(sheetName('Room Revenue', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    roomWs.columns = [
        { width: 28 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 13 },
        { width: 14 }, { width: 16 }, { width: 20 }, { width: 16 },
    ];
    styleHeader(roomWs.addRow([
        'Meeting Room', 'Rate / Hr (₹)', 'Bookings', 'Hours Booked', 'Credit Hrs', 'Exceeded Hrs',
        'Internal Hrs', 'Credit Value (₹)', 'Exceeded Revenue (₹)', 'Total Value (₹)',
    ]));
    report.rooms.forEach(r => {
        const row = roomWs.addRow([
            safeText(r.roomName), r.rateSet ? r.hourlyRate : 'Not set', r.bookingCount, r.bookedHours, r.creditHours,
            r.exceededHours, r.internalHours, r.creditValue, r.exceededRevenue, r.totalValue,
        ]);
        formatCells(row, [8, 9, 10], [4, 5, 6, 7]);
        if (r.rateSet) row.getCell(2).numFmt = INR_FMT;
    });
    const roomTotal = roomWs.addRow([
        'TOTAL', '', report.rooms.reduce((s, r) => s + r.bookingCount, 0),
        t.bookedHours, t.creditHours, t.exceededHours, t.internalHours,
        t.creditValue, t.exceededRevenue, t.totalValue,
    ]);
    formatCells(roomTotal, [8, 9, 10], [4, 5, 6, 7]);
    styleTotal(roomTotal);

    // All bookings
    const detailWs = wb.addWorksheet(sheetName('All Bookings', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    detailWs.columns = [
        { width: 30 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 24 }, { width: 22 },
        { width: 28 }, { width: 8 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 15 }, { width: 18 }, { width: 15 }
    ];
    styleHeader(detailWs.addRow(['Client', ...BOOKING_HEADERS]));
    report.clients.forEach(c => c.bookings.forEach(b =>
        addBookingRow(detailWs, b, c.category === 'internal' ? `${c.name} (internal, no charge)` : c.name)));

    // One sheet per client, ready to share with that client. Internal people get none.
    report.clients.filter(c => c.category === 'client').forEach(c => {
        const ws = wb.addWorksheet(sheetName(c.name, used));
        ws.columns = [
            { width: 12 }, { width: 8 }, { width: 8 }, { width: 24 }, { width: 22 },
            { width: 28 }, { width: 8 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 15 }, { width: 18 }, { width: 15 }
        ];
        const head = ws.addRow([safeText(`${c.name} | Meeting Room Usage | ${label}`)]);
        head.font = { bold: true, size: 12, color: { argb: BRAND } };
        ws.addRow([
            c.hasCreditPlan
                ? `Monthly credits: ${c.monthlyCreditHours} hrs | Used: ${c.creditHours} hrs | Exceeded: ${c.exceededHours} hrs`
                : `No credit plan | All ${c.exceededHours} hrs are billable`,
        ]);
        ws.addRow([]);
        styleHeader(ws.addRow(BOOKING_HEADERS));
        c.bookings.forEach(b => addBookingRow(ws, b));
        const total = ws.addRow(['TOTAL', '', '', '', '', '', c.bookedHours, '', c.creditHours, c.exceededHours,
            c.creditValue, c.exceededRevenue, c.totalValue]);
        formatCells(total, [11, 12, 13], [7, 9, 10]);
        styleTotal(total);
    });

    return wb.xlsx.writeBuffer();
}
