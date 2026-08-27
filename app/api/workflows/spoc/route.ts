import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { SPOC_DOMAINS, SpocDomain, isSpocDomain, resolveSpoc, listSpocRules } from '@/backend/lib/workflow/resolveSpoc';

/**
 * SPOC / escalation matrix rules — GET (list) and PUT (upsert a grid).
 *
 * Auth shape copied from backend/lib/accounts/access.ts (session first, bearer token
 * fallback, memberships read with the service role, org id resolved from the request
 * or from the caller's single org). resolveAccountsAccess itself is NOT reused: it is
 * scoped to the payment ledger and deliberately excludes property_admin, whereas this
 * matrix also covers the ticket domain that property admins run.
 *
 * Who may do what:
 *   READ  : any active member of the org (org or property membership).
 *   WRITE : org_super_admin / org_admin / master_admin only, at every scope.
 *
 * The write rule is deliberately TIGHTER than escalation_hierarchies RLS, which also
 * lets a property_admin author rules scoped to their own property
 * (backend/db/migrations/20260311_escalation_hierarchy.sql:99-108). A SPOC rule decides
 * who gets paged for procurement and payment work, not just tickets, so delegating it to
 * site admins is a decision for the org, not a default. propertyAdminOf is still resolved
 * so widening this later is a one-line change to canWriteScope.
 */

const ORG_ADMIN_ROLES = ['org_super_admin', 'org_admin', 'master_admin'];
// Staff-role allowlist for READ. The matrix names who gets paged for procurement,
// petty-cash and payment work, and the grid embeds each SPOC's full_name, so external
// parties who happen to hold a membership row — tenants, super_tenants, vendors,
// maintenance vendors — must not see it. resolveAccountsAccess filters memberships to
// VIEW_ROLES *before* deriving orgIds (backend/lib/accounts/access.ts:86-88) for the
// same reason; this mirrors that, widened to include the site roles that run tickets.
const STAFF_ROLES = [
    'org_super_admin', 'org_admin', 'master_admin',
    'purchase_manager', 'purchase_executive', 'procurement', 'accounts',
    'property_admin', 'manager_executive', 'soft_service_manager', 'soft_service_supervisor',
    'soft_service_staff', 'mst', 'security', 'staff', 'bd_admin', 'bd_rep',
];
const MAX_RULES_PER_REQUEST = 200;
// property_id reaches an .or() filter string below, which PostgREST does not
// parameterise — only ever interpolate something that is provably a UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WorkflowAccess {
    user: { id: string; email?: string };
    organizationId: string;
    isMasterAdmin: boolean;
    isOrgAdmin: boolean;
    /** properties where the caller is property_admin (write scope for property rules) */
    propertyAdminOf: string[];
    roles: string[];
}

interface RuleInput {
    stage: string;
    level: number;
    spoc_user_id: string | null;
    spoc_role: string | null;
    sla_hours: number | null;
    /** null = caller did not send the field; keep whatever the stored row has */
    is_active: boolean | null;
    /** both actors empty = clear this cell */
    clear: boolean;
}

// The grid labels each cell with its person, so the rule read embeds the named user.
// Reads go through listSpocRules so they page past PostgREST's 1000-row ceiling.
const SPOC_EMBED = 'created_at, updated_at, spoc:users!workflow_spoc_rules_spoc_user_id_fkey(id, full_name, email)';

async function authenticate(request: NextRequest): Promise<{ id: string; email?: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id, email: user.email ?? undefined };

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id, email: tokenUser.email ?? undefined };
    }
    return null;
}

function readOrgId(request: NextRequest, body?: any): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('org_id') || sp.get('organization_id') || sp.get('orgId') ||
        body?.organization_id || body?.org_id || null
    );
}

async function resolveWorkflowAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<WorkflowAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabaseAdmin
        .from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
    const isMasterAdmin = !!profile?.is_master_admin;

    const [propRes, orgRes] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('organization_id, property_id, role')
            .eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', user.id).eq('is_active', true),
    ]);

    const propMemberships = (propRes.data || []) as { organization_id: string | null; property_id: string | null; role: string | null }[];
    const memberships = [...propMemberships, ...((orgRes.data || []) as { organization_id: string | null; role: string | null }[])];

    // Only STAFF memberships confer access. Deriving orgIds from every membership row let
    // a tenant / super_tenant / vendor read the whole matrix, including each named SPOC's
    // full_name and email via the service-role embed.
    const staffMemberships = memberships.filter(m => m.role && STAFF_ROLES.includes(m.role));
    const orgIds = [...new Set(staffMemberships.map(m => m.organization_id).filter(Boolean))] as string[];
    let organizationId: string | null = requestedOrgId || null;

    if (organizationId) {
        if (!(isMasterAdmin || orgIds.includes(organizationId)))
            return NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1) {
        return NextResponse.json({ error: 'organization_id is required (multiple organizations)' }, { status: 400 });
    } else if (isMasterAdmin) {
        return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    } else {
        return NextResponse.json({ error: 'Forbidden: no workflow access' }, { status: 403 });
    }

    const roles = [...new Set(
        memberships.filter(m => m.organization_id === organizationId && m.role).map(m => m.role as string),
    )];
    const propertyAdminOf = [...new Set(
        propMemberships
            .filter(m => m.organization_id === organizationId && m.role === 'property_admin' && m.property_id)
            .map(m => m.property_id as string),
    )];

    return {
        user,
        organizationId,
        isMasterAdmin,
        isOrgAdmin: isMasterAdmin || roles.some(r => ORG_ADMIN_ROLES.includes(r)),
        propertyAdminOf,
        roles,
    };
}

const canWrite = (access: WorkflowAccess) => access.isOrgAdmin;

/** Normalise + validate one grid cell. Returns the error string on rejection. */
function parseRule(raw: any): RuleInput | string {
    const stage = String(raw?.stage ?? '').trim();
    if (!stage) return 'Every rule needs a stage';
    const level = Number(raw?.level);
    if (!Number.isInteger(level) || level < 1 || level > 10) return `Level must be an integer 1-10 (got "${raw?.level}")`;

    const spocUserId = raw?.spoc_user_id ? String(raw.spoc_user_id) : null;
    const spocRole = raw?.spoc_role ? String(raw.spoc_role).trim() : null;

    let slaHours: number | null = null;
    if (raw?.sla_hours != null && raw.sla_hours !== '') {
        slaHours = Number(raw.sla_hours);
        if (!Number.isInteger(slaHours) || slaHours <= 0) return 'sla_hours must be a positive whole number of hours';
    }

    return {
        stage,
        level,
        spoc_user_id: spocUserId,
        spoc_role: spocRole || null,
        sla_hours: slaHours,
        // undefined means "the caller did not express an opinion" — NOT "activate". The
        // grid never sends this field, so defaulting it to true made any unrelated save
        // silently re-arm a rung an operator had deliberately switched off.
        is_active: raw?.is_active === undefined ? null : !!raw.is_active,
        // An empty cell is a deletion, not a constraint violation — the grid clears cells.
        clear: !spocUserId && !spocRole,
    };
}

// GET /api/workflows/spoc — list rules for a scope.
// ?domain=…&property_id=…  (property_id=none limits to org-wide rules)
// ?resolve=1&domain=&stage=[&level=] additionally returns the resolved notify list.
export async function GET(request: NextRequest) {
    const access = await resolveWorkflowAccess(request, readOrgId(request));
    if (access instanceof NextResponse) return access;

    const sp = new URL(request.url).searchParams;
    const domain = sp.get('domain');
    const propertyParam = sp.get('property_id') || sp.get('propertyId');

    if (domain && !isSpocDomain(domain)) {
        return NextResponse.json({ error: `domain must be one of ${SPOC_DOMAINS.join(', ')}` }, { status: 400 });
    }
    if (propertyParam && propertyParam !== 'none' && !UUID_RE.test(propertyParam)) {
        return NextResponse.json({ error: 'property_id must be a uuid (or "none")' }, { status: 400 });
    }

    // Default: org-wide rules plus this property's overrides, so the grid can show what
    // a property inherits. 'none' narrows to the org-wide layer only.
    const scopedPropertyId = propertyParam && propertyParam !== 'none' ? propertyParam : null;

    let rules;
    try {
        rules = await listSpocRules({
            organizationId: access.organizationId,
            propertyId: scopedPropertyId,
            domain: domain as SpocDomain | null,
            includeInactive: true,
            embed: SPOC_EMBED,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Failed to read the SPOC matrix' }, { status: 500 });
    }

    const payload: Record<string, unknown> = {
        rules,
        domains: SPOC_DOMAINS,
        can_edit: canWrite(access),
        // Non-null once property_admin delegation is enabled; today always empty.
        editable_property_ids: access.isOrgAdmin ? null : [],
    };

    const stage = sp.get('stage');
    if (sp.get('resolve') && domain && stage) {
        const levelParam = sp.get('level');
        const level = levelParam ? Number(levelParam) : null;
        if (level != null && !Number.isInteger(level)) {
            return NextResponse.json({ error: 'level must be an integer' }, { status: 400 });
        }
        payload.resolution = await resolveSpoc({
            organizationId: access.organizationId,
            propertyId: scopedPropertyId,
            domain: domain as SpocDomain,
            stage,
            level,
        });
    }

    return NextResponse.json(payload);
}

// PUT /api/workflows/spoc — upsert one scope's grid.
// { organization_id, property_id?, domain, rules: [{ stage, level, spoc_user_id?, spoc_role?, sla_hours?, is_active? }] }
// A rule with neither spoc_user_id nor spoc_role deletes that cell.
export async function PUT(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveWorkflowAccess(request, readOrgId(request, body));
    if (access instanceof NextResponse) return access;

    const domain = body.domain;
    if (!isSpocDomain(domain)) {
        return NextResponse.json({ error: `domain must be one of ${SPOC_DOMAINS.join(', ')}` }, { status: 400 });
    }

    const propertyId: string | null = body.property_id || body.propertyId || null;
    if (propertyId && !UUID_RE.test(propertyId)) {
        return NextResponse.json({ error: 'property_id must be a uuid' }, { status: 400 });
    }
    if (!canWrite(access)) {
        return NextResponse.json({ error: 'Forbidden: only org admins may edit the SPOC matrix' }, { status: 403 });
    }
    // The FK only proves the property exists, not that it is THIS org's — without this a
    // valid uuid from another tenant would be accepted and stored.
    if (propertyId) {
        const { data: prop } = await supabaseAdmin
            .from('properties').select('id').eq('id', propertyId).eq('organization_id', access.organizationId).maybeSingle();
        if (!prop) return NextResponse.json({ error: 'Property not found in this organization' }, { status: 404 });
    }

    const rawRules = Array.isArray(body.rules) ? body.rules : (body.stage ? [body] : null);
    if (!rawRules || rawRules.length === 0) {
        return NextResponse.json({ error: 'rules must be a non-empty array' }, { status: 400 });
    }
    if (rawRules.length > MAX_RULES_PER_REQUEST) {
        return NextResponse.json({ error: `At most ${MAX_RULES_PER_REQUEST} rules per request` }, { status: 400 });
    }

    const rules: RuleInput[] = [];
    const seen = new Set<string>();
    for (const raw of rawRules) {
        const parsed = parseRule(raw);
        if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 });
        const key = `${parsed.stage}::${parsed.level}`;
        if (seen.has(key)) return NextResponse.json({ error: `Duplicate rule for ${parsed.stage} level ${parsed.level}` }, { status: 400 });
        seen.add(key);
        rules.push(parsed);
    }

    // Every named person must be an ACTIVE MEMBER OF THIS ORG, not merely a row in
    // `users`. A global existence check accepted another tenant's user id — the FK only
    // proves the user exists — which both leaked their full_name/email back through the
    // GET embed and let resolveSpoc address an outsider with this org's amounts and
    // approval links. Same shape as app/api/crm/leads/route.ts:159-168.
    const userIds = [...new Set(rules.map(r => r.spoc_user_id).filter(Boolean))] as string[];
    if (userIds.length > 0) {
        const [orgM, propM] = await Promise.all([
            supabaseAdmin.from('organization_memberships').select('user_id')
                .eq('organization_id', access.organizationId).eq('is_active', true).in('user_id', userIds),
            supabaseAdmin.from('property_memberships').select('user_id')
                .eq('organization_id', access.organizationId).eq('is_active', true).in('user_id', userIds),
        ]);
        const members = new Set(
            [...(orgM.data || []), ...(propM.data || [])].map((m: any) => m.user_id as string),
        );
        const missing = userIds.filter(id => !members.has(id));
        if (missing.length > 0) {
            return NextResponse.json(
                { error: `Not an active member of this organization: ${missing.join(', ')}` },
                { status: 400 },
            );
        }
    }

    // Existing rows for exactly this scope — editing a property must never clobber the
    // org-wide layer it inherits, so exactScope pins property_id rather than falling back.
    let existing;
    try {
        existing = await listSpocRules({
            organizationId: access.organizationId,
            propertyId,
            domain,
            exactScope: true,
            includeInactive: true,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Failed to read the SPOC matrix' }, { status: 500 });
    }

    const byKey = new Map<string, { id: string; is_active: boolean }>();
    for (const row of existing) byKey.set(`${row.stage}::${row.level}`, { id: row.id, is_active: row.is_active });

    const now = new Date().toISOString();
    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const deletes: string[] = [];

    for (const rule of rules) {
        const prior = byKey.get(`${rule.stage}::${rule.level}`);
        if (rule.clear) {
            if (prior) deletes.push(prior.id);
            continue;
        }
        // Absent is_active keeps the stored value on an update, and only defaults to true
        // for a brand-new row.
        const values = {
            spoc_user_id: rule.spoc_user_id,
            spoc_role: rule.spoc_role,
            sla_hours: rule.sla_hours,
            is_active: rule.is_active ?? (prior ? prior.is_active : true),
            updated_at: now,
        };
        if (prior) updates.push({ id: prior.id, patch: values });
        else inserts.push({
            organization_id: access.organizationId,
            property_id: propertyId,
            domain,
            stage: rule.stage,
            level: rule.level,
            created_by: access.user.id,
            ...values,
        });
    }

    if (inserts.length > 0) {
        const { error } = await supabaseAdmin.from('workflow_spoc_rules').insert(inserts);
        // 23505 = the (org, property, domain, stage, level) unique index. Two admins saved
        // the same grid at once; the loser retries against the winner's rows.
        if (error?.code === '23505') {
            return NextResponse.json({ error: 'This matrix changed while you were editing it — refresh and save again' }, { status: 409 });
        }
        if (error) return NextResponse.json({ error: `Create failed: ${error.message}` }, { status: 500 });
    }
    for (const upd of updates) {
        const { error } = await supabaseAdmin.from('workflow_spoc_rules').update(upd.patch).eq('id', upd.id);
        if (error) return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });
    }
    if (deletes.length > 0) {
        const { error } = await supabaseAdmin.from('workflow_spoc_rules').delete().in('id', deletes);
        if (error) return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
    }

    const refreshed = await listSpocRules({
        organizationId: access.organizationId,
        propertyId,
        domain,
        exactScope: true,
        includeInactive: true,
        embed: SPOC_EMBED,
    }).catch(() => []);

    return NextResponse.json({
        rules: refreshed,
        created: inserts.length,
        updated: updates.length,
        deleted: deletes.length,
    });
}
