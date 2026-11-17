import { REPORT_FONT_CSS, REPORT_LOGO_DATA_URI } from './reportAssets';
import type { DepartmentRow, DepartmentWorkItem, Kpi, PersonRow, Tone, TrendPoint, UsageReport } from './types';

/**
 * Task Manager Usage Report: UsageReport → the HTML that renderPdf.ts prints to A4.
 *
 * Same approach as backend/lib/council/auditPdf.ts and backend/lib/electricity/monthlyReportPdf.ts: plain HTML printed by
 * Chromium, every interpolation through esc(). Task titles and names are free text, so they are clipped first and escaped
 * after (clip() must see the raw string or it could cut an entity in half). Charts are inline SVG strings; no library.
 *
 * Fonts and the logo are embedded by reportAssets.ts because a serverless host has neither on disk. Only Poppins 500, 600
 * and 700 and Urbanist 400 to 700 are embedded, so do not ask for a lighter weight here.
 *
 * Layout: pages come from `.page { break-before: page }` and content flows inside, so any number of departments or people
 * still paginates. The department thresholds in the scorecard legend restate departmentTone() in metrics.ts.
 */

const INK = '#1A2332';       // the base of --text-primary
const BODY = '#3D4756';
const MUTED = '#5F6B7A';
const FAINT = '#8793A1';
const LINE = '#E2E8F0';      // --border
const LINE_SOFT = '#F1F5F9'; // --border-subtle
const WASH = '#F8FAFC';      // --surface-elevated
const BRAND = '#708F96';     // --primary
const BRAND_DARK = '#5A737A';// --primary-dark
const ACCENT = '#AA895F';    // --secondary
const ACCENT_DARK = '#8F7350';

const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Colour never carries the meaning alone: every tone has a word and a shape, so it reads in greyscale. */
const TONES: Record<Tone, { fg: string; bg: string; label: string }> = {
    good: { fg: '#047857', bg: '#E7F7F0', label: 'On track' },
    warn: { fg: '#B45309', bg: '#FEF3C7', label: 'Watch' },
    bad: { fg: '#B91C1C', bg: '#FEE2E2', label: 'Attention' },
    neutral: { fg: MUTED, bg: LINE_SOFT, label: 'No rating' },
};

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Emoji and invisible joiners, which real task titles contain. Vercel's Chromium has no emoji font, so they would print as
 * empty boxes. The copyright, registered and trademark signs count as pictographic too, but the embedded fonts have them.
 */
const UNPRINTABLE = /(?![©®™])\p{Extended_Pictographic}|[️‍⁠]/gu;

function esc(v: unknown): string {
    return String(v ?? '')
        .replace(UNPRINTABLE, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Cuts by whole characters. Use on the raw value, before esc(). Text that was only emoji shows as a dash, not a blank. */
function clip(v: unknown, max: number): string {
    const chars = Array.from(String(v ?? '').replace(UNPRINTABLE, '').replace(/\s+/g, ' ').trim());
    if (!chars.length) return '—';
    return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: number | null | undefined): string => (finite(v) ? v.toLocaleString('en-IN') : '—');
const pctText = (v: number | null | undefined): string => (finite(v) ? `${v}%` : '—');
const share = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;
const round1 = (v: number): string => String(Math.round(v * 10) / 10);

function day(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}` : '—';
}

/** The IST calendar day of an instant. */
function istDay(ts: string): string {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? '—' : day(new Date(t + IST_OFFSET_MS).toISOString());
}

const dayRange = (from: string, to: string): string => (from === to ? day(from) : `${day(from)} to ${day(to)}`);

function durationText(hours: number | null): string {
    if (!finite(hours)) return '—';
    if (hours >= 48) return `${round1(hours / 24)} days`;
    const shown = hours < 10 ? round1(hours) : String(Math.round(hours));
    return `${shown} ${shown === '1' ? 'hour' : 'hours'}`;
}

function ageText(days: number | null): string {
    if (!finite(days)) return '—';
    return days < 1 ? 'Under 1 day' : plural(days, 'day');
}

// ── Small pieces ────────────────────────────────────────────────────────────

function mark(tone: Tone): string {
    const c = TONES[tone].fg;
    const shape = tone === 'good' ? `<circle cx="4" cy="4" r="3.2" fill="${c}"/>`
        : tone === 'warn' ? `<path d="M4 .4 7.6 4 4 7.6.4 4Z" fill="${c}"/>`
            : tone === 'bad' ? `<path d="M4 .6 7.8 7.4H.2Z" fill="${c}"/>`
                : `<circle cx="4" cy="4" r="2.6" fill="none" stroke="${c}" stroke-width="1.2"/>`;
    return `<svg class="mark" viewBox="0 0 8 8" aria-hidden="true">${shape}</svg>`;
}

const chip = (tone: Tone): string =>
    `<span class="chip" style="color:${TONES[tone].fg};background:${TONES[tone].bg}">${mark(tone)}${esc(TONES[tone].label)}</span>`;

/** Bars are empty for a zero, never a sliver that reads as "a little". */
function barRows(rows: { label: string; value: number; right?: string }[]): string {
    const max = Math.max(1, ...rows.map(r => (finite(r.value) ? r.value : 0)));
    return `<div class="bars">${rows.map(r => {
        const width = finite(r.value) ? Math.round((r.value / max) * 1000) / 10 : 0;
        return `<div class="bar-row"><span class="bar-label">${esc(r.label)}</span><span class="bar-track"><i style="width:${width}%"></i></span><span class="bar-value">${esc(r.right ?? num(r.value))}</span></div>`;
    }).join('')}</div>`;
}

function statRow(stats: { label: string; value: string; note?: string }[]): string {
    return `<div class="stats" style="grid-template-columns:repeat(${stats.length},1fr)">${stats.map(s =>
        `<div class="stat"><div class="label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div>${s.note ? `<div class="stat-note">${esc(s.note)}</div>` : ''}</div>`,
    ).join('')}</div>`;
}

const block = (title: string, caption: string, body: string, cls = ''): string =>
    `<section class="block ${cls}"><h3>${esc(title)}</h3>${caption ? `<p class="caption">${esc(caption)}</p>` : ''}${body}</section>`;

const emptyNote = (text: string): string => `<p class="empty">${esc(text)}</p>`;

function page(title: string, standfirst: string, r: UsageReport, body: string): string {
    return `<section class="page">
  <header class="sec-head">
    <div class="sec-rail"><span>${esc(clip(r.orgName, 60))}</span><span>${esc(dayRange(r.period.from, r.period.to))}</span></div>
    <h2>${esc(title)}</h2>
    <p class="stand">${esc(standfirst)}</p>
  </header>
  ${body}
</section>`;
}

// ── Charts ──────────────────────────────────────────────────────────────────

/** 182mm of A4 content at 96dpi, so one SVG unit prints as one CSS pixel and chart type matches the page. */
const CHART_W = 688;

interface Series { key: 'active' | 'created' | 'completed'; color: string; dash?: string; width: number; hollow?: boolean; area?: boolean }

function niceScale(peak: number): { top: number; step: number } {
    if (!(peak > 0)) return { top: 1, step: 1 };
    const rough = peak / 3;
    const power = 10 ** Math.floor(Math.log10(rough));
    const scaled = rough / power;
    const step = Math.max(1, (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power);
    return { top: Math.ceil(peak / step) * step, step };
}

/** Ticks on a fixed stride, so a weekly axis keeps an even rhythm. The last point joins them only if it has room. */
function tickIndexes(count: number, most: number): number[] {
    if (count <= most) return Array.from({ length: count }, (_, i) => i);
    const stride = Math.ceil((count - 1) / (most - 1));
    const ticks: number[] = [];
    for (let i = 0; i < count; i += stride) ticks.push(i);
    if (count - 1 - ticks[ticks.length - 1] >= stride / 2) ticks.push(count - 1);
    return ticks;
}

function lineChart(points: TrendPoint[], series: Series[], height: number, showDates: boolean): string {
    const left = 30, right = 10, top = 8, bottom = showDates ? 20 : 6;
    const plotW = CHART_W - left - right;
    const plotH = height - top - bottom;
    const count = points.length;
    const { top: yTop, step } = niceScale(Math.max(0, ...points.flatMap(p => series.map(s => p[s.key]))));
    const x = (i: number) => (count === 1 ? left + plotW / 2 : left + (i * plotW) / (count - 1));
    const y = (v: number) => top + plotH - (v / yTop) * plotH;
    const parts: string[] = [];

    for (let v = 0; v <= yTop; v += step) {
        parts.push(`<line x1="${left}" x2="${CHART_W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${v === 0 ? FAINT : LINE}" stroke-width="${v === 0 ? 0.75 : 0.5}"/>`);
        parts.push(`<text class="tick" x="${left - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${esc(num(v))}</text>`);
    }
    if (showDates) {
        for (const i of tickIndexes(count, 8)) {
            const anchor = count === 1 ? 'middle' : i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle';
            parts.push(`<text class="tick" x="${x(i).toFixed(1)}" y="${height - 5}" text-anchor="${anchor}">${esc(points[i].label)}</text>`);
        }
    }
    for (const s of series) {
        const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(' ');
        if (s.area && count > 1) parts.push(`<polygon points="${x(0).toFixed(1)},${y(0).toFixed(1)} ${path} ${x(count - 1).toFixed(1)},${y(0).toFixed(1)}" fill="${s.color}" fill-opacity=".1"/>`);
        if (count > 1) parts.push(`<polyline points="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
        // Points stay readable up to a month of days; a year of weeks would turn them into a solid band.
        if (count <= 16) {
            points.forEach((p, i) => {
                parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(p[s.key]).toFixed(1)}" r="2.6" fill="${s.hollow ? '#FFFFFF' : s.color}" stroke="${s.hollow ? s.color : '#FFFFFF'}" stroke-width="${s.hollow ? 1.25 : 0.75}"/>`);
            });
        }
    }
    return `<svg class="chart" viewBox="0 0 ${CHART_W} ${height}" role="img" aria-hidden="true">${parts.join('')}</svg>`;
}

function swatch(color: string, dash?: string): string {
    return `<svg class="swatch" viewBox="0 0 18 6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
}

const heatPeak = (rows: number[][]): number => Math.max(0, ...rows.flat().filter(finite));

/** Square root: one busy block should not wash every other cell out to nothing. */
function heatTint(value: number, max: number): { fill: string; level: number } {
    const level = max ? Math.sqrt(value / max) : 0;
    const light = [221, 231, 234], dark = [72, 98, 106];
    return { level, fill: `rgb(${light.map((from, i) => Math.round(from + (dark[i] - from) * level)).join(',')})` };
}

function heatmap(rows: number[][]): string {
    const gutter = 34, head = 16, cellH = 23, gap = 2;
    const cellW = (CHART_W - gutter) / 12;
    const max = heatPeak(rows);
    const parts: string[] = [];
    for (let c = 0; c < 12; c++) {
        const start = String(c * 2).padStart(2, '0');
        parts.push(`<text class="tick" x="${(gutter + c * cellW + (cellW - gap) / 2).toFixed(1)}" y="10" text-anchor="middle">${start}:00</text>`);
    }
    for (let r = 0; r < 7; r++) {
        const rowY = head + r * cellH;
        parts.push(`<text class="tick" x="0" y="${rowY + 14}">${esc(WEEKDAYS[r].slice(0, 3))}</text>`);
        for (let c = 0; c < 12; c++) {
            const raw = rows[r]?.[c];
            const value = finite(raw) ? raw : 0;
            const { fill, level } = heatTint(value, max);
            parts.push(`<rect x="${(gutter + c * cellW).toFixed(1)}" y="${rowY}" width="${(cellW - gap).toFixed(1)}" height="${cellH - gap}" fill="${value ? fill : WASH}"/>`);
            if (value) parts.push(`<text class="cell" x="${(gutter + c * cellW + (cellW - gap) / 2).toFixed(1)}" y="${rowY + 14}" text-anchor="middle" fill="${level > 0.55 ? '#FFFFFF' : INK}">${esc(num(value))}</text>`);
        }
    }
    return `<svg class="chart" viewBox="0 0 ${CHART_W} ${head + 7 * cellH}" role="img" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Filled circle for adoption, hollow diamond for completion: two shapes, so it survives a greyscale printer. */
function departmentPlot(departments: DepartmentRow[]): string {
    const nameW = 150, rowH = departments.length <= 8 ? 26 : departments.length <= 10 ? 19 : 15, top = 16, right = 10;
    const plotW = CHART_W - nameW - right;
    const x = (v: number) => nameW + (v / 100) * plotW;
    const parts: string[] = [];
    for (const v of [0, 25, 50, 75, 100]) {
        parts.push(`<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${top + departments.length * rowH}" stroke="${LINE}" stroke-width=".5"/>`);
        parts.push(`<text class="tick" x="${x(v)}" y="10" text-anchor="${v === 100 ? 'end' : v === 0 ? 'start' : 'middle'}">${v}%</text>`);
    }
    departments.forEach((d, i) => {
        const cy = top + i * rowH + rowH / 2;
        parts.push(`<text class="row" x="0" y="${cy + 3.5}">${esc(clip(d.name, 30))}</text>`);
        const a = finite(d.adoptionPct) ? d.adoptionPct : null;
        const c = finite(d.completionPct) ? d.completionPct : null;
        if (a !== null && c !== null) parts.push(`<line x1="${x(a)}" x2="${x(c)}" y1="${cy}" y2="${cy}" stroke="${FAINT}" stroke-width="1"/>`);
        if (c !== null) parts.push(`<path d="M${x(c)} ${cy - 5}l5 5-5 5-5-5Z" fill="#FFFFFF" stroke="${ACCENT_DARK}" stroke-width="1.5"/>`);
        if (a !== null) parts.push(`<circle cx="${x(a)}" cy="${cy}" r="4.5" fill="${BRAND_DARK}"/>`);
    });
    return `<svg class="chart" viewBox="0 0 ${CHART_W} ${top + departments.length * rowH + 2}" role="img" aria-hidden="true">${parts.join('')}</svg>`;
}

// ── Sections ────────────────────────────────────────────────────────────────

/** The cover's one graphic is this period's real week: the heatmap with its labels taken away. */
function coverField(rows: number[][]): string {
    const max = heatPeak(rows);
    if (!max) return '';
    const gap = 3;
    const size = (CHART_W - 11 * gap) / 12;
    const cells: string[] = [];
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 12; c++) {
            const raw = rows[r]?.[c];
            const value = finite(raw) ? raw : 0;
            cells.push(`<rect x="${(c * (size + gap)).toFixed(1)}" y="${(r * (size + gap)).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" fill="${value ? heatTint(value, max).fill : LINE_SOFT}"/>`);
        }
    }
    return `<div class="cover-field"><svg class="chart" viewBox="0 0 ${CHART_W} ${(7 * size + 6 * gap).toFixed(1)}" aria-hidden="true">${cells.join('')}</svg>
    <p class="caption">When this period’s work happened. Each square is a two-hour block of the week, Monday at the top. Darker means more activity.</p></div>`;
}

function cover(r: UsageReport): string {
    const meta: [string, string][] = [
        ['Period', `${plural(r.period.days, 'day')}`],
        ['Generated', istDay(r.generatedAt)],
        ['Departments', num(r.base.departments)],
        ['People', num(r.base.people)],
    ];
    return `<section class="cover">
  <div class="logo"><img src="${REPORT_LOGO_DATA_URI}" alt="Autopilot Offices"></div>
  ${coverField(r.engagement.heatmap)}
  <div class="cover-main">
    <div class="cover-tick"></div>
    <h1>Task Manager<br>Usage Report</h1>
    <p class="cover-org">${esc(clip(r.orgName, 90))}</p>
    <p class="cover-period">${esc(dayRange(r.period.from, r.period.to))}</p>
  </div>
  <dl class="cover-meta">${meta.map(([k, v]) => `<div><dt class="label">${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
</section>`;
}

function kpiTile(k: Kpi): string {
    // "11 of 14" sets the count large and the base small, so a four-digit base still fits a fifth of the page.
    const parts = /^(.+?) (of .+)$/.exec(k.display);
    const value = parts ? `${esc(parts[1])}<small> ${esc(parts[2])}</small>` : esc(k.display);
    const changeColor = k.changeTone === 'neutral' ? MUTED : TONES[k.changeTone].fg;
    const change = k.change === null
        ? `<span class="kpi-change" style="color:${FAINT}">No comparison</span>`
        : `<span class="kpi-change" style="color:${changeColor}">${esc(k.change)}</span>`;
    return `<div class="kpi">
    <div class="label">${esc(k.label)}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-detail">${esc(k.detail)}</div>
    <div class="kpi-foot">${change}${chip(k.tone)}</div>
  </div>`;
}

function departmentStatusLine(departments: DepartmentRow[]): string {
    const count = (t: Tone) => departments.filter(d => d.tone === t).length;
    return departments.length
        ? `${plural(count('good'), 'department')} on track, ${num(count('warn'))} to watch and ${num(count('bad'))} needing attention.`
        : 'No departments are switched on for the Task Manager.';
}

function summary(r: UsageReport): string {
    const compared = r.previousPeriod
        ? `Changes compare with ${dayRange(r.previousPeriod.from, r.previousPeriod.to)}.`
        : 'No comparison is shown for this period.';
    const steps = r.actions.slice(0, 3);
    return page('Executive summary', `${plural(r.period.days, 'day')} of Task Manager use across ${plural(r.base.departments, 'department')} and ${plural(r.base.people, 'person', 'people')}. ${compared}`, r, `
  <div class="kpis">${r.kpis.map(kpiTile).join('')}</div>
  <div class="summary-cols">
    ${block('What the period shows', '', r.takeaways.length
        ? `<ol class="ruled">${r.takeaways.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`
        : emptyNote('There is nothing to report for this period.'))}
    ${block('Recommended next', '', steps.length
        ? `<ol class="steps">${steps.map((t, i) => `<li><span>${i + 1}</span><p>${esc(t)}</p></li>`).join('')}</ol>`
        : emptyNote('No follow-up is needed from this period’s numbers.'), 'panel')}
  </div>
  <section class="block"><h3>Work in the period</h3>${statRow([
        { label: 'Created', value: num(r.execution.created) },
        { label: 'Completed', value: num(r.execution.completed) },
        { label: 'Open at end', value: num(r.execution.openAtEnd) },
        { label: 'Median time', value: durationText(r.execution.medianHoursToComplete) },
        { label: 'On time', value: pctText(r.execution.due.onTimePct) },
    ])}</section>
  ${block('Departments at a glance', departmentStatusLine(r.departments), r.departments.length
        ? `<div class="glance">${r.departments.slice(0, 12).map(d => `<div class="glance-item"><span class="glance-name">${esc(clip(d.name, 34))}</span>${chip(d.tone)}</div>`).join('')}</div>${r.departments.length > 12 ? `<p class="caption after">The full list of ${num(r.departments.length)} departments is in section 5.</p>` : ''}`
        : '')}`);
}

function funnel(r: UsageReport): string {
    const steps = r.adoption.funnel;
    if (!steps.length) return emptyNote('There is no one to count in this period.');
    const base = steps[0].count;
    const peak = Math.max(1, base);
    return `<div class="funnel">
    <div class="funnel-row funnel-head"><span></span><span></span><span>People</span><span>Of base</span><span>Of step above</span></div>
    ${steps.map((s, i) => `<div class="funnel-row">
      <span class="funnel-label">${esc(s.label)}</span>
      <span class="bar-track tall"><i style="width:${Math.round((s.count / peak) * 1000) / 10}%;opacity:${(1 - i * 0.16).toFixed(2)}"></i></span>
      <span class="n strong">${esc(num(s.count))}</span>
      <span class="n">${esc(pctText(share(s.count, base)))}</span>
      <span class="n">${i ? esc(pctText(share(s.count, steps[i - 1].count))) : '—'}</span>
    </div>`).join('')}
  </div>`;
}

function adoption(r: UsageReport): string {
    const [, activeStep, , regularStep] = r.adoption.funnel;
    const trend = r.adoption.trend;
    const anyActivity = trend.some(p => p.active || p.created || p.completed);
    const everyUnit = r.adoption.trendUnit === 'week'
        ? 'Each point is a week, labelled with its first day. A final short week can read low.'
        : 'Each point is one day, in IST.';
    const standfirst = activeStep && regularStep
        ? `${num(activeStep.count)} of ${plural(r.base.people, 'person', 'people')} with access did something in the Task Manager, and ${num(regularStep.count)} reached the regular-use target of ${plural(r.regularTarget, 'completed cycle')}.`
        : 'How far people moved from having access to using the Task Manager regularly.';
    const created: Series = { key: 'created', color: ACCENT, dash: '5 3', width: 1.5, hollow: true };
    const completed: Series = { key: 'completed', color: INK, width: 1.75 };
    return page('Adoption', standfirst, r, `
  ${block('From access to regular use', 'Each step is a subset of the one above it.', funnel(r))}
  ${block('Activity over the period', everyUnit, anyActivity
        ? `<p class="legend"><span>${swatch(BRAND_DARK)}Active users</span></p>
    ${lineChart(trend, [{ key: 'active', color: BRAND_DARK, width: 1.75, area: true }], 186, false)}
    <p class="legend spaced"><span>${swatch(ACCENT, '5 3')}Tasks created</span><span>${swatch(INK)}Tasks completed</span></p>
    ${lineChart(trend, [created, completed], 244, true)}`
        : emptyNote('No activity was recorded in this period.'))}`);
}

function busiestSlot(rows: number[][]): string | null {
    let best = 0, label: string | null = null;
    rows.forEach((row, r) => row.forEach((v, c) => {
        if (finite(v) && v > best) {
            best = v;
            label = `${WEEKDAYS[r]}, ${String(c * 2).padStart(2, '0')}:00 to ${String(c * 2 + 2).padStart(2, '0')}:00 IST`;
        }
    }));
    return label;
}

function channelSplit(web: number, whatsapp: number): string {
    const total = web + whatsapp;
    if (!total) return emptyNote('No actions were recorded in this period.');
    const webShare = share(web, total) ?? 0;
    return `<div class="split"><i style="width:${webShare}%;background:${BRAND_DARK}"></i><i style="width:${100 - webShare}%;background:#CBD8DB"></i></div>
    <div class="split-key">
      <div><span class="label">Web</span><strong>${esc(pctText(webShare))}</strong><span>${esc(plural(web, 'action'))}</span></div>
      <div><span class="label">WhatsApp</span><strong>${esc(pctText(100 - webShare))}</strong><span>${esc(plural(whatsapp, 'action'))}</span></div>
    </div>`;
}

function engagement(r: UsageReport): string {
    const { web, whatsapp } = r.engagement.channels;
    const total = web + whatsapp;
    const slot = busiestSlot(r.engagement.heatmap);
    const standfirst = total
        ? `${plural(total, 'recorded action')} in the period, ${pctText(share(whatsapp, total))} of them on WhatsApp.${slot ? ` The busiest block was ${slot}.` : ''}`
        : 'No actions were recorded in this period.';
    const days = r.engagement.activeDays;
    const features = r.engagement.features;
    return page('Engagement', standfirst, r, `
  <div class="two">
    ${block('Days active', 'People by the number of days they did something.', days.length
        ? barRows(days.map(d => ({ label: d.label, value: d.people })))
        : emptyNote('There is no one to count in this period.'))}
    ${block('Web and WhatsApp', 'Where recorded actions took place.', channelSplit(web, whatsapp))}
  </div>
  ${block('When people work', 'Actions by day and two-hour block starting at the time shown, IST. Darker means more.', r.engagement.heatmap.flat().some(v => v > 0)
        ? heatmap(r.engagement.heatmap)
        : emptyNote('No actions were recorded in this period.'))}
  ${block('Feature use', '', features.length
        ? `<table class="data"><colgroup><col><col style="width:26mm"><col style="width:26mm"></colgroup>
      <thead><tr><th>Feature</th><th class="n">Uses</th><th class="n">People</th></tr></thead>
      <tbody>${features.map(f => `<tr><td>${esc(f.label)}</td><td class="n">${esc(num(f.uses))}</td><td class="n">${esc(num(f.people))}</td></tr>`).join('')}</tbody></table>`
        : emptyNote('No features were used in this period.'))}`);
}

function signed(v: number | null): string {
    if (!finite(v) || v === 0) return '';
    return ` <span class="delta">${v > 0 ? '+' : '−'}${esc(num(Math.abs(v)))}</span>`;
}

function scorecard(r: UsageReport): string {
    const ds = r.departments;
    const sum = (pick: (d: DepartmentRow) => number) => ds.reduce((total, d) => total + pick(d), 0);
    const rows = ds.map(d => `<tr>
      <td class="name">${esc(clip(d.name, 34))}</td>
      <td class="n">${esc(num(d.active))} of ${esc(num(d.people))}${signed(d.activeChange)}</td>
      <td class="n">${esc(pctText(d.adoptionPct))}</td>
      <td class="n">${esc(num(d.regular))}</td>
      <td class="n">${esc(num(d.created))}</td>
      <td class="n">${esc(num(d.completed))}</td>
      <td class="n">${esc(num(d.cycles))}</td>
      <td class="n">${esc(pctText(d.completionPct))}</td>
      <td class="n">${esc(num(d.open))}</td>
      <td class="n">${esc(num(d.overdue))}</td>
      <td class="n">${esc(num(d.actions))}</td>
      <td class="status">${chip(d.tone)}</td>
    </tr>`).join('');
    const totals = `<tr>
      <td class="name">All departments</td>
      <td class="n">${esc(num(sum(d => d.active)))} of ${esc(num(sum(d => d.people)))}</td>
      <td class="n">${esc(pctText(share(sum(d => d.active), sum(d => d.people))))}</td>
      <td class="n">${esc(num(sum(d => d.regular)))}</td>
      <td class="n">${esc(num(sum(d => d.created)))}</td>
      <td class="n">${esc(num(sum(d => d.completed)))}</td>
      <td class="n">${esc(num(sum(d => d.cycles)))}</td>
      <td class="n">${esc(pctText(r.execution.completionPct))}</td>
      <td class="n">${esc(num(sum(d => d.open)))}</td>
      <td class="n">${esc(num(sum(d => d.overdue)))}</td>
      <td class="n">${esc(num(sum(d => d.actions)))}</td>
      <td></td>
    </tr>`;
    const body = ds.length
        ? `${block('By department', 'Most active first. A figure beside Active is the change from the previous period.', `<table class="data score${ds.length > 10 ? ' dense' : ''}">
      <colgroup><col><col style="width:19mm"><col style="width:13mm"><col style="width:11.5mm"><col style="width:11.5mm"><col style="width:14mm"><col style="width:10mm"><col style="width:14.5mm"><col style="width:9mm"><col style="width:12mm"><col style="width:11mm"><col style="width:21mm"></colgroup>
      <thead><tr><th>Department</th><th class="n">Active</th><th class="n">Adoption</th><th class="n">Regular</th><th class="n">Created</th><th class="n">Completed</th><th class="n">Cycles</th><th class="n">Completion</th><th class="n">Open</th><th class="n">Overdue</th><th class="n">Actions</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody><tfoot>${totals}</tfoot></table>
      <p class="caption after">On track: adoption of 75% or more and completion of 70% or more. Attention: adoption under 50% or completion under 40%. Watch: anything between. Where no tasks were created, adoption alone decides.</p>`)}
    ${block('Adoption and completion compared', 'A wide gap shows a department where people are present but work is not closing, or the reverse.', `<p class="legend"><span><svg class="swatch sq" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4.5" fill="${BRAND_DARK}"/></svg>Adoption</span><span><svg class="swatch sq" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l5 5-5 5-5-5Z" fill="#FFFFFF" stroke="${ACCENT_DARK}" stroke-width="1.5"/></svg>Completion</span></p>${departmentPlot(ds)}`)}`
        : '';
    // 15 departments fill the page with the first two blocks; this one would strand itself alone on the next page.
    const openWork = ds.length && ds.length <= 8 && ds.some(d => d.open)
        ? block('Where open work sits', 'Tasks open at period end. The overdue share is in brackets.', barRows([...ds].sort((a, b) => b.open - a.open).map(d => ({
            label: clip(d.name, 20), value: d.open, right: d.overdue ? `${num(d.open)} (${num(d.overdue)})` : num(d.open),
        }))))
        : '';
    return page('Department scorecard', departmentStatusLine(ds), r, body + openWork);
}

function workTable(items: DepartmentWorkItem[], withAge: boolean, empty: string): string {
    if (!items.length) return emptyNote(empty);
    return `<table class="work"><colgroup><col><col style="width:27mm">${withAge ? '<col style="width:15mm">' : ''}</colgroup><tbody>${items.map(t => `<tr>
      <td class="title">${esc(clip(t.title, 90))}</td>
      <td class="owner">${esc(clip(t.owner, 40) || '—')}</td>
      ${withAge ? `<td class="n">${esc(ageText(t.ageDays))}</td>` : ''}
    </tr>`).join('')}</tbody></table>`;
}

function departmentBlock(d: DepartmentRow): string {
    const assigned = d.selfAssigned + d.delegated;
    const selfShare = share(d.selfAssigned, assigned) ?? 0;
    const split = assigned
        ? `<div class="dept-split"><span>Self-assigned <strong>${esc(num(d.selfAssigned))}</strong></span><div class="split thin"><i style="width:${selfShare}%;background:${BRAND_DARK}"></i><i style="width:${100 - selfShare}%;background:#CBD8DB"></i></div><span>Delegated <strong>${esc(num(d.delegated))}</strong></span></div>`
        : '<p class="empty tight">No tasks were assigned by hand in this department in this period.</p>';
    return `<article class="dept">
    <header class="dept-head">
      <h3>${esc(clip(d.name, 60))}</h3>
      <span class="dept-sub">${esc(num(d.active))} of ${esc(plural(d.people, 'person', 'people'))} active · ${esc(num(d.open))} open · ${esc(num(d.overdue))} overdue</span>
      ${chip(d.tone)}
    </header>
    ${split}
    <div class="dept-cols">
      <div><h4>Oldest open tasks</h4>${workTable(d.oldestOpen, true, 'No open tasks at period end.')}</div>
      <div><h4>Recently completed</h4>${workTable(d.recentlyCompleted, false, 'Nothing was completed in this period.')}</div>
    </div>
  </article>`;
}

function departmentWork(r: UsageReport): string {
    return page('Department work', 'Who assigned the work, what was still open at period end and what was finished, for each department. Up to five tasks are listed in each column.', r,
        r.departments.length
            ? `<div class="dept-flow">${r.departments.map(departmentBlock).join('')}</div>`
            : emptyNote('No departments are switched on for the Task Manager.'));
}

function execution(r: UsageReport): string {
    const e = r.execution;
    const split = e.selfAssigned + e.delegated + e.automatic;
    const seg = (value: number, color: string) => `<i style="width:${(share(value, split) ?? 0)}%;background:${color}"></i>`;
    const standfirst = e.created || e.completed
        ? `${plural(e.created, 'task')} created and ${num(e.completed)} completed in the period, with ${plural(e.openAtEnd, 'task')} open at the end of it.`
        : 'No tasks were created or completed in this period.';
    const ageing = e.openAgeing;
    return page('Execution health', standfirst, r, `
  ${statRow([
        { label: 'Created', value: num(e.created), note: 'Tasks created in the period' },
        { label: 'Completed', value: num(e.completed), note: 'Tasks finished in the period' },
        { label: 'Completion rate', value: pctText(e.completionPct), note: `${num(e.cycles)} completed ${e.cycles === 1 ? 'cycle' : 'cycles'}` },
        { label: 'Median time', value: durationText(e.medianHoursToComplete), note: 'From created to completed' },
        { label: 'Overdue', value: num(e.overdue), note: 'Past due at period end' },
    ])}
  <div class="two">
    ${block('On-time delivery', 'Tasks whose due date fell in the period.', e.due.tasksDue
        ? `<div class="hero-figure"><strong>${esc(pctText(e.due.onTimePct))}</strong><span>${esc(num(e.due.onTime))} of ${esc(plural(e.due.tasksDue, 'task'))} finished on or before the due date</span></div>`
        : emptyNote('No tasks had a due date in this period.'))}
    ${block('Due-date coverage', 'New tasks that were given a due date.', e.due.coveragePct === null
        ? emptyNote('No tasks were created in this period.')
        : `<div class="hero-figure"><strong>${esc(pctText(e.due.coveragePct))}</strong><span>${e.due.coveragePct < 50 ? 'On-time figures describe only this share of new work.' : 'On-time figures describe this share of new work.'}</span></div>
      <div class="split thin"><i style="width:${e.due.coveragePct}%;background:${BRAND_DARK}"></i><i style="width:${100 - e.due.coveragePct}%;background:${LINE}"></i></div>`)}
  </div>
  ${block('Created and completed', 'Completed tasks can include work created before the period began. A cycle was both created and completed in it.', e.created || e.completed
        ? barRows([
            { label: 'Created', value: e.created },
            { label: 'Completed', value: e.completed },
            { label: 'Completed cycles', value: e.cycles },
        ])
        : emptyNote('No tasks were created or completed in this period.'))}
  ${block('Open tasks by age', e.openAtEnd ? `${plural(e.openAtEnd, 'task')} open at period end.` : '', e.openAtEnd
        ? barRows(ageing.map(a => ({ label: a.label, value: a.count })))
        : emptyNote('No tasks were open at period end.'))}
  ${block('How work was created', 'Tasks created in the period, by who created them.', split
        ? `<div class="split">${seg(e.selfAssigned, BRAND_DARK)}${seg(e.delegated, '#A7BCC1')}${seg(e.automatic, LINE)}</div>
      <div class="split-key four">
        <div><span class="label">Self-assigned</span><strong>${esc(num(e.selfAssigned))}</strong><span>${esc(pctText(share(e.selfAssigned, split)))}</span></div>
        <div><span class="label">Delegated</span><strong>${esc(num(e.delegated))}</strong><span>${esc(pctText(share(e.delegated, split)))}</span></div>
        <div><span class="label">Automatic</span><strong>${esc(num(e.automatic))}</strong><span>Fixed tasks and Zoho imports</span></div>
        <div><span class="label">Deleted</span><strong>${esc(num(e.deleted))}</strong><span>Not part of the bar</span></div>
      </div>`
        : emptyNote('No tasks were created in this period.'))}`);
}

function regularsTable(r: UsageReport): string {
    const rows = r.people.regulars;
    if (!rows.length) return emptyNote(`Nobody reached ${plural(r.regularTarget, 'completed cycle')} in this period.`);
    const total = r.adoption.funnel[3]?.count ?? rows.length;
    return `<table class="data people">
      <colgroup><col style="width:42mm"><col><col style="width:12mm"><col style="width:12mm"><col style="width:12mm"><col style="width:14mm"><col style="width:12mm"><col style="width:22mm"></colgroup>
      <thead><tr><th>Name</th><th>Department</th><th class="n">Cycles</th><th class="n">Days</th><th class="n">Created</th><th class="n">Completed</th><th class="n">Actions</th><th class="n">Last active</th></tr></thead>
      <tbody>${rows.map((p: PersonRow) => `<tr>
        <td class="name">${esc(clip(p.name, 40))}</td>
        <td class="clip">${esc(clip(p.department, 36))}</td>
        <td class="n">${esc(num(p.cycles))}</td>
        <td class="n">${esc(num(p.activeDays))}</td>
        <td class="n">${esc(num(p.created))}</td>
        <td class="n">${esc(num(p.completed))}</td>
        <td class="n">${esc(num(p.actions))}</td>
        <td class="n">${esc(day(p.lastActive))}</td>
      </tr>`).join('')}</tbody></table>${total > rows.length ? `<p class="caption after">The top ${num(rows.length)} of ${num(total)} regular users are shown.</p>` : ''}`;
}

function nameList(rows: PersonRow[], withLastActive: boolean, empty: string): string {
    if (!rows.length) return emptyNote(empty);
    return `<ul class="names">${rows.map(p => `<li><strong>${esc(clip(p.name, 32))}</strong><span>${esc(clip(p.department, 30))}${withLastActive && p.lastActive ? `, last active ${esc(day(p.lastActive))}` : ''}</span></li>`).join('')}</ul>`;
}

function definitions(r: UsageReport): string {
    const terms: [string, string][] = [
        ['Base', 'Departments switched on for the Task Manager and people onboarded to it. Superusers are not included.'],
        ['Active user', 'Someone who did something in the Task Manager in the period. Opening a screen leaves no record, so it does not count.'],
        ['Completed cycle', 'A task created and completed in the period, counted for its creator and its completer. Auto-generated fixed tasks and Zoho imports are excluded.'],
        ['Regular user', `At least ${plural(r.regularTarget, 'completed cycle')} in this period, which is 3 per 7 days.`],
        ['Completion rate', 'Completed cycles as a share of tasks created in the period, leaving out auto-generated fixed tasks and Zoho imports.'],
    ];
    return `<section class="block defs">
    <h3>Definitions</h3>
    <dl>${terms.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${r.notes.length ? `<ul class="notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <p class="closing">This report measures Task Manager use, not job performance.</p>
  </section>`;
}

function peopleAndActions(r: UsageReport): string {
    const { stopped, quiet } = r.people;
    const inactive = stopped.length + quiet.length;
    const standfirst = !r.base.people
        ? 'Nobody has been onboarded to the Task Manager.'
        : inactive
            ? `${plural(inactive, 'person', 'people')} with access had no activity in this period.`
            : 'Everyone with access was active in this period.';
    return page('People and actions', standfirst, r, `
  ${block('Regular users', `Reached the target of ${plural(r.regularTarget, 'completed cycle')}.`, regularsTable(r))}
  ${block('Stopped', 'Active in the previous period, nothing in this one.', r.previousPeriod
        ? nameList(stopped, true, 'Nobody stopped in this period.')
        : emptyNote('There is no previous period to compare with.'))}
  ${block('Quiet', 'Have access, with no activity in this period or the one before it.', nameList(quiet, false, 'Nobody is in this group.'))}
  ${block('Recommended actions', '', r.actions.length
        ? `<ol class="ruled">${r.actions.map(a => `<li>${esc(a)}</li>`).join('')}</ol>`
        : emptyNote('No follow-up is needed from this period’s numbers.'))}
  ${definitions(r)}`);
}

// ── Document ────────────────────────────────────────────────────────────────

const css = `
${REPORT_FONT_CSS}
@page { size: A4; margin: 16mm 14mm 18mm; }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: ${BODY}; font-family: Urbanist, 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; font-weight: 500; line-height: 1.45; font-variant-numeric: lining-nums; }
h1, h2, h3, h4 { margin: 0; color: ${INK}; font-family: Poppins, Urbanist, sans-serif; font-weight: 600; }
p, dl, dd, ol, ul { margin: 0; padding: 0; }
ol, ul { list-style: none; }
strong { color: ${INK}; font-weight: 700; }

.page { break-before: page; }
.label { color: ${MUTED}; font-size: 7pt; font-weight: 700; letter-spacing: .9pt; text-transform: uppercase; line-height: 1.3; }
.n { text-align: right; font-variant-numeric: lining-nums tabular-nums; }
.empty { color: ${MUTED}; font-size: 9pt; padding: 2mm 0; }
.empty.tight { padding: 0 0 2mm; font-size: 8.5pt; }

/* Cover */
.cover { height: 252mm; display: flex; flex-direction: column; }
/* The logo PNG has transparent padding: crop to its ink (91,42 to 408,81 of 500x135) so it sits on the text edge. */
.logo { position: relative; width: 44mm; height: 5.41mm; overflow: hidden; flex: none; }
.logo img { position: absolute; left: -12.63mm; top: -5.83mm; width: 69.4mm; height: auto; }
.cover-field { margin-top: 14mm; }
.cover-field .caption { margin-top: 2.5mm; }
.cover-main { margin-top: auto; padding-bottom: 12mm; }
.cover-tick { width: 18mm; height: 3pt; background: ${BRAND}; margin-bottom: 6mm; }
h1 { font-size: 36pt; line-height: 1.08; letter-spacing: -1pt; }
.cover-org { margin-top: 6mm; color: ${INK}; font-family: Poppins, Urbanist, sans-serif; font-size: 14pt; font-weight: 500; line-height: 1.3; letter-spacing: -.15pt; }
.cover-period { margin-top: 1mm; color: ${MUTED}; font-size: 12pt; }
.cover-meta { display: grid; grid-template-columns: repeat(4, 1fr); border-top: .75pt solid ${INK}; }
.cover-meta > div { padding: 3mm 3mm 0 0; }
.cover-meta dd { margin-top: 1mm; color: ${INK}; font-family: Poppins, Urbanist, sans-serif; font-size: 12pt; font-weight: 500; }

/* Section opening */
.sec-head { margin-bottom: 8mm; }
.sec-rail { position: relative; display: flex; gap: 6mm; padding-top: 3mm; color: ${MUTED}; font-size: 7.5pt; }
.sec-rail::after { content: ''; position: absolute; top: .5pt; left: 0; right: 0; height: .75pt; background: ${INK}; }
/* Never offset this above the rail: at a page break the overflow prints at the foot of the page before. */
.sec-rail::before { content: ''; position: absolute; top: 0; left: 0; width: 18mm; height: 2.5pt; background: ${BRAND}; z-index: 1; }
.sec-rail span:first-child { color: ${INK}; font-weight: 700; }
.sec-rail span:last-child { margin-left: auto; }
h2 { margin-top: 6mm; font-size: 20pt; line-height: 1.2; letter-spacing: -.4pt; }
.stand { margin-top: 2mm; max-width: 158mm; color: ${BODY}; font-size: 11pt; line-height: 1.4; }

/* Blocks: tight inside, loose between */
.block { margin-top: 8mm; break-inside: avoid; }
.sec-head + .block { margin-top: 0; }
.block h3 { font-size: 10pt; line-height: 1.3; }
.caption { margin-top: .5mm; color: ${MUTED}; font-size: 8pt; line-height: 1.35; }
.caption.after { margin-top: 2mm; }
.block > .caption + * { margin-top: 2.5mm; }
.block > h3 + * { margin-top: 2.5mm; }
.block > h3 + .caption { margin-top: .5mm; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
.sec-head + .two .block { margin-top: 0; }
.panel { padding: 4mm 4.5mm 4.5mm; background: ${WASH}; border-top: 1.5pt solid ${BRAND}; }

/* KPI tiles */
.kpis { display: grid; grid-template-columns: repeat(5, 1fr); border-top: .75pt solid ${LINE}; border-bottom: .75pt solid ${LINE}; }
.kpi { display: flex; flex-direction: column; min-width: 0; padding: 3mm 2.5mm 3mm 3mm; border-left: .75pt solid ${LINE}; }
.kpi:first-child { border-left: 0; padding-left: 0; }
.kpi-value { margin-top: 2.5mm; color: ${INK}; font-family: Poppins, Urbanist, sans-serif; font-size: 21pt; font-weight: 600; line-height: 1.1; letter-spacing: -.3pt; white-space: nowrap; }
.kpi-value small { color: ${MUTED}; font-family: Urbanist, sans-serif; font-size: 10pt; font-weight: 600; letter-spacing: 0; }
.kpi-detail { margin-top: 1.5mm; min-height: 2.7em; color: ${MUTED}; font-size: 8pt; line-height: 1.35; }
.kpi-foot { display: flex; flex-direction: column; align-items: flex-start; gap: 1.2mm; margin-top: 2mm; }
.kpi-change { font-size: 8.5pt; font-weight: 700; }
.chip { display: inline-flex; align-items: center; gap: 1mm; padding: .35mm 1.6mm; border-radius: 99pt; font-size: 7pt; font-weight: 700; line-height: 1.5; white-space: nowrap; }
.mark { width: 5.5pt; height: 5.5pt; flex: none; }

/* Summary */
.summary-cols { display: grid; grid-template-columns: 1.3fr 1fr; gap: 9mm; margin-top: 8mm; align-items: start; }
.summary-cols .block { margin-top: 0; }
.ruled li { padding: 2mm 0; border-top: .5pt solid ${LINE}; color: ${BODY}; font-size: 10pt; line-height: 1.4; break-inside: avoid; }
.ruled li:first-child { border-top: 0; padding-top: 0; }
.steps li { display: grid; grid-template-columns: 5mm 1fr; padding: 1.5mm 0; font-size: 9.5pt; line-height: 1.4; }
.steps span { color: ${BRAND_DARK}; font-family: Poppins, Urbanist, sans-serif; font-weight: 600; }
.glance { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 8mm; border-top: .5pt solid ${LINE}; }
.glance-item { display: flex; align-items: center; justify-content: space-between; gap: 2mm; padding: 1.5mm 0; border-bottom: .5pt solid ${LINE_SOFT}; min-width: 0; }
.glance-name { min-width: 0; overflow: hidden; color: ${INK}; font-size: 8.5pt; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }

/* Bars */
.bars { display: grid; row-gap: 1.8mm; }
.bar-row { display: grid; grid-template-columns: 27mm 1fr 10mm; align-items: center; column-gap: 2.5mm; font-size: 8.5pt; }
.bar-label { color: ${BODY}; white-space: nowrap; }
.bar-value { color: ${INK}; font-weight: 700; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.bar-track { display: block; height: 7pt; background: ${LINE_SOFT}; }
.bar-track.tall { height: 11pt; }
.bar-track i { display: block; height: 100%; background: ${BRAND_DARK}; }
.funnel-row { display: grid; grid-template-columns: 40mm 1fr 14mm 14mm 22mm; align-items: center; column-gap: 2.5mm; padding: 1.3mm 0; font-size: 9pt; }
.funnel-head { padding: 0 0 .5mm; color: ${MUTED}; font-size: 7.5pt; font-weight: 700; text-align: right; }
.funnel-label { color: ${INK}; font-weight: 600; }
.strong { color: ${INK}; font-weight: 700; }

/* Charts */
.chart { display: block; width: 100%; height: auto; }
.chart text { font-family: Urbanist, sans-serif; }
.tick { fill: ${MUTED}; font-size: 10px; font-variant-numeric: tabular-nums; }
.cell { font-size: 9.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.row { fill: ${INK}; font-size: 11px; font-weight: 600; }
.legend { display: flex; gap: 6mm; color: ${BODY}; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
.legend.spaced { margin-top: 3.5mm; }
.legend span { display: inline-flex; align-items: center; gap: 1.5mm; }
.swatch { width: 18px; height: 6px; }
.swatch.sq { width: 9px; height: 9px; }

/* Splits */
.split { display: flex; height: 11pt; gap: 1pt; }
.split.thin { height: 6pt; }
.split i { display: block; height: 100%; }
.split-key { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 2.5mm; }
.split-key.four { grid-template-columns: repeat(4, 1fr); }
.split-key > div { display: grid; row-gap: .3mm; color: ${MUTED}; font-size: 8pt; line-height: 1.3; }
.split-key strong { font-family: Poppins, Urbanist, sans-serif; font-size: 14pt; font-weight: 600; line-height: 1.2; letter-spacing: -.2pt; }

/* Tables */
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-variant-numeric: lining-nums tabular-nums; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr { break-inside: avoid; }
.data { font-size: 8.5pt; line-height: 1.3; }
.data th { padding: 1.2mm 1.5mm 1.2mm 0; border-bottom: .75pt solid ${INK}; color: ${MUTED}; font-size: 7.5pt; font-weight: 700; text-align: left; white-space: nowrap; }
.data th.n { text-align: right; padding-left: 1mm; padding-right: 0; }
.data td { padding: 1.3mm 1.5mm 1.3mm 0; border-bottom: .5pt solid ${LINE}; }
.data td.n { padding-left: 1mm; padding-right: 0; color: ${INK}; }
.data .name { overflow: hidden; color: ${INK}; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.score .name { white-space: normal; overflow-wrap: anywhere; }
.data .clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.data .status { padding-left: 2mm; padding-right: 0; }
.score th:last-child { padding-left: 2mm; padding-right: 0; }
.score { font-size: 8pt; }
.score th { font-size: 7pt; }
/* Above 10 departments the table gives up air so the comparison chart stays on this page. */
.score.dense td { padding-top: .5mm; padding-bottom: .5mm; }
.score.dense .chip { padding-top: 0; padding-bottom: 0; }
.score tfoot td { border-top: .75pt solid ${INK}; border-bottom: 0; color: ${INK}; font-weight: 700; }
.delta { color: ${MUTED}; font-size: 7pt; font-weight: 600; }

/* Department work */
.dept { padding: 4mm 0 4.5mm; border-top: .75pt solid ${INK}; break-inside: avoid; }
.dept:first-child { padding-top: 3mm; }
.dept-head { display: flex; align-items: center; gap: 3mm; margin-bottom: 2mm; }
.dept-head h3 { min-width: 0; overflow: hidden; font-size: 10.5pt; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.dept-sub { flex: 1; color: ${MUTED}; font-size: 8pt; white-space: nowrap; }
.dept-split { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 2.5mm; margin-bottom: 3mm; color: ${MUTED}; font-size: 8pt; }
.dept-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.dept-cols > div { min-width: 0; }
h4 { margin-bottom: .8mm; padding-bottom: .8mm; border-bottom: .5pt solid ${FAINT}; color: ${MUTED}; font-family: Urbanist, sans-serif; font-size: 7.5pt; font-weight: 700; }
.dept .empty { padding: 1mm 0; font-size: 8pt; }
.dept .empty.tight { padding: 0 0 2.5mm; }
.work { font-size: 8pt; line-height: 1.3; }
.work td { padding: .8mm 1.5mm .8mm 0; border-bottom: .5pt solid ${LINE_SOFT}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work .title { color: ${INK}; }
.work .owner { color: ${MUTED}; }
.work .n { padding-right: 0; color: ${INK}; }

/* Execution */
.stats { display: grid; border-top: .75pt solid ${LINE}; border-bottom: .75pt solid ${LINE}; }
.sec-head + .stats { margin-bottom: 8mm; }
.stat { min-width: 0; padding: 3mm 2.5mm 3mm 3mm; border-left: .75pt solid ${LINE}; }
.stat:first-child { border-left: 0; padding-left: 0; }
.stat-value { margin-top: 2mm; color: ${INK}; font-family: Poppins, Urbanist, sans-serif; font-size: 16pt; font-weight: 600; line-height: 1.15; letter-spacing: -.25pt; white-space: nowrap; }
.stat-note { margin-top: 1mm; color: ${MUTED}; font-size: 8pt; line-height: 1.3; }
.stats + .two .block { margin-top: 0; }
.hero-figure { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 3mm; margin-bottom: 2.5mm; color: ${BODY}; font-size: 8.5pt; line-height: 1.35; }
.hero-figure strong { font-family: Poppins, Urbanist, sans-serif; font-size: 21pt; font-weight: 600; line-height: 1.1; letter-spacing: -.3pt; }

/* People */
.people { font-size: 8pt; }
.names { columns: 3; column-gap: 6mm; }
.names li { padding: .9mm 0; border-bottom: .5pt solid ${LINE_SOFT}; break-inside: avoid; line-height: 1.25; }
.names strong { display: block; overflow: hidden; font-size: 8.5pt; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.names span { display: block; overflow: hidden; color: ${MUTED}; font-size: 7.5pt; text-overflow: ellipsis; white-space: nowrap; }
.defs { padding-top: 3mm; border-top: .75pt solid ${INK}; }
.defs dl { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; margin-top: 2mm; }
.defs dt { color: ${INK}; font-size: 8.5pt; font-weight: 700; }
.defs dd { color: ${BODY}; font-size: 8pt; line-height: 1.35; }
.notes { margin-top: 3mm; padding-top: 2mm; border-top: .5pt solid ${LINE}; color: ${BODY}; font-size: 8pt; line-height: 1.35; }
.notes li + li { margin-top: 1mm; }
.closing { margin-top: 3mm; color: ${INK}; font-size: 8.5pt; font-weight: 700; }
`;

export function buildReportHtml(report: UsageReport): string {
    return `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><title>${esc(`Task Manager Usage Report, ${clip(report.orgName, 90)}`)}</title>
<style>${css}</style></head><body>
${cover(report)}
${summary(report)}
${adoption(report)}
${engagement(report)}
${scorecard(report)}
${departmentWork(report)}
${execution(report)}
${peopleAndActions(report)}
</body></html>`;
}
