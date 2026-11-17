import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { INVOICE_BUCKET } from '@/backend/lib/invoices/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(access)) return access;

    let path = request.nextUrl.searchParams.get('path') || '';

    // If a document ID was provided instead of a raw storage path
    const docId = request.nextUrl.searchParams.get('doc');
    if (!path && docId) {
        const { data: doc, error } = await supabaseAdmin
            .from('invoice_documents')
            .select('storage_path')
            .eq('id', docId)
            .maybeSingle();
        if (error || !doc?.storage_path) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }
        path = doc.storage_path;
    }

    // Path traversal prevention and org-scoped path enforcement
    if (!path || path.includes('..')) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Enforce that path starts with this organization's ID unless master admin
    if (!access.isMaster && !path.startsWith(`${access.orgId}/`)) {
        return NextResponse.json({ error: 'Forbidden: Cannot access files outside your organization' }, { status: 403 });
    }

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
        .from(INVOICE_BUCKET)
        .download(path);

    if (downloadError || !fileBlob) {
        console.error('[Invoices file download failed]:', downloadError?.message);
        return NextResponse.json({ error: 'Could not retrieve file' }, { status: 404 });
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const filename = path.split('/').pop() || 'invoice-document';
    const isPdf = filename.toLowerCase().endsWith('.pdf');
    const isPng = filename.toLowerCase().endsWith('.png');
    const isJpg = filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg');
    const contentType = isPdf ? 'application/pdf' : isPng ? 'image/png' : isJpg ? 'image/jpeg' : (fileBlob.type || 'application/octet-stream');
    const isDownload = request.nextUrl.searchParams.get('download') === 'true';

    return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
            'Content-Type': contentType,
            'Content-Disposition': `${isDownload ? 'attachment' : 'inline'}; filename="${encodeURIComponent(filename)}"`,
            'Content-Length': buffer.byteLength.toString(),
            'Cache-Control': 'private, max-age=3600',
        },
    });
}
