/**
 * Mint one-click feedback links for a digest.
 *
 * Reuses the repo's existing email-action token machinery verbatim
 * (backend/lib/emailActions/tokens.ts): 32 bytes of CSPRNG, stored only as a
 * SHA-256, single-use via one atomic conditional UPDATE, expiring by default in
 * 7 days. Nothing here re-implements any of that.
 *
 * ONE TOKEN PER DISPOSITION PER FINDING, because the disposition IS the click.
 * The landing page preselects it and still lets the responder change their mind
 * before submitting, so a mis-tap is recoverable.
 *
 * WHY THIS CAN RETURN NOTHING. A link is minted only when all of these hold:
 *   · APP_URL (or NEXT_PUBLIC_APP_URL) is set — else there is no absolute URL,
 *   · the recipient maps to a real users row — email_action_tokens.user_id is
 *     NOT NULL REFERENCES users(id), so an external address cannot hold a token,
 *   · the token insert succeeds — i.e. email_action_tokens exists.
 * When any fails, the strip is omitted entirely. A dead feedback button teaches
 * the reader their reply is ignored, which is worse than not asking.
 */

import { issueEmailActionToken } from '@/backend/lib/emailActions/tokens';
import { linkBase } from './types';
import { findingEntityId } from './guard';
import type { FeedbackLinks } from './render';
import type { RoutedFinding } from './router';

/** Shorter than the 7-day default: a digest is a daily artefact. */
const FEEDBACK_TTL_HOURS = 72;

import { DISPOSITIONS } from './disposition';

export interface MintFeedbackInput {
    organizationId: string;
    /** users.id of the recipient. Required — the token table will not take null. */
    userId: string;
    agentKey: string;
    /** oem_agent_runs.id when the digest was traced, else null. */
    runId: string | null;
    findings: ReadonlyArray<RoutedFinding>;
}

/**
 * Returns a map of finding.key -> signal -> absolute URL. Missing entries simply
 * do not render. Never throws.
 */
export async function mintFeedbackLinks(input: MintFeedbackInput): Promise<FeedbackLinks> {
    const base = linkBase();
    if (!base || !input.userId) return {};

    const out: FeedbackLinks = {};

    for (const finding of input.findings) {
        // Closed findings are informational; there is nothing to rate.
        if (finding.priority === 'closed') continue;

        const perSignal: FeedbackLinks[string] = {};
        for (const disposition of DISPOSITIONS) {
            let raw: string | null = null;
            try {
                raw = await issueEmailActionToken({
                    organizationId: input.organizationId,
                    userId: input.userId,
                    entityType: 'agent_feedback',
                    // A DETERMINISTIC UUID PER FINDING. This used to be
                    // `runId ?? organizationId`, and both callers passed runId
                    // null — so every token in the org shared one entity_id, and
                    // the route's revokeTokensForEntity() after a successful
                    // close burned every other feedback link in the whole
                    // organisation. Per-finding identity makes that revoke do
                    // what it says: retire the sibling buttons for THIS line only.
                    entityId: findingEntityId(input.organizationId, input.agentKey, finding.key),
                    action: disposition,
                    payload: {
                        agent_key: input.agentKey,
                        run_id: input.runId,
                        finding_key: finding.key,
                        finding_title: finding.title,
                        // Shown on the landing page so the responder can see WHICH
                        // line they are closing before they commit to an answer.
                        finding_amount: finding.amount,
                    },
                    ttlHours: FEEDBACK_TTL_HOURS,
                });
            } catch {
                raw = null;
            }
            if (raw) perSignal[disposition] = `${base}/api/email-actions/${raw}`;
        }
        if (Object.keys(perSignal).length) out[finding.key] = perSignal;
    }

    return out;
}
