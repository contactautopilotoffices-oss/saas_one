import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Per-user CRM wallpaper preference (url / opacity / accent), stored on
 * users.metadata. Written via the SERVICE-ROLE client so it isn't silently
 * dropped by row-level security on the users table — a direct browser update
 * affected 0 rows without erroring, so the value reverted on refresh.
 */

async function authedUserId(request: NextRequest): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return user.id;
    // Bearer fallback (mobile app).
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data } = await supabaseAdmin.auth.getUser(token);
        if (data.user) return data.user.id;
    }
    return null;
}

// GET — read the caller's wallpaper preference (authoritative, RLS-proof).
export async function GET(request: NextRequest) {
    const userId = await authedUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data } = await supabaseAdmin.from('users').select('metadata').eq('id', userId).maybeSingle();
    const meta = (data?.metadata || {}) as Record<string, unknown>;
    return NextResponse.json({
        url: typeof meta.crm_background_url === 'string' ? meta.crm_background_url : '',
        opacity: typeof meta.crm_background_opacity === 'number' ? meta.crm_background_opacity : null,
        accent: typeof meta.crm_background_accent === 'string' ? meta.crm_background_accent : '',
    });
}

// POST — save the caller's wallpaper preference.
export async function POST(request: NextRequest) {
    const userId = await authedUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const url = typeof body.url === 'string' ? body.url : '';
    const accent = typeof body.accent === 'string' ? body.accent : '';
    const opacity = typeof body.opacity === 'number' && isFinite(body.opacity)
        ? Math.max(0, Math.min(1, body.opacity))
        : 0.25;

    // Merge into metadata without clobbering other keys.
    const { data: row } = await supabaseAdmin.from('users').select('metadata').eq('id', userId).maybeSingle();
    const meta = (row?.metadata || {}) as Record<string, unknown>;
    const nextMeta = {
        ...meta,
        crm_background_url: url,
        crm_background_opacity: opacity,
        crm_background_accent: accent,
    };
    const { error } = await supabaseAdmin.from('users').update({ metadata: nextMeta }).eq('id', userId);
    if (error) {
        console.error('Wallpaper save failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, url, opacity, accent });
}
