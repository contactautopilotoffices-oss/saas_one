import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveElectricityAccess, isElectricityAccessError, readOrgId } from '@/backend/lib/electricity/access';

/**
 * GET /api/electricity/files?path=<storage_path>
 *
 * Bill PDFs and dispute-response attachments live in the PRIVATE `electricity-bills`
 * bucket, so the UI cannot link to them directly. This route is the browser-facing
 * door: it checks the caller's electricity access, confirms the requested path sits
 * under the caller's own org prefix (every writer — ingest, dispute respond — stores
 * under `${organizationId}/...`), then 302s to a short-lived signed URL.
 */

export const dynamic = 'force-dynamic';

const BUCKET = 'electricity-bills';
const SIGNED_URL_TTL = 300; // seconds — long enough to open, short enough to not leak

export async function GET(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    let path = request.nextUrl.searchParams.get('path') || '';

    // ?doc=<document_id> — the register's paperclip knows the document id, not its
    // storage path. Resolve it org-scoped so ids from other orgs 404.
    const docId = request.nextUrl.searchParams.get('doc');
    if (!path && docId) {
        const { data: doc, error } = await supabaseAdmin
            .from('electricity_bill_documents')
            .select('storage_path')
            .eq('id', docId)
            .eq('organization_id', access.organizationId)
            .maybeSingle();
        if (error || !doc?.storage_path) {
            return NextResponse.json({ error: 'Unknown file' }, { status: 404 });
        }
        path = doc.storage_path;
    }

    // Path-prefix containment: no traversal, no cross-org reads.
    if (!path || path.includes('..') || !path.startsWith(`${access.organizationId}/`)) {
        return NextResponse.json({ error: 'Unknown file' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
    if (error || !data?.signedUrl) {
        console.error('[electricity files] sign failed:', error?.message);
        return NextResponse.json({ error: 'Could not open the file' }, { status: 404 });
    }
    return NextResponse.redirect(data.signedUrl);
}
