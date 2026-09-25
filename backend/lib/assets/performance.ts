/**
 * Asset performance grading — P1 / P2 / P3.
 *
 * The founder's rule, verbatim from the brief:
 *   · all checkpoints covered                  → P1 (performing)
 *   · some issues                              → P2
 *   · nearing end of life AND AMC pending      → P3
 *     (e.g. 5-year life, in year 3, AMC not in place)
 *
 * Checkpoints are evaluated from data the platform already holds; nothing is
 * self-reported. An asset past its full lifecycle is P3 regardless.
 *
 * Pure function — no I/O — so the same grade appears on the register, the
 * drawer, the QR scan page, the ticket card and the org report.
 */

export type AssetGrade = 'P1' | 'P2' | 'P3';
export type CoverageState = 'warranty' | 'amc' | 'expired' | 'none';

export interface AssetCheckpoint {
    key: 'installation' | 'coverage' | 'tickets' | 'ppm' | 'lifecycle';
    label: string;
    ok: boolean;
    detail: string;
}

export interface AssetHealth {
    grade: AssetGrade;
    checkpoints: AssetCheckpoint[];
    coverage: CoverageState;
    coverage_ends: string | null;
    age_years: number | null;
    lifecycle_years: number | null;
    life_consumed_pct: number | null;
    nearing_end_of_life: boolean;
    amc_pending: boolean;
    open_tickets: number;
    overdue_ppm: number;
}

export interface AssetHealthInput {
    installation_date: string | null;
    lifecycle_years: number | null;
    /** category default, used when the asset has no override */
    category_lifecycle_years?: number | null;
    warranty_end: string | null;
    amc_required: boolean | null;
    amc: { contract_end_date: string; status: string } | null;
    open_tickets: number;
    overdue_ppm: number;
    status?: string | null;
}

/** "Nearing end of life" once this much of the lifecycle is consumed. Year 3 of 5 = 40%. */
export const END_OF_LIFE_WARNING_PCT = 40;

function daysBetween(a: Date, b: Date): number {
    return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function parseDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function computeAssetHealth(input: AssetHealthInput, today: Date = new Date()): AssetHealth {
    const now = new Date(today);
    now.setHours(0, 0, 0, 0);

    // ── Age & lifecycle ─────────────────────────────────────────────
    const installed = parseDate(input.installation_date);
    const lifecycle = input.lifecycle_years ?? input.category_lifecycle_years ?? null;
    const ageYears = installed ? Math.max(0, daysBetween(installed, now) / 365.25) : null;
    const consumed = ageYears !== null && lifecycle ? (ageYears / lifecycle) * 100 : null;
    const pastLife = consumed !== null && consumed >= 100;
    const nearingEol = consumed !== null && consumed >= END_OF_LIFE_WARNING_PCT && !pastLife;

    // ── Coverage ────────────────────────────────────────────────────
    const warrantyEnd = parseDate(input.warranty_end);
    const warrantyActive = !!warrantyEnd && warrantyEnd >= now;
    const amcEnd = input.amc ? parseDate(input.amc.contract_end_date) : null;
    const amcActive = !!amcEnd && amcEnd >= now && !['expired', 'renewed'].includes(input.amc?.status || '');

    let coverage: CoverageState = 'none';
    let coverageEnds: string | null = null;
    if (amcActive) { coverage = 'amc'; coverageEnds = input.amc!.contract_end_date; }
    else if (warrantyActive) { coverage = 'warranty'; coverageEnds = input.warranty_end; }
    else if (warrantyEnd || amcEnd) { coverage = 'expired'; coverageEnds = (amcEnd && (!warrantyEnd || amcEnd > warrantyEnd)) ? input.amc!.contract_end_date : input.warranty_end; }

    const amcPending = !!input.amc_required && !amcActive;

    // ── Checkpoints ─────────────────────────────────────────────────
    const checkpoints: AssetCheckpoint[] = [
        {
            key: 'installation',
            label: 'Installation date recorded',
            ok: !!installed,
            detail: installed ? `Installed ${input.installation_date}` : 'No installation date — age and lifecycle cannot be tracked',
        },
        {
            key: 'coverage',
            label: 'Under warranty or AMC',
            ok: warrantyActive || amcActive,
            detail: amcActive
                ? `AMC active until ${input.amc!.contract_end_date}`
                : warrantyActive
                    ? `Warranty until ${input.warranty_end}`
                    : coverage === 'expired'
                        ? `Cover expired on ${coverageEnds}`
                        : 'No warranty or AMC on record',
        },
        {
            key: 'tickets',
            label: 'No open tickets',
            ok: input.open_tickets === 0,
            detail: input.open_tickets === 0 ? 'No open tickets against this asset' : `${input.open_tickets} open ticket${input.open_tickets === 1 ? '' : 's'}`,
        },
        {
            key: 'ppm',
            label: 'PPM up to date',
            ok: input.overdue_ppm === 0,
            detail: input.overdue_ppm === 0 ? 'No overdue preventive maintenance' : `${input.overdue_ppm} overdue PPM task${input.overdue_ppm === 1 ? '' : 's'}`,
        },
        {
            key: 'lifecycle',
            label: 'Within expected lifecycle',
            ok: !pastLife,
            detail: consumed === null
                ? (lifecycle ? `Lifecycle ${lifecycle} yrs — age unknown` : 'No lifecycle set')
                : `${Math.round(consumed)}% of ${lifecycle}-year life consumed (${ageYears!.toFixed(1)} yrs)`,
        },
    ];

    // ── Grade ───────────────────────────────────────────────────────
    let grade: AssetGrade = 'P1';
    if (pastLife || (nearingEol && amcPending) || ['decommissioned', 'disposed'].includes(input.status || '')) {
        grade = 'P3';
    } else if (checkpoints.some((c) => !c.ok) || input.status === 'under_repair') {
        grade = 'P2';
    }

    return {
        grade,
        checkpoints,
        coverage,
        coverage_ends: coverageEnds,
        age_years: ageYears !== null ? Math.round(ageYears * 10) / 10 : null,
        lifecycle_years: lifecycle,
        life_consumed_pct: consumed !== null ? Math.round(consumed) : null,
        nearing_end_of_life: nearingEol,
        amc_pending: amcPending,
        open_tickets: input.open_tickets,
        overdue_ppm: input.overdue_ppm,
    };
}

export const GRADE_META: Record<AssetGrade, { label: string; blurb: string; color: string }> = {
    P1: { label: 'P1 · Performing', blurb: 'All checkpoints covered', color: '#10B981' },
    P2: { label: 'P2 · Attention', blurb: 'One or more checkpoints failing', color: '#F59E0B' },
    P3: { label: 'P3 · End of life risk', blurb: 'Nearing end of life with AMC pending, or past lifecycle', color: '#EF4444' },
};
