import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: companyId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { user_id, action } = body; // action: 'add' | 'remove'

        if (!user_id) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
        }

        if (action === 'remove') {
            const { error } = await supabaseAdmin
                .from('company_members')
                .delete()
                .eq('company_id', companyId)
                .eq('user_id', user_id);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ success: true });
        } else {
            // Fetch company to get organization_id
            const { data: company } = await supabaseAdmin
                .from('companies')
                .select('organization_id')
                .eq('id', companyId)
                .single();

            // Add member
            const { data, error } = await supabaseAdmin
                .from('company_members')
                .upsert({
                    company_id: companyId,
                    user_id: user_id,
                    organization_id: company?.organization_id,
                    role: 'member'
                })
                .select()
                .single();

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json(data);
        }
    } catch (error) {
        console.error('Company Members Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
