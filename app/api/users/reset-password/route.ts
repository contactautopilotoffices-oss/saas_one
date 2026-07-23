import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// Configure email transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.EMAIL_SMTP_USER,
        pass: process.env.EMAIL_SMTP_PASS,
    },
});

export async function POST(req: NextRequest) {
    try {
        const { email } = await req.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        // Use service role client for admin operations
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

        // Since you are using Supabase's built-in email/SMTP, we bypass manual token generation
        // and let Supabase handle everything securely.
        const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
            redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/auth/callback?next=/reset-password`
        });

        if (error) {
            console.error('Password reset error:', error);
            // Don't reveal user existence errors to the frontend for security reasons,
            // but return generic success so the UI shows the "Check your email" popup.
            return NextResponse.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
        }

        return NextResponse.json({ message: 'Password reset email sent successfully' });
    } catch (err: any) {
        console.error('Reset password API error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// GET: Verify reset token
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const token = searchParams.get('token');

        if (!token) {
            return NextResponse.json({ valid: false, error: 'Token is required' }, { status: 400 });
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

        // Check if token exists and is not expired
        const { data: tokenData, error } = await supabaseAdmin
            .from('password_reset_tokens')
            .select('*, user:users(email)')
            .eq('token', token)
            .single();

        if (error || !tokenData) {
            return NextResponse.json({ valid: false, error: 'Invalid token' });
        }

        const isExpired = new Date(tokenData.expires_at) < new Date();
        if (isExpired) {
            return NextResponse.json({ valid: false, error: 'Token has expired' });
        }

        return NextResponse.json({ valid: true, email: tokenData.user?.email });
    } catch (err: any) {
        console.error('Token verification error:', err);
        return NextResponse.json({ valid: false, error: 'Verification failed' }, { status: 500 });
    }
}
