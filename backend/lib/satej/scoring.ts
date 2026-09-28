/**
 * Deterministic rule engine that scores and ranks vendors after the calls.
 *
 * The LLM only extracts facts from the transcript. The points below decide the
 * rank, so the same answers always produce the same score, and the team can see
 * exactly why. Rubric: Procurement_Agent_Plan.md §3 step 5.
 */

import type { CallAnalysis, CallRecord, RankedVendor, ScoreBreakdown, StructuredBrief, Vendor } from './types';

type Part = ScoreBreakdown['parts'][number];

export const RUBRIC_MAX = {
    experience: 15,
    clientele: 20,
    specialisation: 20,
    turnaround: 10,
    presence: 10,
    scale: 10,
    authenticity: 15,
};

export function scoreCall(a: CallAnalysis, brief: StructuredBrief, vendor: Vendor | undefined): ScoreBreakdown {
    if (!a.reachedRightPerson) {
        return { total: 0, qualification: 'not_reached', parts: [] };
    }
    const parts: Part[] = [];

    // Years of experience (15). What they said on the call; the web if they were silent.
    const years = a.yearsExperience ?? vendor?.webYearsInBusiness ?? null;
    const expPts = years === null ? 0 : years >= 10 ? 15 : years >= 5 ? 11 : years >= 2 ? 6 : 2;
    parts.push({ label: 'Experience', points: expPts, max: RUBRIC_MAX.experience, why: years === null ? 'Not stated' : `${years} years` });

    // Clientele and testimonials (20)
    const named = a.clients.filter((c) => c.name.trim().length > 1).length;
    let cliPts = named >= 3 ? 14 : named === 2 ? 11 : named === 1 ? 7 : a.testimonialsText ? 3 : 0;
    if (a.referencesOffered) cliPts += 6;
    cliPts = Math.min(cliPts, 20);
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

    // Web presence and documents (10)
    const hasSite = a.hasWebsite === 'yes' || !!vendor?.website;
    const presPts = (hasSite ? 6 : 0) + (a.hasCompanyProfile === 'yes' ? 4 : 0);
    parts.push({
        label: 'Website / profile',
        points: presPts,
        max: RUBRIC_MAX.presence,
        why: `${hasSite ? 'website' : 'no website'}, ${a.hasCompanyProfile === 'yes' ? 'profile' : 'no profile'}`,
    });

    // Scale by annual turnover (10)
    const t = a.annualTurnoverLakhs;
    const scalePts = t === null ? 0 : t >= 500 ? 10 : t >= 100 ? 7 : t >= 25 ? 4 : 2;
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
