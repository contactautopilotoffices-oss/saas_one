import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { checkDocumentBankAccess } from '@/backend/lib/documentBank/access';
import { DOCUMENT_BANK_BUCKET } from '@/backend/lib/documentBank/storage';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await context.params;
        const { data: doc, error } = await supabaseAdmin.from('document_bank').select('*').eq('id', id).maybeSingle();
        if (error || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

        const { allowed } = await checkDocumentBankAccess(user.id, doc.organization_id, doc.property_id);
        if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        if (!doc.file_path) return NextResponse.json({ error: 'No file stored' }, { status: 404 });

        const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
            .from(DOCUMENT_BANK_BUCKET)
            .download(doc.file_path);

        if (downloadError || !fileBlob) {
            console.error('[DocumentBank download error]:', downloadError);
            return NextResponse.json({ error: 'Could not retrieve file' }, { status: 500 });
        }

        const buffer = Buffer.from(await fileBlob.arrayBuffer());
        const filename = encodeURIComponent(doc.file_name || 'document');
        const contentType = doc.file_type || fileBlob.type || 'application/octet-stream';
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
