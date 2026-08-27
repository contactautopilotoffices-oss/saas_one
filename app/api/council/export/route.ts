import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';
import { buildCouncilAuditWorkbook } from '@/backend/lib/council/auditExport';
import { buildCouncilAuditPdf } from '@/backend/lib/council/auditPdf';

/**
 * GET /api/council/export?session=<id>&format=pdf|xlsx   (default: pdf)
 *
 * Two artifacts from one session, for two different jobs:
 *   pdf  — the read-only document you forward to a CEO or attach to a board pack.
 *          Cover, chairman synthesis, severity-ordered findings register with evidence
 *          and ask, and the evidence pack showing which sections were readable.
 *   xlsx — the working register the ops team sorts, filters and edits.
 *
 * Layout lives in backend/lib/council/auditPdf.ts and auditExport.ts; this route only
 * guards, fetches and streams.
 *
 * Master-admin only, guard copied from app/api/master-admin-chatbot/route.ts.
 */

export const dynamic = 'force-dynamic';
// Chromium launch + render on a long audit comfortably exceeds the default budget.
export const maxDuration = 120;

const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

/** Table missing = migration not applied yet (same check as backend/lib/aop/access.ts). */
function isMissingRelation(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

const MIGRATION_ERROR = 'Council migration not applied — run supabase/migrations/20260803000001_agent_council.sql';

type GuardResult =
    | { ok: true; adminClient: ReturnType<typeof createAdminClient>; organizationId: string }
    | { ok: false; response: NextResponse };

async function requireMasterAdmin(): Promise<GuardResult> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
        .from('users')
        .select('is_master_admin')
        .eq('id', user.id)
        .single();

    if (!profile?.is_master_admin) {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }

    const { data: memberships } = await adminClient
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1);

    return { ok: true, adminClient, organizationId: memberships?.[0]?.organization_id || DEFAULT_ORG_ID };
}

export async function GET(request: NextRequest) {
    const guard = await requireMasterAdmin();
    if (!guard.ok) return guard.response;
    const { adminClient, organizationId } = guard;

    const sp = new URL(request.url).searchParams;
    const sessionId = sp.get('session');
    const format = sp.get('format') || 'pdf';

    if (!sessionId) {
        return NextResponse.json({ error: 'session is required' }, { status: 400 });
    }
    if (format !== 'xlsx' && format !== 'pdf') {
        return NextResponse.json({ error: 'format must be pdf or xlsx' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await adminClient
        .from('council_sessions')
        .select('id, question, status, trigger, created_at, completed_at, data_pack')
        .eq('id', sessionId)
        .eq('org_id', organizationId)
        .maybeSingle();

    if (sessionError) {
        if (isMissingRelation(sessionError)) {
            return NextResponse.json({ error: MIGRATION_ERROR }, { status: 500 });
        }
        console.error('[council export] session:', sessionError.message);
        return NextResponse.json({ error: 'Could not load the session' }, { status: 500 });
    }
    if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Chairman synthesis = the stage-3 message; findings = the session's register.
    // Both reads are independent of each other, so they go out together.
    const [synthesisRes, findingsRes, orgRes] = await Promise.all([
        adminClient
            .from('council_messages')
            .select('content')
            .eq('session_id', sessionId)
            .eq('stage', 'synthesis')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        adminClient
            .from('council_findings')
            .select('agent_key, severity, title, detail, evidence, recommendation, status')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true }),
        adminClient
            .from('organizations')
            .select('name')
            .eq('id', organizationId)
            .maybeSingle(),
    ]);

    for (const res of [synthesisRes, findingsRes]) {
        if (res.error) {
            if (isMissingRelation(res.error)) {
                return NextResponse.json({ error: MIGRATION_ERROR }, { status: 500 });
            }
            console.error('[council export] data:', res.error.message);
            return NextResponse.json({ error: 'Could not load the session data' }, { status: 500 });
        }
    }

    const orgName = orgRes.data?.name || 'Autopilot Offices';
    const sessionDate = (session.created_at || new Date().toISOString()).slice(0, 10);
    const common = {
        orgName,
        session,
        synthesis: synthesisRes.data?.content || null,
        findings: findingsRes.data || [],
    };

    if (format === 'pdf') {
        // Chromium can fail to launch on a constrained host. That is a real failure with a
        // real cause, so it is reported rather than silently falling back to xlsx — a
        // caller who asked for a PDF should not receive a spreadsheet without being told.
        let pdf: Buffer;
        try {
            pdf = await buildCouncilAuditPdf(common);
        } catch (error) {
            console.error('[council export] pdf render:', error instanceof Error ? error.message : error);
            return NextResponse.json(
                { error: 'Could not render the PDF', hint: 'Retry, or use format=xlsx' },
                { status: 500 },
            );
        }
        return new NextResponse(new Uint8Array(pdf), {
            headers: {
                'Content-Disposition': `attachment; filename="council-audit-${sessionDate}.pdf"`,
                'Content-Type': 'application/pdf',
                'Cache-Control': 'no-store',
            },
        });
    }

    const workbook = await buildCouncilAuditWorkbook(common);
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
        headers: {
            'Content-Disposition': `attachment; filename="council-audit-${sessionDate}.xlsx"`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control': 'no-store',
        },
    });
}
