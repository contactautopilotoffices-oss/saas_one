import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';
import {
    loadAlertRows,
    computeDiscountPerformance,
    n,
    type AlertRow,
    type DiscountFigures,
} from './tracker';

/**
 * Monthly electricity report → PDF (Phase 5 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 * The tracker tab is the working screen — interactive, urgent-first, something the ops
 * team acts on. This is the read-only monthly pack you forward to an ops_super_admin or
 * attach to a review: one month of the register, what the validation engine made of it,
 * what is still disputed, and whether the early-payment discount was captured or lost.
 *
 * Rendering follows backend/lib/council/auditPdf.ts exactly: HTML printed through
 * headless Chromium (puppeteer, lazy-imported), every interpolation escaped via esc(),
 * house palette #708F96, Poppins display / Urbanist body. See that file for why we do
 * not hand-assemble PDF primitives.
 *
 * Degradation contract: the newer automation tables (validations, disputes, chase tasks,
 * reliability events) may not be provisioned in every environment yet. A missing
 * relation marks that SECTION unavailable and says so on the page — it never fails the
 * report. Only electricity_bills itself is load-bearing.
 */

export interface ReportBillRow {
    id: string;
    billing_month: string;
    bill_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    early_payment_date: string | null;
    early_payment_amount: number | null;
    after_due_date_amount: number | null;
    payment_status: string;
    payment_date: string | null;
    workflow_status: string | null;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
}

export interface ReportValidationRow {
    bill_id: string;
    run_at: string;
    result: string;
    billed_units: number | null;
    logged_units: number | null;
    variance_pct: number | null;
    tolerance_pct: number;
    missing_dates: string[] | null;
    readings_counted: number | null;
    readings_excluded: number | null;
    checked_by: string | null;
    checked_at: string | null;
}

export interface ReportDisputeRow {
    id: string;
    bill_id: string;
    raised_at: string;
    reason: string;
    status: string;
    assigned_property_admin: string | null;
}

/** Chase/reliability schemas belong to the chase engine (Phase 3) and are deliberately
 *  read as open records here — the report renders whatever columns exist, so a schema
 *  change there never breaks the monthly pack. */
export type GenericRow = Record<string, unknown>;

export interface MonthlyReportData {
    provisioned: boolean;
    orgName: string;
    /** YYYY-MM the report covers. */
    month: string;
    bills: ReportBillRow[];
    /** Latest validation run per bill. */
    validations: ReportValidationRow[];
    disputes: ReportDisputeRow[];
    discount: DiscountFigures;
    chaseTasks: GenericRow[];
    reliabilityEvents: GenericRow[];
    /** Section names whose tables are not provisioned yet — shown on the page. */
    unavailable: string[];
}

const BRAND = '#708F96';

function esc(v: unknown): string {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const fmtDate = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
        });
    } catch { return String(iso); }
};

const fmtMoney = (v: number | null | undefined): string =>
    v === null || v === undefined ? '—' : `₹${Math.round(n(v)).toLocaleString('en-IN')}`;

const monthLabel = (month: string): string =>
    new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', {
        month: 'long', year: 'numeric', timeZone: 'UTC',
    });

// ---------------------------------------------------------------------------
// Loader — every section degrades independently.
// ---------------------------------------------------------------------------

export async function loadMonthlyReportData(
    organizationId: string,
    month: string,   // YYYY-MM
): Promise<MonthlyReportData> {
    const monthStart = `${month}-01`;
    const next = new Date(`${monthStart}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextMonthStart = next.toISOString().slice(0, 10);

    const unavailable: string[] = [];

    const orgRes = await supabaseAdmin
        .from('organizations').select('name').eq('id', organizationId).maybeSingle();
    const orgName = (orgRes.data as { name?: string } | null)?.name || 'Organization';

    // The register — bills for the month joined to their account's identity. A missing
    // relation here means the module is not provisioned at all; there is no report.
    const billsRes = await supabaseAdmin
        .from('electricity_bills')
        .select('*, electricity_billing_accounts(site_label, provider, consumer_ref)')
        .eq('organization_id', organizationId)
        .eq('billing_month', monthStart)
        .order('bill_date', { ascending: true })
        .range(0, 4999);

    if (billsRes.error) {
        if (isMissingRelation(billsRes.error)) {
            return {
                provisioned: false, orgName, month,
                bills: [], validations: [], disputes: [],
                discount: { available: 0, captured: 0, missed: 0, unverifiable: 0 },
                chaseTasks: [], reliabilityEvents: [], unavailable: ['all'],
            };
        }
        throw new Error(billsRes.error.message);
    }

    const bills: ReportBillRow[] = (billsRes.data || []).map((row: any) => {
        const account = row.electricity_billing_accounts || {};
        return {
            id: row.id,
            billing_month: row.billing_month,
            bill_date: row.bill_date,
            due_date: row.due_date,
            total_amount: row.total_amount,
            early_payment_date: row.early_payment_date,
            early_payment_amount: row.early_payment_amount,
            after_due_date_amount: row.after_due_date_amount,
            payment_status: row.payment_status,
            payment_date: row.payment_date,
            workflow_status: row.workflow_status ?? null,
            site_label: account.site_label || '—',
            provider: account.provider || '—',
            consumer_ref: account.consumer_ref ?? null,
        };
    });

    // Latest validation run per bill — the checker reviews outcomes, not history.
    let validations: ReportValidationRow[] = [];
    if (bills.length) {
        const valRes = await supabaseAdmin
            .from('electricity_bill_validations')
            .select('bill_id, run_at, result, billed_units, logged_units, variance_pct, tolerance_pct, missing_dates, readings_counted, readings_excluded, checked_by, checked_at')
            .in('bill_id', bills.map(b => b.id))
            .order('run_at', { ascending: false })
            .range(0, 4999);
        if (valRes.error) {
            if (!isMissingRelation(valRes.error)) throw new Error(valRes.error.message);
            unavailable.push('validation results');
        } else {
            const seen = new Set<string>();
            for (const v of (valRes.data || []) as ReportValidationRow[]) {
                if (seen.has(v.bill_id)) continue;
                seen.add(v.bill_id);
                validations.push(v);
            }
        }
    }

    // Open disputes are org-scoped, not month-scoped: a dispute raised late last month
    // is still this month's problem.
    let disputes: ReportDisputeRow[] = [];
    const dispRes = await supabaseAdmin
        .from('electricity_disputes')
        .select('id, bill_id, raised_at, reason, status, assigned_property_admin')
        .eq('organization_id', organizationId)
        .in('status', ['open', 'responded'])
        .order('raised_at', { ascending: false })
        .range(0, 4999);
    if (dispRes.error) {
        if (!isMissingRelation(dispRes.error)) throw new Error(dispRes.error.message);
        unavailable.push('open disputes');
    } else {
        disputes = (dispRes.data || []) as ReportDisputeRow[];
    }

    // Discount performance reuses the tracker's own maths over the alerts view, filtered
    // to this month — the PDF and the screen can never disagree about what was captured.
    let discount: DiscountFigures = { available: 0, captured: 0, missed: 0, unverifiable: 0 };
    const alerts = await loadAlertRows(organizationId);
    if (alerts.provisioned) {
        const monthRows = (alerts.data as AlertRow[]).filter(r => r.billing_month === monthStart);
        discount = computeDiscountPerformance(monthRows).totals;
    } else {
        unavailable.push('discount performance');
    }

    // Chase tasks + reliability events belong to the 3-touch engine (Phase 3), which may
    // not be provisioned here. Read them as open records scoped to the month; any error
    // marks the section unavailable rather than failing the report.
    let chaseTasks: GenericRow[] = [];
    const chaseRes = await supabaseAdmin
        .from('electricity_chase_tasks')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', monthStart)
        .lt('created_at', nextMonthStart)
        .range(0, 4999);
    if (chaseRes.error) unavailable.push('chase activity');
    else chaseTasks = (chaseRes.data || []) as GenericRow[];

    let reliabilityEvents: GenericRow[] = [];
    const relRes = await supabaseAdmin
        .from('employee_reliability_events')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', monthStart)
        .lt('created_at', nextMonthStart)
        .range(0, 4999);
    if (relRes.error) unavailable.push('reliability events');
    else reliabilityEvents = (relRes.data || []) as GenericRow[];

    return {
        provisioned: true, orgName, month,
        bills, validations, disputes, discount, chaseTasks, reliabilityEvents, unavailable,
    };
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const VALIDATION_STYLE: Record<string, { fg: string; bg: string; label: string }> = {
    pass:            { fg: '#047857', bg: '#D1FAE5', label: 'Pass' },
    variance:        { fg: '#B45309', bg: '#FEF3C7', label: 'Variance' },
    incomplete_data: { fg: '#1D4ED8', bg: '#DBEAFE', label: 'Incomplete data' },
    no_meter_link:   { fg: '#374151', bg: '#F3F4F6', label: 'No meter link' },
};

const DISPUTE_STYLE: Record<string, { fg: string; bg: string }> = {
    open:      { fg: '#B91C1C', bg: '#FEE2E2' },
    responded: { fg: '#B45309', bg: '#FEF3C7' },
};

/** Small generic table for the open-schema sections — columns are the union of keys
 *  actually present, capped so an unexpected fat column cannot wreck the layout. */
function genericTable(rows: GenericRow[], preferred: string[]): string {
    if (!rows.length) return '<p><em>None recorded this month.</em></p>';
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const cols = [
        ...preferred.filter(k => keys.includes(k)),
        ...keys.filter(k => !preferred.includes(k)),
    ].slice(0, 6);
    const cell = (v: unknown): string => {
        if (v === null || v === undefined) return '—';
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return esc(s.length > 80 ? `${s.slice(0, 77)}…` : s);
    };
    return `<table class="data"><thead><tr>${cols.map(c => `<th>${esc(c.replace(/_/g, ' '))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${cell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function buildHtml(data: MonthlyReportData): string {
    const { orgName, month, bills, validations, disputes, discount, chaseTasks, reliabilityEvents, unavailable } = data;

    const totalBilled = bills.reduce((s, b) => s + n(b.total_amount), 0);
    const paid = bills.filter(b => b.payment_status === 'paid').length;
    const validationByBill = new Map(validations.map(v => [v.bill_id, v]));
    const variances = validations.filter(v => v.result === 'variance');
    const unavailableNote = unavailable.length
        ? `<p class="sub">Sections unavailable because their tables are not provisioned in this environment: ${esc(unavailable.join(', '))}.</p>`
        : '';

    const registerRows = bills.map(b => {
        const v = validationByBill.get(b.id);
        const vs = v ? (VALIDATION_STYLE[v.result] || VALIDATION_STYLE.no_meter_link) : null;
        return `<tr>
          <td>${esc(b.site_label)}</td>
          <td>${esc(b.provider)}</td>
          <td>${esc(b.consumer_ref || '—')}</td>
          <td>${esc(fmtDate(b.bill_date))}</td>
          <td>${esc(fmtDate(b.due_date))}</td>
          <td class="num">${fmtMoney(b.total_amount)}</td>
          <td class="num">${fmtMoney(b.early_payment_amount)}</td>
          <td>${esc(b.workflow_status || '—')}</td>
          <td>${esc(b.payment_status)}${b.payment_date ? ` · ${esc(fmtDate(b.payment_date))}` : ''}</td>
          <td>${vs ? `<span class="chip" style="color:${vs.fg};background:${vs.bg}">${esc(vs.label)}</span>` : '—'}</td>
        </tr>`;
    }).join('');

    const varianceRows = variances.map(v => {
        const bill = bills.find(b => b.id === v.bill_id);
        return `<tr>
          <td>${esc(bill?.site_label || v.bill_id)}</td>
          <td class="num">${v.billed_units ?? '—'}</td>
          <td class="num">${v.logged_units ?? '—'}</td>
          <td class="num">${v.variance_pct ?? '—'}%</td>
          <td class="num">±${esc(v.tolerance_pct)}%</td>
          <td>${v.checked_at ? `Signed off ${esc(fmtDate(v.checked_at))}` : 'Awaiting checker'}</td>
        </tr>`;
    }).join('');

    const disputeRows = disputes.map(d => {
        const ds = DISPUTE_STYLE[d.status] || { fg: '#374151', bg: '#F3F4F6' };
        return `<tr>
          <td><span class="chip" style="color:${ds.fg};background:${ds.bg}">${esc(d.status)}</span></td>
          <td>${esc(fmtDate(d.raised_at))}</td>
          <td>${esc(d.reason)}</td>
          <td>${d.assigned_property_admin ? 'Assigned' : 'Unassigned'}</td>
        </tr>`;
    }).join('');

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Electricity monthly report — ${esc(monthLabel(month))}</title>
<style>
  @page { size: A4 landscape; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Urbanist, "Helvetica Neue", Arial, sans-serif; color:#1F2937; font-size:9.5pt; line-height:1.5; margin:0; }
  h1,h2,h3 { font-family: Poppins, Urbanist, sans-serif; color:#111827; line-height:1.25; }
  h1 { font-size:20pt; margin:0 0 4pt; letter-spacing:-.4pt; }
  h2 { font-size:12.5pt; margin:16pt 0 6pt; padding-bottom:4pt; border-bottom:1.5pt solid ${BRAND}; }
  p { margin:.4em 0; }

  .cover { border-left:4pt solid ${BRAND}; padding-left:12pt; margin-bottom:12pt; }
  .eyebrow { text-transform:uppercase; letter-spacing:1.4pt; font-size:7.5pt; color:${BRAND}; font-weight:700; margin:0 0 2pt; }
  .sub { color:#6B7280; font-size:8.5pt; margin:2pt 0 0; }

  .tally { display:flex; gap:6pt; margin:10pt 0 0; flex-wrap:wrap; }
  .tally span { font-weight:700; font-size:8.5pt; padding:3pt 9pt; border-radius:99pt; background:#F3F4F6; color:#374151; }
  .tally .good { color:#047857; background:#D1FAE5; }
  .tally .bad { color:#B91C1C; background:#FEE2E2; }
  .tally .warn { color:#B45309; background:#FEF3C7; }

  table.data { width:100%; border-collapse:collapse; margin:8pt 0; font-size:8.5pt; }
  .data th { background:#F3F4F6; text-align:left; padding:4pt 6pt; border:.5pt solid #E5E7EB; font-size:7.5pt; text-transform:uppercase; letter-spacing:.5pt; }
  .data td { padding:4pt 6pt; border:.5pt solid #E5E7EB; }
  .data td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .data tr { page-break-inside:avoid; }

  .chip { font-weight:700; font-size:7.5pt; padding:1.5pt 6pt; border-radius:3pt; letter-spacing:.3pt; white-space:nowrap; }

  footer { position:fixed; bottom:-10mm; left:0; right:0; font-size:7.5pt; color:#9CA3AF; }
</style></head>
<body>
  <div class="cover">
    <p class="eyebrow">${esc(orgName)} · Electricity</p>
    <h1>Monthly report — ${esc(monthLabel(month))}</h1>
    <p class="sub">${esc(bills.length)} bills on file · ${esc(paid)} paid · ${fmtMoney(totalBilled)} billed</p>
    <div class="tally">
      <span>Discount available · ${fmtMoney(discount.available)}</span>
      <span class="good">Captured · ${fmtMoney(discount.captured)}</span>
      <span class="bad">Missed · ${fmtMoney(discount.missed)}</span>
      <span class="warn">Unverifiable · ${fmtMoney(discount.unverifiable)}</span>
      <span class="${variances.length ? 'warn' : ''}">Variances · ${esc(variances.length)}</span>
      <span class="${disputes.length ? 'bad' : ''}">Open disputes · ${esc(disputes.length)}</span>
    </div>
    ${unavailableNote}
  </div>

  <h2>Bill register</h2>
  ${bills.length ? `<table class="data"><thead><tr>
      <th>Site</th><th>Provider</th><th>Consumer ref</th><th>Bill date</th><th>Due date</th>
      <th>Total</th><th>Early-pay</th><th>Workflow</th><th>Payment</th><th>Validation</th>
    </tr></thead><tbody>${registerRows}</tbody></table>`
    : '<p><em>No bills on file for this month.</em></p>'}

  <h2>Variances</h2>
  <p class="sub">Bills where billed kWh diverged from logged meter kWh beyond the tolerance band.</p>
  ${variances.length ? `<table class="data"><thead><tr>
      <th>Site</th><th>Billed kWh</th><th>Logged kWh</th><th>Variance</th><th>Tolerance</th><th>Checker</th>
    </tr></thead><tbody>${varianceRows}</tbody></table>`
    : '<p><em>No out-of-tolerance variances this month.</em></p>'}

  <h2>Open disputes</h2>
  ${disputes.length ? `<table class="data"><thead><tr>
      <th>Status</th><th>Raised</th><th>Reason</th><th>Property admin</th>
    </tr></thead><tbody>${disputeRows}</tbody></table>`
    : '<p><em>No open disputes.</em></p>'}

  <h2>Discount performance</h2>
  <p class="sub">Available = the gap between the due-date amount and the early-payment amount on
  bills that offered one. Captured = paid on or before the early-payment date. Missed = paid after
  it. Unverifiable = marked paid with no payment date recorded — the argument for logging dates at all.</p>
  <table class="data"><thead><tr>
      <th>Available</th><th>Captured</th><th>Missed</th><th>Unverifiable</th><th>Capture rate</th>
  </tr></thead><tbody><tr>
      <td class="num">${fmtMoney(discount.available)}</td>
      <td class="num">${fmtMoney(discount.captured)}</td>
      <td class="num">${fmtMoney(discount.missed)}</td>
      <td class="num">${fmtMoney(discount.unverifiable)}</td>
      <td class="num">${discount.available > 0 ? `${Math.round((discount.captured / discount.available) * 1000) / 10}%` : '—'}</td>
  </tr></tbody></table>

  <h2>Chase activity</h2>
  ${genericTable(chaseTasks, ['created_at', 'bill_id', 'touch', 'channel', 'status', 'outcome'])}

  <h2>Reliability events</h2>
  ${genericTable(reliabilityEvents, ['created_at', 'user_id', 'employee_id', 'event_type', 'severity', 'note'])}
</body></html>`;
}

/**
 * Render the monthly report to a PDF buffer. Throws on launch/render failure — the
 * caller reports it rather than returning a corrupt download.
 */
export async function buildElectricityMonthlyReportPdf(data: MonthlyReportData): Promise<Buffer> {
    // Imported lazily: puppeteer pulls in a browser binary and must not be loaded by
    // every route that happens to import this module's types.
    const puppeteer = (await import('puppeteer')).default;

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(buildHtml(data), { waitUntil: 'load', timeout: 30_000 });
        const pdf = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate:
                `<div style="width:100%;font-size:7.5pt;color:#9CA3AF;padding:0 14mm;`
                + `font-family:Arial,sans-serif;display:flex;justify-content:space-between">`
                + `<span>${esc(data.orgName)} · Electricity monthly report — generated, not hand-written</span>`
                + `<span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
            margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
        });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

/** Exposed for tests/preview without spawning Chromium. */
export const _buildHtmlForTest = buildHtml;
