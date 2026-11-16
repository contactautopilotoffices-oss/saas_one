import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Shared helpers for the checklist AI vision scorer and the checker review loop.
 * Server only (uses the service role client).
 */

export const PARAM_STATUSES = ['pass', 'needs_attention', 'fail', 'not_visible'] as const;
export type ParamStatus = typeof PARAM_STATUSES[number];

/** Lower-cased, trimmed, single-spaced parameter name used to share learning across checklists. */
export function normalizeParamKey(name: string): string {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Loads an image for server-side processing.
 * Photos are saved as relative proxy links (`/api/storage/<bucket>/<path>`). Node's fetch cannot
 * load a relative URL, so those are read straight from Supabase storage instead.
 * Absolute URLs (older rows, public storage links) are fetched as before.
 */
export async function loadImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
    if (!url || typeof url !== 'string') return null;
    try {
        const proxyMatch = url.match(/^\/api\/storage\/([^/?#]+)\/([^?#]+)/);
        if (proxyMatch) {
            const bucket = decodeURIComponent(proxyMatch[1]);
            const objectPath = proxyMatch[2].split('/').map(decodeURIComponent).join('/');
            const { data, error } = await supabaseAdmin.storage.from(bucket).download(objectPath);
            if (error || !data) {
                console.error(`[AI Score] Storage download failed for ${bucket}/${objectPath}:`, error?.message);
                return null;
            }
            return Buffer.from(await data.arrayBuffer());
        }
        if (!/^https?:\/\//i.test(url)) {
            console.error('[AI Score] Unsupported image URL (not absolute, not a storage proxy link):', url);
            return null;
        }
        const res = await fetch(url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch (err) {
        console.error('[AI Score] Image load failed:', url, err);
        return null;
    }
}

const ADMIN_ROLES = ['property_admin', 'org_admin', 'org_super_admin', 'master_admin', 'ops_super_admin'];
const ORG_ADMIN_ROLES = ['org_admin', 'org_super_admin', 'master_admin', 'ops_super_admin'];

/**
 * Who may sign off steps and correct the AI for a property:
 * property / org admins (same roles as the rating route), or the checker assigned
 * in checklist settings (checklist_property_settings.approver_user_id).
 */
export async function canReviewChecklist(userId: string, propertyId: string): Promise<{ allowed: boolean; organizationId: string | null }> {
    const { data: prop } = await supabaseAdmin
        .from('properties')
        .select('organization_id')
        .eq('id', propertyId)
        .maybeSingle();
    const organizationId: string | null = prop?.organization_id ?? null;

    const [propMembershipRes, orgMembershipRes, settingsRes] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('role')
            .eq('property_id', propertyId)
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle(),
        organizationId
            ? supabaseAdmin
                .from('organization_memberships')
                .select('role')
                .eq('organization_id', organizationId)
                .eq('user_id', userId)
                .eq('is_active', true)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        supabaseAdmin
            .from('checklist_property_settings')
            .select('approver_user_id')
            .eq('property_id', propertyId)
            .maybeSingle(),
    ]);

    const propRole = String(propMembershipRes.data?.role || '').toLowerCase();
    const orgRole = String((orgMembershipRes as any).data?.role || '').toLowerCase();
    const isAssignedChecker = Boolean(settingsRes.data?.approver_user_id) && settingsRes.data?.approver_user_id === userId;

    return {
        allowed: ADMIN_ROLES.includes(propRole) || ORG_ADMIN_ROLES.includes(orgRole) || isAssignedChecker,
        organizationId,
    };
}

export interface FeedbackRule {
    parameter_name: string;
    scope: 'this_step' | 'similar_steps';
    ai_status: string | null;
    verdict: 'correct' | 'incorrect';
    corrected_status: ParamStatus | null;
    guidance: string | null;
}

/**
 * Checker corrections to show the AI as standing rules:
 * 1. recent corrections on this exact checklist step, and
 * 2. recent corrections on parameters with the same name anywhere in the organization.
 * Returns [] if the feedback table does not exist yet (migration not applied).
 */
export async function loadFeedbackRules(params: {
    organizationId: string | null;
    checklistItemId: string;
    parameterNames: string[];
}): Promise<FeedbackRule[]> {
    const { organizationId, checklistItemId, parameterNames } = params;
    const keys = Array.from(new Set(parameterNames.map(normalizeParamKey).filter(Boolean)));
    const cols = 'id, checklist_item_id, parameter_name, parameter_key, ai_status, verdict, corrected_status, guidance, created_at';

    try {
        const [stepRes, orgRes] = await Promise.all([
            supabaseAdmin
                .from('sop_ai_feedback')
                .select(cols)
                .eq('checklist_item_id', checklistItemId)
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(20),
            organizationId && keys.length > 0
                ? supabaseAdmin
                    .from('sop_ai_feedback')
                    .select(cols)
                    .eq('organization_id', organizationId)
                    .in('parameter_key', keys)
                    .neq('checklist_item_id', checklistItemId)
                    .eq('is_active', true)
                    .order('created_at', { ascending: false })
                    .limit(30)
                : Promise.resolve({ data: [], error: null }),
        ]);

        if (stepRes.error) {
            console.warn('[AI Score] Feedback rules unavailable:', stepRes.error.message);
            return [];
        }

        // Prefer corrections (incorrect) and anything with written guidance; skip bare "correct" clicks
        // from other steps, they add tokens without teaching anything new.
        const seen = new Set<string>();
        const rules: FeedbackRule[] = [];
        const push = (row: any, scope: FeedbackRule['scope']) => {
            if (scope === 'similar_steps' && row.verdict === 'correct' && !row.guidance) return;
            const dedupeKey = `${row.parameter_key}|${row.verdict}|${row.corrected_status}|${(row.guidance || '').trim().toLowerCase()}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            rules.push({
                parameter_name: row.parameter_name,
                scope,
                ai_status: row.ai_status,
                verdict: row.verdict,
                corrected_status: row.corrected_status,
                guidance: row.guidance,
            });
        };
        (stepRes.data || []).forEach((r: any) => push(r, 'this_step'));
        ((orgRes as any).data || []).forEach((r: any) => push(r, 'similar_steps'));
        return rules.slice(0, 25);
    } catch (err) {
        console.warn('[AI Score] Feedback rules load failed:', err);
        return [];
    }
}

/** Renders feedback rules as a prompt block. Empty string when there are none. */
export function formatFeedbackRules(rules: FeedbackRule[]): string {
    if (rules.length === 0) return '';
    const label = (s: string | null) => (s ? s.replace('_', ' ') : 'unknown');
    const lines = rules.map((r) => {
        const where = r.scope === 'this_step' ? 'this step' : 'a similar step';
        const verdict = r.verdict === 'correct'
            ? `checker confirmed "${label(r.ai_status)}" was right`
            : `AI said "${label(r.ai_status)}" but checker corrected it to "${label(r.corrected_status)}"`;
        return `- [${where}] "${r.parameter_name}": ${verdict}${r.guidance ? `. Checker note: ${r.guidance}` : ''}`;
    });
    return `CHECKER CORRECTIONS (standing rules from human reviewers, follow them when the same situation appears):\n${lines.join('\n')}\n`;
}
