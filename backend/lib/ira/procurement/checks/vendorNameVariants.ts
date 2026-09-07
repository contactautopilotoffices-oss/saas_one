/**
 * CHECK — is one supplier recorded under more than one name?
 * -----------------------------------------------------------------------------
 * Structural, not an event: it is true every morning until someone merges the
 * records, so a daily cadence would just be nagging. It belongs to the weekly
 * and slower runs, where "still true" is the point.
 *
 * It matters because it silently weakens every other check here. Spend split
 * across two spellings under-counts rate comparison, credit limits and — most
 * expensively — duplicate detection, which groups on the normalised vendor.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: do two vendor spellings normalise to one
 *                   supplier                                                   [BAA p.104]
 *   Tools           none — string normalisation over stored names              [BAA p.94]
 *   Failure mode    returns findings and counts; never throws                  [BAA p.94]
 *   Memory          none — structural findings are re-derived every run and
 *                   closed by resolveVanishedFindings when they stop being true [BAA p.103]
 *   Evaluation      the affected spend is summed from po_amount, never estimated [BAA p.95]
 *   Known deviation none
 */

import type { Check, CheckContext, CheckOutcome } from './contract';
import { num } from './contract';
import { normaliseVendor } from './duplicateInvoiceRef';
import type { Finding } from '../types';

export const vendorNameVariants: Check = {
    id: 'vendor-name-variants',
    question: 'Is a single supplier recorded under more than one name, splitting its spend?',
    nature: 'structural',
    needs: ['pos'],

    run(ctx: CheckContext): CheckOutcome {
        // Structural findings are true every day. Reporting them daily is
        // nagging; they belong to the weekly and slower cadences.
        if (ctx.window && ctx.window.cadence === 'daily') {
            return { findings: [], skipped: 'structural — reported on weekly and slower cadences, not daily' };
        }

        const byVendor = new Map<string, Set<string>>();
        const spend = new Map<string, number>();
        for (const r of ctx.live) {
            const n = normaliseVendor(r.vendor_name ?? '');
            if (!n) continue;
            byVendor.set(n, (byVendor.get(n) ?? new Set()).add(r.vendor_name ?? ''));
            spend.set(n, (spend.get(n) ?? 0) + num(r.po_amount));
        }

        const variants = [...byVendor.entries()].filter(([, names]) => names.size > 1);
        if (!variants.length) {
            return {
                findings: [],
                cleared: { looked: byVendor.size, unit: 'suppliers', note: `every one of ${byVendor.size} suppliers is recorded under a single name` },
            };
        }

        const worst = variants.sort((a, b) => (spend.get(b[0]) ?? 0) - (spend.get(a[0]) ?? 0));
        const affected = worst.reduce((s, [n]) => s + (spend.get(n) ?? 0), 0);

        const finding: Finding = {
            key: 'vendor-name-variants',
            priority: 'action',
            title: `${variants.length} suppliers are recorded under more than one name`,
            vendor: null,
            property: null,
            amount: affected,
            exposure: 'none',
            problem:
                `The same supplier appears under multiple spellings, so spend is split across records. ` +
                `Rate comparison, credit limits and duplicate detection all under-count as a result.\n\n` +
                worst.slice(0, 6).map(([, names]) => `· ${[...names].join('  /  ')}`).join('\n'),
            refs: [],
            reconcile: [{
                what: 'Supplier records vs suppliers',
                expected: String(byVendor.size),
                actual: String(byVendor.size + variants.length),
                gap: `${variants.length} suppliers hold a second record`,
            }],
            counter: 'The fair counter is two genuinely different legal entities that normalise to the same string — a Pvt Ltd and an LLP under one family name. Their GSTINs settle it.',
            ask: 'Merge the duplicate vendor records in Zoho, or confirm they are separate entities — say which for each pair.',
            stats: [
                { label: 'Suppliers', value: String(variants.length) },
                { label: 'Spend affected', value: `₹${Math.round(affected / 100000)}L` },
            ],
            actions: [
                { recipient: 'procurement', action: 'Merge the duplicate vendor records in Zoho so spend consolidates under one supplier.', deadline: 'This month' },
                { recipient: 'technical', action: 'Add a normalised-name uniqueness check on vendor creation so new variants cannot be added.', deadline: 'This sprint' },
            ],
        };

        return {
            findings: [finding],
            cleared: { looked: byVendor.size, unit: 'suppliers', note: `${byVendor.size - variants.length} of ${byVendor.size} are clean` },
        };
    },
};
