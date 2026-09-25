import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { user_id, token, browser, device_info } = body;

        if (!user_id || !token) {
            return NextResponse.json({ success: false, error: 'user_id and token are required' }, { status: 400 });
        }

        // Upsert using supabaseAdmin to bypass RLS conflicts if token was previously assigned to another user account on the same browser
        const { error: upsertErr } = await supabaseAdmin
            .from('push_tokens')
            .upsert({
                user_id,
                token,
                browser: browser || null,
                device_info: device_info || null,
                is_active: true,
                updated_at: new Date().toISOString()
            }, { onConflict: 'token' });

        if (upsertErr) {
            console.error('[API /api/push-tokens Error]:', upsertErr.message);
            return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'Push token registered successfully' });
    } catch (err: any) {
        console.error('[API /api/push-tokens Exception]:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to save token' }, { status: 500 });
    }
}
