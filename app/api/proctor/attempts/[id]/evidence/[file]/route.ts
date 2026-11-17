import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProctorAccess, isProctorAccessError, EVIDENCE_BUCKET } from '@/backend/lib/proctor/access';

/** The only file names recordFlag writes: `<epoch ms>-<category>.jpg`. Anything else is refused. */
const FRAME_FILE = /^\d+-[a-z_]+\.jpg$/;

/**
 * GET /api/proctor/attempts/[id]/evidence/[file] — one camera frame kept for an
 * attempt, streamed from the private proctor-evidence bucket. Authors only:
 * these are images of a person.
 *
 * The results page used to get signed Supabase links, but the shared
 * /api/storage proxy (and maskStorageUrl) only handles public buckets, so the
 * frames broke. Serving them here, behind the same check as the report, keeps
 * the bucket private and the Supabase address out of the browser.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
    const { id, file } = await params;
    if (!FRAME_FILE.test(file)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: attempt } = await supabaseAdmin.from('proctor_attempts').select('id, organization_id').eq('id', id).maybeSingle();
    if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const access = await resolveProctorAccess(attempt.organization_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: blob, error } = await supabaseAdmin.storage.from(EVIDENCE_BUCKET).download(`${id}/${file}`);
    if (error || !blob) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return new NextResponse(Buffer.from(await blob.arrayBuffer()), {
        headers: {
            'Content-Type': 'image/jpeg',
            // A saved frame never changes. `private` keeps it out of shared caches (Vercel's CDN).
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
