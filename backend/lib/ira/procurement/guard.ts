/**
 * Membership gate + per-finding token identity.
 *
 * Both exist because an adversarial review of this module found two real holes:
 *
 *   1. The digest routes validated `orgId` as a UUID and nothing else, then
 *      minted LIVE email_action_tokens stamped with that org and rendered the raw
 *      tokens into the HTTP response. Any signed-in user who knew another org's
 *      UUID — they appear in dashboard URLs — could scrape working tokens and
 *      write into that org's agent-feedback queue. RLS was no backstop, because
 *      tokens are inserted with the service-role client.
 *
 *   2. Every feedback token shared one entity_id (the org), and the route calls
 *      revokeTokensForEntity() after a successful action. So the FIRST person to
 *      close ONE line silently killed every other outstanding feedback link in
 *      the entire organisation.
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * True when this user may act on this org. Master admins pass; everyone else
 * needs an active organization_membership or property_membership.
 *
 * Mirrors requireOrgAdmin() in app/api/agents/registry/route.ts, minus the role
 * requirement — reading one's own digest is not an admin action.
 */
export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
    if (!orgId || !userId) return false;

    const [profile, orgs, props] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', userId).maybeSingle(),
        supabaseAdmin.from('organization_memberships')
            .select('organization_id').eq('user_id', userId).eq('is_active', true),
        supabaseAdmin.from('property_memberships')
            .select('organization_id').eq('user_id', userId).eq('is_active', true),
    ]);

    if (profile.data?.is_master_admin) return true;
    const rows = [...(orgs.data ?? []), ...(props.data ?? [])] as Array<{ organization_id: string | null }>;
    return rows.some((r) => r.organization_id === orgId);
}

/**
 * A STABLE, DISTINCT entity id per finding.
 *
 * email_action_tokens.entity_id is `uuid NOT NULL`, but a finding is keyed by
 * text. Hashing (org, agent, finding_key) into a deterministic UUID gives every
 * finding its own identity, so revokeTokensForEntity() — which matches on
 * (entity_type, entity_id) — burns only the sibling links for THAT line, which
 * is exactly the intended semantic: once a line is closed, its other buttons
 * should stop working, and no others should.
 *
 * Deterministic on purpose: the same finding re-issued in tomorrow's digest maps
 * to the same entity, so yesterday's unclicked links are correctly superseded.
 *
 * RFC 4122 §4.3 name-based layout (version 5 bits), computed with SHA-256 rather
 * than SHA-1. It is an identifier, not a security boundary — the security is the
 * 32-byte random token itself.
 */
export function findingEntityId(orgId: string, agentKey: string, findingKey: string): string {
    const h = createHash('sha256').update(`${orgId}:${agentKey}:${findingKey}`).digest();
    const b = Buffer.from(h.subarray(0, 16));
    b[6] = (b[6] & 0x0f) | 0x50; // version 5
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = b.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
