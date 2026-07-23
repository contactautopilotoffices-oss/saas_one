import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Admin Client
 * Uses SERVICE ROLE key to bypass RLS
 * ONLY for use in /api/admin/* routes
 */
export const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);
