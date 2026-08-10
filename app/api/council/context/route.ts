import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError, resolveCouncilOrgId } from '@/backend/lib/council/guard';

/**
 * Business context intake — how a human teaches the council the business.
 *
 *   GET  /api/council/context            everything on file, plus a coverage report
 *   POST /api/council/context {entries}  upsert a batch (idempotent per
 *                                        kind+subject+title, so a corrected sheet can be
 *                                        re-sent without duplicating)
 *
 * Designed for BATCH import because the people who hold this knowledge (Dipti, Naresh)
 * will produce it as a sheet, not as thirty individual form submissions. The template
 * they fill is documented in docs/COUNCIL_BUSINESS_CONTEXT.md and maps 1:1 to `entries`.
 *
 * Master-admin only — this is the council's ground truth, and a wrong KRA here silently
 * re-weights every future audit.
 */

export const dynamic = 'force-dynamic';

const KINDS = new Set(['kra', 'role_definition', 'site_profile', 'client_profile', 'hierarchy', 'glossary', 'policy']);
const SUBJECTS = new Set(['role', 'team', 'property', 'organization', 'global']);

const MIGRATION_HINT =
    'If this mentions a missing relation, apply supabase/migrations/20260803000003_council_business_context.sql';

interface Entry {
    kind?: string; subject_type?: string; subject_key?: string;
    title?: string; body?: string;
    attributes?: Record<string, unknown>; provided_by?: string; source_note?: string;
}

export async function GET(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;
    const orgId = await resolveCouncilOrgId(access, request, {});

    const { data, error } = await access.adminClient
        .from('council_business_context')
        .select('*')
        .eq('org_id', orgId)
        .order('kind')
        .order('subject_key')
        .range(0, 4999);

    if (error) {
        console.error('[council/context] list:', error.message);
        return NextResponse.json({ error: 'Could not load business context', details: error.message, hint: MIGRATION_HINT }, { status: 500 });
    }

    const rows = data || [];
    const byKind: Record<string, number> = {};
    for (const r of rows as { kind: string }[]) byKind[r.kind] = (byKind[r.kind] || 0) + 1;

    // The roles actually present, so the caller can see which ones still lack a KRA
    // rather than having to diff two lists by hand.
    const { data: members } = await access.adminClient
        .from('organization_memberships')
        .select('role')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .range(0, 4999);
    const roles = [...new Set((members || []).map(m => (m as { role: string | null }).role).filter(Boolean))] as string[];
    const withKra = new Set(
        (rows as { kind: string; subject_type: string; subject_key: string }[])
            .filter(r => r.kind === 'kra' && r.subject_type === 'role')
            .map(r => r.subject_key),
    );

    return NextResponse.json({
        entries: rows,
        by_kind: byKind,
        coverage: {
            roles_in_org: roles.length,
            roles_with_kra: [...withKra].filter(r => roles.includes(r)).length,
            roles_missing_kra: roles.filter(r => !withKra.has(r)),
        },
    });
}

export async function POST(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    let body: { entries?: Entry[]; org_id?: string } = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const orgId = await resolveCouncilOrgId(access, request, body);
    const entries = Array.isArray(body.entries) ? body.entries : null;
    if (!entries || !entries.length) {
        return NextResponse.json({ error: 'entries[] is required' }, { status: 400 });
    }
    if (entries.length > 500) {
        return NextResponse.json({ error: 'Send at most 500 entries per request' }, { status: 400 });
    }

    // Validate the WHOLE batch before writing any of it. A half-imported context sheet is
    // worse than a rejected one: the council would run on a partial business model and
    // nobody would know which half landed.
    const rows: Record<string, unknown>[] = [];
    const problems: string[] = [];
    entries.forEach((e, i) => {
        const where = `entries[${i}]`;
        if (!e.kind || !KINDS.has(e.kind)) problems.push(`${where}.kind must be one of ${[...KINDS].join(', ')}`);
        if (!e.subject_type || !SUBJECTS.has(e.subject_type)) problems.push(`${where}.subject_type must be one of ${[...SUBJECTS].join(', ')}`);
        if (!e.subject_key?.trim()) problems.push(`${where}.subject_key is required (the role/team/site this is about)`);
        if (!e.title?.trim()) problems.push(`${where}.title is required`);
        if (!e.body?.trim()) problems.push(`${where}.body is required`);
        if (e.attributes && (typeof e.attributes !== 'object' || Array.isArray(e.attributes))) {
            problems.push(`${where}.attributes must be an object`);
        }
        if (problems.length) return;
        rows.push({
            org_id: orgId,
            kind: e.kind,
            subject_type: e.subject_type,
            subject_key: e.subject_key!.trim(),
            title: e.title!.trim(),
            body: e.body!.trim(),
            attributes: e.attributes || {},
            provided_by: e.provided_by?.trim() || null,
            source_note: e.source_note?.trim() || null,
            is_active: true,
            created_by: access.user.id,
            updated_at: new Date().toISOString(),
        });
    });

    if (problems.length) {
        return NextResponse.json({ error: 'Some entries are invalid — nothing was imported', problems: problems.slice(0, 20) }, { status: 400 });
    }

    const { data, error } = await access.adminClient
        .from('council_business_context')
        .upsert(rows, { onConflict: 'org_id,kind,subject_type,subject_key,title' })
        .select('id');

    if (error) {
        console.error('[council/context] upsert:', error.message);
        return NextResponse.json({ error: 'Could not save business context', details: error.message, hint: MIGRATION_HINT }, { status: 500 });
    }

    return NextResponse.json({ ok: true, imported: data?.length ?? rows.length });
}
