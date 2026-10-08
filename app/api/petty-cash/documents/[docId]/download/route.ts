import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, isUuid, pcError } from '@/backend/lib/pettyCash/api';
import { EVIDENCE_BUCKET } from '@/backend/lib/pettyCash/evidence';
export async function GET(request: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const { docId } = await params;
    if (!isUuid(docId)) return NextResponse.json({ error: 'Invalid document' }, { status: 400 });
    const { data: doc, error } = await supabaseAdmin.from('petty_cash_documents').select('request_id,storage_path,file_url').eq('id', docId).eq('organization_id', access.organizationId).maybeSingle();
    if (error) return pcError(error);
    if (!doc || !await pcRequest(access, doc.request_id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    let path = doc.storage_path;
    let bucket = EVIDENCE_BUCKET;
    if (!path) {
        try {
            const url = new URL(doc.file_url);
            if (url.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin) throw new Error();
            const prefix = '/storage/v1/object/public/petty_cash_documents/';
            if (!url.pathname.startsWith(prefix)) throw new Error();
            path = decodeURIComponent(url.pathname.slice(prefix.length)); bucket = 'petty_cash_documents';
        } catch { return NextResponse.json({ error: 'Historical evidence needs storage reconciliation' }, { status: 409 }); }
    }
    if (!path.startsWith(`${access.organizationId}/`) || path.includes('..')) return NextResponse.json({ error: 'Invalid evidence path' }, { status: 403 });
    const { data, error: signError } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60);
    return signError ? pcError(signError) : NextResponse.redirect(data.signedUrl);
}
