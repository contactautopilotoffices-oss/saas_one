import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
    try {
        const { token, newPassword } = await req.json();

        if (!token || !newPassword) {
            return NextResponse.json({ error: 'Token and new password are required' }, { status: 400 });
        }

        if (newPassword.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        // Verify token and get user
        const { data: tokenData, error: tokenError } = await supabaseAdmin
            .from('password_reset_tokens')
            .select('user_id')
            .eq('token', token)
            .single();

        if (tokenError || !tokenData) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
        }

        // Check if token is expired
        const { data: tokenCheck } = await supabaseAdmin
            .from('password_reset_tokens')
            .select('expires_at')
            .eq('token', token)
            .single();

        if (!tokenCheck || new Date(tokenCheck.expires_at) < new Date()) {
            return NextResponse.json({ error: 'Token has expired. Please request a new password reset.' }, { status: 400 });
        }

        // Update user password using admin API
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(tokenData.user_id, {
            password: newPassword
        });

        if (updateError) {
            console.error('Password update error:', updateError);
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Delete the used token
        await supabaseAdmin
            .from('password_reset_tokens')
            .delete()
            .eq('token', token);

        return NextResponse.json({ message: 'Password updated successfully' });
    } catch (err: any) {
        console.error('Update password API error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
