import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const includeInternal = searchParams.get('includeInternal') === 'true';

        let query = supabaseAdmin
            .from('hr_ticket_comments')
            .select('*')
            .eq('ticket_id', id)
            .order('created_at', { ascending: true });

        // Filter out internal notes if requested by non-handler/employee view
        if (!includeInternal) {
            query = query.eq('is_internal', false);
        }

        const { data, error } = await query;
        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { sender_user_id, sender_name, content, attachment_urls = [], is_internal = false } = body;

        if (!content) {
            return NextResponse.json({ success: false, error: 'Comment content is required' }, { status: 400 });
        }

        const { data: comment, error } = await supabaseAdmin
            .from('hr_ticket_comments')
            .insert({
                ticket_id: id,
                sender_user_id: sender_user_id || null,
                sender_name: sender_name || 'System User',
                content,
                attachment_urls,
                is_internal: Boolean(is_internal)
            })
            .select()
            .single();

        if (error) throw error;

        // Log audit event
        await supabaseAdmin.from('hr_ticket_audit_logs').insert({
            ticket_id: id,
            actor_user_id: sender_user_id || null,
            action: is_internal ? 'INTERNAL_NOTE_ADDED' : 'PUBLIC_REPLY_ADDED',
            new_values: { sender_name, is_internal, content_snippet: content.substring(0, 50) }
        });

        return NextResponse.json({ success: true, data: comment });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
