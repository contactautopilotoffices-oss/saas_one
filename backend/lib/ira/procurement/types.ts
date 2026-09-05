/**
 * PROCUREMENT AGENT — the structured exception, and verified deep links.
 * -----------------------------------------------------------------------------
 * Per docs/IRA_ARCHITECTURE_DECISION.md: the AI DETECTS and ADJUDICATES; the
 * deterministic layer owns numbers, state and dispatch. This file is the contract
 * between the two.
 *
 * THE AI RETURNS A `Finding`. It never returns HTML, never a recipient list, and
 * never a URL. Layout is the renderer's job, routing is the router's job, and a
 * URL the model composed would be a fabrication by construction — it has no way
 * to know whether the record exists.
 *
 * Doctrine note: an LLM re-deriving operational numbers is exactly what the
 * architecture decision forbids — metrics get one deterministic writer. `amount`
 * is therefore filled from SQL by the detector, not by the model.
 */

/** Who can be asked to act. Fixed set: routing must never be model-invented. */
export type RecipientKey = 'ceo' | 'procurement' | 'technical';

export type Priority = 'critical' | 'action' | 'watch' | 'closed';

/** What kind of record an identifier points at. Decides which URL builder runs. */
export type EntityKind = 'po' | 'property' | 'vendor' | 'invoice' | 'ticket' | 'requisition';

/**
 * A reference to a real record. `id` is the database key used to build the URL;
 * `label` is what a human reads. A ref with no `id` renders as plain text —
 * never as a link — because a link we cannot verify is worse than no link.
 */
export interface EntityRef {
    kind: EntityKind;
    /** Human-facing identifier, e.g. 'PO-26/27-0323'. Always shown. */
    label: string;
    /** DB id used to construct the deep link. Null when we could not resolve it. */
    id: string | null;
}

/** One action, addressed to exactly one recipient. */
export interface RecipientAction {
    recipient: RecipientKey;
    /** Imperative, one line. What THIS person does. */
    action: string;
    deadline: string | null;
}

/**
 * One adjudicated problem. This is what the AI returns (minus `amount`, which
 * the detector fills from SQL, and minus `refs[].id`, which is resolved here).
 */
export interface Finding {
    key: string;
    priority: Priority;
    title: string;
    /** Vendor / property context, already resolved to real names. */
    vendor: string | null;
    property: string | null;
    /** Rupees. From SQL. Null when the finding is not monetary. */
    amount: number | null;
    /** One or two sentences. What is wrong. No prose essays. */
    problem: string;
    /** Records that evidence it. Rendered as links when resolvable. */
    refs: EntityRef[];
    /** Per-recipient actions. The SAME finding says different things to different people. */
    actions: RecipientAction[];
    /** Optional supporting numbers rendered as a small stat row. */
    stats?: Array<{ label: string; value: string }>;
}

/* ---------------------------------------------------------------------------
 * Deep links — the "never fabricate a URL" rule, enforced in one place.
 * ------------------------------------------------------------------------- */

/**
 * Base URL for links. Read at call time, not module load, so a deployment that
 * sets it later is not stuck with a stale empty value.
 *
 * NOTE: on this deployment APP_URL and NEXT_PUBLIC_APP_URL are both EMPTY. That
 * is not a bug to route around — with no base URL there is no verifiable link,
 * so every ref degrades to plain text and the email says so. Set either var and
 * links appear with no other change.
 */
export function linkBase(): string | null {
    // NEXT_PUBLIC_APP_URL FIRST, deliberately. APP_URL on this deployment is a
    // LAN address (http://168.144.179.206:3000) — fine for server-to-server, dead
    // in an executive's inbox on a phone off the office network. An email link
    // must be the publicly reachable host or it is worse than no link.
    const raw = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/^"|"$/g, '');
    if (!raw) return null;
    try {
        const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        return u.origin;
    } catch {
        return null;
    }
}

/**
 * Build the deep link for a ref, or return null.
 *
 * Returns null — meaning "render as plain text" — whenever ANY of these hold:
 *   · no base URL is configured,
 *   · the ref carries no id,
 *   · this entity kind has no detail page in the app.
 *
 * There is deliberately no fallback that guesses a path. A dead link in an
 * executive's inbox costs more trust than a missing one.
 */
export function entityUrl(ref: EntityRef, orgId: string): string | null {
    const base = linkBase();
    if (!base || !ref.id || !orgId) return null;

    switch (ref.kind) {
        case 'po':
            // app/(dashboard)/[orgId]/accounts/po/[poId]/page.tsx
            return `${base}/${orgId}/accounts/po/${encodeURIComponent(ref.id)}`;
        case 'property':
            // app/(dashboard)/[orgId]/properties/[propertyId]/dashboard/page.tsx
            return `${base}/${orgId}/properties/${encodeURIComponent(ref.id)}/dashboard`;
        case 'requisition':
            return `${base}/${orgId}/procurement-management`;
        case 'vendor':
        case 'invoice':
        case 'ticket':
            // No verified detail route for these yet. Plain text until there is.
            return null;
        default:
            return null;
    }
}

/** True when at least one ref in the set can be linked. Drives the email's notice. */
export function anyLinkable(findings: ReadonlyArray<Finding>, orgId: string): boolean {
    return findings.some((f) => f.refs.some((r) => entityUrl(r, orgId) !== null));
}
