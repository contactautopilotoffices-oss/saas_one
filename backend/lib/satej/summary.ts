/**
 * Everything Meera says to the purchase team, built by code — no LLM — so
 * nothing in a summary can be made up.
 *
 *   · *TemplateParams — the two AiSensy templates (WHATSAPP_META_TEMPLATES.md, Meera section)
 *   · fullSummary     — the complete ranked write-up, shown on the Meera page with a
 *                       copy button, formatted to paste straight into WhatsApp
 */

import { satejConfig } from './config';
import type { RankedVendor, Requirement } from './types';
import { clip, formatIst } from './util';

const QUAL_LABEL = { qualified: 'Qualified', verify_gst: 'Verify GST', disqualified: 'Not GST registered', not_reached: 'Not reached' } as const;

/** Path of a requirement on the Meera page, relative to the app origin. */
export function consolePath(r: Requirement): string {
    return `${r.organizationId}/meera?req=${encodeURIComponent(r.code)}`;
}

/** Absolute link, or null when no origin is known — never a guessed URL. */
export function consoleLink(r: Requirement): string | null {
    const base = r.appOrigin || satejConfig.publicBaseUrl;
    return base ? `${base}/${consolePath(r)}` : null;
}

function contactedWindow(r: Requirement): string {
    const times = (r.ranking ?? []).map((x) => x.contactedAt).filter(Boolean).sort();
    const first = times[0] ?? r.callsScheduledAt;
    const last = times.at(-1) ?? r.callsCompletedAt;
    const from = first ? formatIst(first) : '';
    const to = last && last !== first ? formatIst(last) : '';
    return from && to ? `${from} to ${to}` : from || to || 'today';
}

export function fullSummary(r: Requirement): string {
    const ranking = r.ranking ?? [];
    const reached = ranking.filter((x) => x.score.qualification !== 'not_reached');
    const notReached = ranking.filter((x) => x.score.qualification === 'not_reached');
    const qualified = ranking.filter((x) => x.score.qualification === 'qualified');
    const b = r.brief;

    const lines: string[] = [];
    lines.push(`*Vendor discovery: ${r.input.title}*`);
    lines.push(`Ref: ${r.code} | ${r.input.spendType.toUpperCase()}`);
    if (b) lines.push(`Need: ${b.itemSummary}, ${b.quantityText}, ${b.locationText}${b.timelineText ? `, ${b.timelineText}` : ''}`);
    lines.push(`Contacted: ${contactedWindow(r)}`);
    lines.push(`Calls: ${ranking.length} vendors dialled, ${reached.length} spoke, ${qualified.length} qualified`);
    lines.push('');

    const top = reached.slice(0, 8);
    if (!top.length) lines.push('No vendor could be reached on this round.');
    for (const v of top) lines.push(vendorBlock(v), '');

    if (notReached.length) {
        lines.push(`*Not reached (${notReached.length}):* ${notReached.map((v) => v.vendorName).join(', ')}`);
        lines.push('');
    }

    lines.push('*Next steps*');
    if (qualified.length) {
        const top = qualified[0];
        const why = [top.priceText && top.priceVerdict && top.priceVerdict !== 'no_benchmark' ? top.priceText.split(' — ')[1] : '', `${top.score.total}/100`].filter(Boolean).join(', ');
        lines.push(`Meera's pick: ${top.vendorName} (${why}). A person decides.`);
        const picks = qualified.slice(0, 3).map((v) => `#${v.rank} ${v.vendorName}`).join(', ');
        lines.push(`1. Send the BOQ / detailed requirement to ${picks} for quotation.`);
        lines.push('2. Collect company profile and GST certificate on WhatsApp.');
        lines.push('3. Call one client reference for the top pick before the PO.');
    } else {
        lines.push('1. No vendor qualified. Use "Find more vendors" on the Meera page for a wider search and a fresh round of calls.');
    }
    const link = consoleLink(r);
    if (link) lines.push(`Full call notes and recordings: ${link}`);
    return clip(lines.join('\n'), 4000);
}

function vendorBlock(v: RankedVendor): string {
    const out: string[] = [];
    out.push(`*${v.rank}. ${v.vendorName}*  ${v.score.total}/100  (${QUAL_LABEL[v.score.qualification]})`);
    out.push(`${v.phone}${v.area ? ` | ${v.area}` : ''}`);
    if (v.priceText) out.push(`Rate: ${v.priceText}`);
    const facts: string[] = [];
    if (v.yearsExperience !== null) facts.push(`${v.yearsExperience} yrs`);
    if (v.turnaroundText) facts.push(`delivery ${v.turnaroundText}`);
    if (facts.length) out.push(facts.join(' | '));
    if (v.clients.length) out.push(`Clients: ${v.clients.slice(0, 4).join(', ')}`);
    if (v.specialisations.length) out.push(`Specialises in: ${v.specialisations.slice(0, 3).join(', ')}`);
    if (v.usps.length) out.push(`USP: ${v.usps.slice(0, 2).join('; ')}`);
    if (v.redFlags.length) out.push(`Watch out: ${v.redFlags.slice(0, 2).join('; ')}`);
    out.push(clip(v.summary, 280));
    return out.join('\n');
}

function greetingName(r: Requirement): string {
    return r.input.requestedBy?.trim() || 'Procurement Team';
}

/**
 * `satej_vendor_summary_v1`: {{1}} name, {{2}} title, {{3}} ref, {{4}} called,
 * {{5}} qualified, {{6}} top pick, {{7}} last call, {{8}} button path.
 */
export function summaryTemplateParams(r: Requirement): string[] {
    const ranking = r.ranking ?? [];
    const qualified = ranking.filter((x) => x.score.qualification === 'qualified');
    const reached = ranking.filter((x) => x.score.qualification !== 'not_reached');
    const top = qualified[0] ?? reached[0];
    return [
        greetingName(r),
        r.input.title,
        r.code,
        String(ranking.length),
        String(qualified.length),
        top ? `${top.vendorName} (${top.score.total}/100)` : 'none qualified yet',
        r.callsCompletedAt ? formatIst(r.callsCompletedAt) : formatIst(new Date()),
        consolePath(r),
    ];
}

/** Same template, for a search that found nobody callable. */
export function noVendorsTemplateParams(r: Requirement): string[] {
    return [
        greetingName(r),
        r.input.title,
        r.code,
        '0',
        '0',
        'No callable vendors found. Open the page to run a wider search',
        '-',
        consolePath(r),
    ];
}

/**
 * `satej_input_needed_v1`: {{1}} name, {{2}} title, {{3}} ref, {{4}} what is needed, {{5}} button path.
 * Used for the agent's questions and for call-list approval.
 */
export function inputNeededTemplateParams(r: Requirement, ask: string): string[] {
    return [greetingName(r), r.input.title, r.code, ask, consolePath(r)];
}

export function questionsAsk(r: Requirement): string {
    return (r.brief?.questions ?? []).map((q, i) => `${i + 1}) ${q}`).join(' ');
}
