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
    const { data: doc, error } = await supabaseAdmin.from('petty_cash_documents').select('request_id,storage_path,file_url,file_name,file_type').eq('id', docId).eq('organization_id', access.organizationId).maybeSingle();
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

    // Stream file directly through Next.js proxy so Supabase backend URLs are never exposed in address bar or shared links
    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage.from(bucket).download(path);
    if (downloadError || !fileBlob) {
        return pcError(downloadError || { message: 'Could not retrieve document file' });
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const contentType = doc.file_type || fileBlob.type || 'application/octet-stream';
    const isAttachment = request.nextUrl.searchParams.get('download') === 'true';
    const filename = encodeURIComponent(doc.file_name || 'receipt');

    return new NextResponse(buffer, {
        status: 200,
        headers: {
            'Content-Type': contentType,
            'Content-Disposition': `${isAttachment ? 'attachment' : 'inline'}; filename="${filename}"; filename*=UTF-8''${filename}`,
            'Cache-Control': 'private, max-age=3600',
            'Content-Length': String(buffer.length)
        }
    });
}
