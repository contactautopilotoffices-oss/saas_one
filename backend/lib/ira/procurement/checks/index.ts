/**
 * THE REGISTRY — every question this agent knows how to ask, in one list.
 * -----------------------------------------------------------------------------
 * Adding a check is: write the file, add it here. Nothing else in the pipeline
 * changes — the scan builds one context, runs the list, and returns findings
 * plus a coverage report.
 *
 * ── WHY COVERAGE IS RETURNED, NOT LOGGED ────────────────────────────────────
 * A scan that only reports what it FOUND cannot be trusted when it finds
 * nothing. The mail a person writes ends with where NOT to look — 32 vendors
 * swept, zero survivors — and that section is what makes the positives
 * believable. So every run returns, per check: did it run, what did it look at,
 * what did it clear, and what did it deliberately not raise.
 *
 * The three states are distinct and must stay distinct:
 *   ran + found      — here is the finding
 *   ran + cleared    — looked at N of these, nothing wrong
 *   SKIPPED          — did not run, and why. NEVER reported as clear.
 * The third is the one that matters. A check that cannot see its data — line
 * items not yet synced, a table missing — reporting "all clear" is the failure
 * mode this whole structure exists to prevent.
 */

import type { Check, CheckContext, Cleared } from './contract';
import type { Finding } from '../types';

import { feedStale } from './feedStale';
import { duplicateInvoiceRef } from './duplicateInvoiceRef';
import { contractPeriodOverlap } from './contractPeriodOverlap';
import { vendorNameVariants } from './vendorNameVariants';
import { approvalTrail } from './approvalTrail';

/**
 * ORDER MATTERS ONLY FOR THE FIRST ONE. If the feed is dead, everything below
 * it ran against stale data, and the reader has to be told that before being
 * told anything else.
 */
export const CHECKS: readonly Check[] = [
    feedStale,
    duplicateInvoiceRef,
    contractPeriodOverlap,
    vendorNameVariants,
    approvalTrail,
] as const;

/**
 * Checks whose absence is MEANINGFUL — a scan either raises them or does not,
 * so a finding that stops appearing has genuinely stopped being true and can be
 * closed. Per-record findings are excluded: they can vanish because the window
 * moved rather than because anything was fixed, and closing those would be a
 * lie about coverage.
 *
 * Derived from the registry rather than hand-listed in the cron, where it drifted.
 */
export const SINGLETON_CHECK_IDS: string[] = CHECKS.filter((c) => c.nature === 'structural').map((c) => c.id);

/** What one check did this run. */
export interface CheckReport {
    id: string;
    question: string;
    /** 'found' | 'clear' | 'skipped' | 'failed' */
    outcome: 'found' | 'clear' | 'skipped' | 'failed';
    found: number;
    cleared?: Cleared | null;
    /** Why it did not run, or why it broke. */
    why?: string;
    rejected?: Record<string, number>;
    ms: number;
}

export interface ScanCoverage {
    checks: CheckReport[];
    /** Checks that ran at all. The denominator for "we looked at N things". */
    ran: number;
    skipped: number;
    failed: number;
}

/**
 * Run every check against one context.
 *
 * A check that throws is recorded as failed and the scan continues. One broken
 * check must never cost the morning's mail — and a silent catch would be worse
 * than the crash, so the failure is carried in the coverage report and surfaces
 * in the run log.
 */
export async function runChecks(ctx: CheckContext): Promise<{ findings: Finding[]; coverage: ScanCoverage }> {
    const findings: Finding[] = [];
    const reports: CheckReport[] = [];

    for (const check of CHECKS) {
        const started = Date.now();
        try {
            const out = await check.run(ctx);
            findings.push(...out.findings);
            reports.push({
                id: check.id,
                question: check.question,
                outcome: out.skipped ? 'skipped' : out.findings.length ? 'found' : 'clear',
                found: out.findings.length,
                cleared: out.cleared ?? null,
                why: out.skipped,
                // Zero counts are noise in a report a person reads.
                rejected: out.rejected && Object.fromEntries(Object.entries(out.rejected).filter(([, n]) => n > 0)),
                ms: Date.now() - started,
            });
        } catch (e) {
            reports.push({
                id: check.id,
                question: check.question,
                outcome: 'failed',
                found: 0,
                why: e instanceof Error ? e.message : String(e),
                ms: Date.now() - started,
            });
            console.error(`[ira check ${check.id}]`, e);
        }
    }

    findings.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

    return {
        findings,
        coverage: {
            checks: reports,
            ran: reports.filter((r) => r.outcome === 'found' || r.outcome === 'clear').length,
            skipped: reports.filter((r) => r.outcome === 'skipped').length,
            failed: reports.filter((r) => r.outcome === 'failed').length,
        },
    };
}

export type { Check, CheckContext, CheckOutcome, Cleared, PoLine, PoRow } from './contract';
