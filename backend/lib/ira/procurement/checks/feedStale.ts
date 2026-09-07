/**
 * CHECK — is the data underneath this scan still arriving?
 * -----------------------------------------------------------------------------
 * Runs first and, when it fires, it is the only thing that matters.
 *
 * A daily scan over a dead feed reports "nothing new", which reads as good news
 * and is the single most dangerous output this agent can produce. An empty
 * inbox because nothing went wrong and an empty inbox because the sync stopped
 * 25 days ago look identical to a reader, so the difference is asserted rather
 * than left to inference.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   one question: when did the newest purchase order arrive    [BAA p.104]
 *   Tools           none — one column, max()                                   [BAA p.94]
 *   Failure mode    no sync timestamp at all means it stays silent rather than
 *                   claiming a dead feed on an empty org                       [BAA p.94]
 *   Memory          none. This is true or false right now.                     [BAA p.103]
 *   Evaluation      the threshold is six missed runs of a two-hourly feed, so a
 *                   single skipped cron cannot raise it                        [BAA p.95]
 *   Known deviation none
 */

import type { Check, CheckContext, CheckOutcome } from './contract';
import type { Finding } from '../types';

/**
 * Generous on purpose: six missed runs of the two-hourly feed, not one. A cron
 * that skips once is not news, and an agent that cries wolf on a healthy feed
 * teaches people to ignore the one time it matters.
 */
const STALE_AFTER_H = 12;

export const feedStale: Check = {
    id: 'po-feed-stale',
    question: 'Has the purchase-order sync stopped, making every other check unreliable?',
    nature: 'structural',
    needs: ['pos'],

    run(ctx: CheckContext): CheckOutcome {
        const lastSync = ctx.pos
            .map((r) => r.synced_at ?? r.created_at)
            .filter(Boolean)
            .sort()
            .pop() as string | undefined;

        if (!lastSync) return { findings: [], skipped: 'no purchase order carries a sync timestamp' };

        const sinceSyncH = (ctx.asOf.getTime() - new Date(lastSync).getTime()) / 3_600_000;
        const fmt = (opts: Intl.DateTimeFormatOptions) =>
            new Date(lastSync).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...opts });

        if (sinceSyncH < STALE_AFTER_H) {
            return {
                findings: [],
                cleared: {
                    looked: ctx.pos.length,
                    unit: 'purchase orders held',
                    note: `feed is current — newest arrived ${Math.max(0, Math.floor(sinceSyncH))}h ago`,
                },
            };
        }

        const days = Math.floor(sinceSyncH / 24);
        const age = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.floor(sinceSyncH)} hours`;

        const finding: Finding = {
            key: 'po-feed-stale',
            priority: sinceSyncH >= 48 ? 'critical' : 'action',
            title: `Purchase-order sync has not run for ${age}`,
            vendor: null,
            property: null,
            amount: null,
            exposure: 'none',
            problem:
                `The newest purchase order in this system arrived on ${fmt({ day: '2-digit', month: 'short', year: 'numeric' })}. ` +
                `Nothing has synced from Zoho since.\n\n` +
                `Every other check in this scan ran against data that is ${age} old. ` +
                `Treat an otherwise-empty scan as UNKNOWN, not as all-clear — any PO raised since then is ` +
                `invisible to this agent, including duplicates.`,
            refs: [],
            counter: 'The fair counter is a genuine quiet spell with no new orders raised. The sync log settles it in a second: if the cron ran and found nothing, this closes.',
            ask: 'Check the Zoho Books PO sync — the cron, the refresh token, and its last error — and say whether the feed is dead or the week was quiet.',
            stats: [
                { label: 'Last sync', value: fmt({ day: '2-digit', month: 'short' }) },
                { label: 'Stale by', value: age },
                { label: 'POs held', value: ctx.pos.length.toLocaleString('en-IN') },
            ],
            actions: [
                { recipient: 'technical', action: 'Check the Zoho Books PO sync — the cron, the refresh token, and the last error. Nothing has landed since the date above.', deadline: 'Today' },
                { recipient: 'procurement', action: 'Until the sync is restored, do not treat a quiet Ira scan as confirmation that nothing needs attention.', deadline: 'Today' },
            ],
        };

        return { findings: [finding], cleared: null };
    },
};
