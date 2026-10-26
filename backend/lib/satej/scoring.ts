/**
 * Deterministic rule engine that scores and ranks vendors after the calls.
 *
 * The LLM only extracts facts from the transcript. The points below decide the
 * rank, so the same answers always produce the same score, and the team can see
 * exactly why. Rubric: Procurement_Agent_Plan.md §3 step 5, re-weighted on
 * 2026-10-06 to give price 20 of the 100 points: Meera now asks for a rate and
 * the rate is checked against what we have paid (benchmark.ts). The 20 came
 * from the parts that say least about whether a vendor is a good bet for this
 * order: website/profile (10 → 5), turnover (10 → 5), experience (15 → 10)
 * and clientele (20 → 15).
 */

import type { CallAnalysis, CallRecord, PriceCheck, RankedVendor, ScoreBreakdown, StructuredBrief, Vendor } from './types';
import { formatRate, spokenUnit, VERDICT_LABEL } from './rates';

type Part = ScoreBreakdown['parts'][number];

export const RUBRIC_MAX = {
    price: 20,
    experience: 10,
    clientele: 15,
    specialisation: 20,
    turnaround: 10,
    presence: 5,
    scale: 5,
    authenticity: 15,
};

/** Points for a quoted rate. A rate with no trustworthy history is neutral, not rewarded or punished. */
const PRICE_POINTS: Record<PriceCheck['verdict'], number> = { good: 20, fair: 15, slightly_high: 8, high: 2, no_benchmark: 10 };

export function scoreCall(a: CallAnalysis, brief: StructuredBrief, vendor: Vendor | undefined, price?: PriceCheck | null): ScoreBreakdown {
    if (!a.reachedRightPerson) {
        return { total: 0, qualification: 'not_reached', parts: [] };
    }
    const parts: Part[] = [];

    // Price against what we have paid (20)
    if (a.quotedRate === null) {
        parts.push({ label: 'Price', points: 0, max: RUBRIC_MAX.price, why: 'No rate given on the call' });
    } else {
        const verdict = price && price.confidence !== 'low' ? price.verdict : 'no_benchmark';
        const delta = verdict !== 'no_benchmark' && price?.deltaPct !== null && price?.deltaPct !== undefined
            ? ` (${price.deltaPct > 0 ? '+' : ''}${price.deltaPct}% vs ₹${formatRate(price.median ?? 0)} usual)`
            : '';
        parts.push({ label: 'Price', points: PRICE_POINTS[verdict], max: RUBRIC_MAX.price, why: `₹${formatRate(a.quotedRate)}: ${VERDICT_LABEL[verdict]}${delta}` });
    }

    // Years of experience (10). What they said on the call; the web if they were silent.
    const years = a.yearsExperience ?? vendor?.webYearsInBusiness ?? null;
    const expPts = years === null ? 0 : years >= 10 ? 10 : years >= 5 ? 7 : years >= 2 ? 4 : 1;
    parts.push({ label: 'Experience', points: expPts, max: RUBRIC_MAX.experience, why: years === null ? 'Not stated' : `${years} years` });

    // Clientele and testimonials (15)
    const named = a.clients.filter((c) => c.name.trim().length > 1).length;
    let cliPts = named >= 3 ? 10 : named === 2 ? 8 : named === 1 ? 5 : a.testimonialsText ? 2 : 0;
    if (a.referencesOffered) cliPts += 5;
    cliPts = Math.min(cliPts, RUBRIC_MAX.clientele);
    parts.push({
        label: 'Clientele',
        points: cliPts,
        max: RUBRIC_MAX.clientele,
        why: `${named} named client(s)${a.referencesOffered ? ', references offered' : ''}`,
    });

    // Specialisation match (20)
    const specPts = { exact: 20, strong: 14, partial: 7, weak: 0 }[a.specialisationMatch] ?? 0;
    parts.push({ label: 'Specialisation match', points: specPts, max: RUBRIC_MAX.specialisation, why: a.specialisationMatch });

    // Turnaround vs required timeline (10)
    let tatPts = 2;
    let tatWhy = 'Not stated';
    if (a.turnaroundDays !== null) {
        if (brief.timelineDays === null) {
            tatPts = 7;
            tatWhy = `${a.turnaroundDays} days (no deadline set)`;
        } else if (a.turnaroundDays <= brief.timelineDays) {
            tatPts = 10;
            tatWhy = `${a.turnaroundDays} days, meets ${brief.timelineDays}`;
        } else if (a.turnaroundDays <= brief.timelineDays * 1.3) {
            tatPts = 5;
            tatWhy = `${a.turnaroundDays} days, slightly over ${brief.timelineDays}`;
        } else {
            tatPts = 0;
            tatWhy = `${a.turnaroundDays} days, misses ${brief.timelineDays}`;
        }
    }
    parts.push({ label: 'Turnaround', points: tatPts, max: RUBRIC_MAX.turnaround, why: tatWhy });

    // Web presence and documents (5)
    const hasSite = a.hasWebsite === 'yes' || !!vendor?.website;
    const presPts = (hasSite ? 3 : 0) + (a.hasCompanyProfile === 'yes' ? 2 : 0);
    parts.push({
        label: 'Website / profile',
        points: presPts,
        max: RUBRIC_MAX.presence,
        why: `${hasSite ? 'website' : 'no website'}, ${a.hasCompanyProfile === 'yes' ? 'profile' : 'no profile'}`,
    });

    // Scale by annual turnover (5). Small is fine for small orders; this only separates the very large.
    const t = a.annualTurnoverLakhs;
    const scalePts = t === null ? 0 : t >= 500 ? 5 : t >= 100 ? 4 : t >= 25 ? 2 : 1;
    parts.push({ label: 'Turnover', points: scalePts, max: RUBRIC_MAX.scale, why: a.annualTurnoverText || 'Not stated' });

    // Authenticity from the call (15), minus 2 per red flag (max 6)
    const authRaw = Math.max(0, Math.min(10, a.authenticityScore));
    const authPts = Math.max(0, Math.round(authRaw * 1.5) - Math.min(6, a.redFlags.length * 2));
    parts.push({
        label: 'Authenticity',
        points: authPts,
        max: RUBRIC_MAX.authenticity,
        why: `${authRaw}/10${a.redFlags.length ? `, ${a.redFlags.length} red flag(s)` : ''}`,
    });

    const total = parts.reduce((s, p) => s + p.points, 0);
    const qualification = a.gstRegistered === 'yes' ? 'qualified' : a.gstRegistered === 'no' ? 'disqualified' : 'verify_gst';
    return { total, qualification, parts };
}

const QUAL_ORDER: Record<ScoreBreakdown['qualification'], number> = { qualified: 0, verify_gst: 1, disqualified: 2, not_reached: 3 };

/** One row per vendor (its best call if it was called more than once), sorted: qualified first, then by score. */
export function rankVendors(calls: CallRecord[], vendors: Vendor[]): RankedVendor[] {
    const byVendor = new Map<string, CallRecord>();
    for (const c of calls) {
        if (!c.vendorId || !c.score) continue;
        const prev = byVendor.get(c.vendorId);
        if (!prev || (prev.score && c.score.total > prev.score.total)) byVendor.set(c.vendorId, c);
    }
    const rows: RankedVendor[] = [...byVendor.values()].map((c) => {
        const v = vendors.find((x) => x.id === c.vendorId);
        const a = c.analysis;
        return {
            rank: 0,
            vendorId: c.vendorId!,
            vendorName: v?.name ?? 'Unknown',
            phone: v?.phone ?? c.toNumber,
            area: [v?.area, v?.city].filter(Boolean).join(', '),
            score: c.score!,
            summary: a?.summary
                ?? (c.analysisError ? 'Automatic analysis failed. Listen to the recording before deciding.' : c.bolnaSummary || 'No summary'),
            yearsExperience: a?.yearsExperience ?? v?.webYearsInBusiness ?? null,
            clients: (a?.clients ?? []).map((x) => x.name),
            specialisations: a?.specialisations ?? [],
            usps: a?.usps ?? [],
            turnaroundText: a?.turnaroundText ?? '',
            redFlags: a?.redFlags ?? [],
            priceText: a ? priceLine(a, c.priceCheck ?? null) : '',
            priceVerdict: a?.quotedRate != null ? (c.priceCheck?.confidence !== 'low' ? c.priceCheck?.verdict ?? 'no_benchmark' : 'no_benchmark') : null,
            contactedAt: c.createdAt,
        };
    });
    // Vendors that were put in the batch but never produced a call record count as not reached.
    for (const v of vendors) {
        if (!['queued', 'called', 'not_reached'].includes(v.status) || byVendor.has(v.id)) continue;
        rows.push({
            rank: 0,
            vendorId: v.id,
            vendorName: v.name,
            phone: v.phone,
            area: [v.area, v.city].filter(Boolean).join(', '),
            score: { total: 0, qualification: 'not_reached', parts: [] },
            summary: 'No call record received from Bolna.',
            yearsExperience: v.webYearsInBusiness,
            clients: [],
            specialisations: [],
            usps: [],
            turnaroundText: '',
            redFlags: [],
            priceText: '',
            priceVerdict: null,
            contactedAt: v.createdAt,
        });
    }
    rows.sort(
        (x, y) =>
            QUAL_ORDER[x.score.qualification] - QUAL_ORDER[y.score.qualification]
            || y.score.total - x.score.total
            || x.vendorName.localeCompare(y.vendorName),
    );
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
}

/** "₹38 per jar, GST extra, came down from ₹42 — in line with what we pay (₹36.5 usual)". */
export function priceLine(a: CallAnalysis, pc: PriceCheck | null): string {
    if (a.quotedRate === null) return '';
    const unit = pc?.unit && pc.unit !== '-' ? ` per ${spokenUnit(pc.unit)}` : a.quotedUnit ? ` ${a.quotedUnit}` : '';
    const bits = [`₹${formatRate(a.quotedRate)}${unit}`];
    if (a.rateIncludesGst === 'yes') bits.push('incl. GST');
    else if (a.rateIncludesGst === 'no') bits.push('GST extra');
    if (a.firstQuotedRate !== null && a.firstQuotedRate > a.quotedRate) bits.push(`came down from ₹${formatRate(a.firstQuotedRate)}`);
    const verdict = pc && pc.confidence !== 'low' ? pc.verdict : 'no_benchmark';
    const usual = verdict !== 'no_benchmark' && pc?.median ? ` (₹${formatRate(pc.median)} usual)` : '';
    return `${bits.join(', ')} — ${VERDICT_LABEL[verdict]}${usual}`;
}
