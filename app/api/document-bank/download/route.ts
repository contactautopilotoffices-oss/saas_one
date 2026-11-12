import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { checkDocumentBankAccess } from '@/backend/lib/documentBank/access';
import { DOCUMENT_BANK_BUCKET } from '@/backend/lib/documentBank/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const docId = request.nextUrl.searchParams.get('id');
        let path = request.nextUrl.searchParams.get('path') || '';

        let doc: any = null;
        if (docId) {
            const { data, error } = await supabaseAdmin.from('document_bank').select('*').eq('id', docId).maybeSingle();
            if (error || !data) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
            doc = data;
            path = doc.file_path;
        } else if (path) {
            const { data, error } = await supabaseAdmin.from('document_bank').select('*').eq('file_path', path).maybeSingle();
            if (!error && data) doc = data;
        }

        if (!path || path.includes('..')) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });

        if (doc) {
            const { allowed } = await checkDocumentBankAccess(user.id, doc.organization_id, doc.property_id);
            if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
            .from(DOCUMENT_BANK_BUCKET)
            .download(path);

        if (downloadError || !fileBlob) {
            console.error('[DocumentBank download error]:', downloadError);
            return NextResponse.json({ error: 'Could not retrieve file' }, { status: 500 });
        }

        const buffer = Buffer.from(await fileBlob.arrayBuffer());
        const filename = encodeURIComponent(doc?.file_name || path.split('/').pop() || 'document');
        const contentType = doc?.file_type || fileBlob.type || 'application/octet-stream';
        const isAttachment = request.nextUrl.searchParams.get('download') === 'true';

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `${isAttachment ? 'attachment' : 'inline'}; filename="${filename}"; filename*=UTF-8''${filename}`,
                'Cache-Control': 'private, max-age=3600',
                'Content-Length': String(buffer.byteLength),
            },
        });
    } catch (err: any) {
        console.error('[DocumentBank download route error]:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
