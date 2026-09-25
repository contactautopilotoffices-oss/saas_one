const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function applyMigration() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Supabase environment variables missing');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const queries = [
        "ALTER TABLE public.petty_cash_requests ADD COLUMN IF NOT EXISTS assigned_approver_id UUID REFERENCES public.users(id)",
        "CREATE INDEX IF NOT EXISTS idx_pc_requests_assigned_approver ON public.petty_cash_requests (assigned_approver_id, status)"
    ];

    for (const q of queries) {
        console.log(`Executing SQL: ${q}...`);
        const { data, error } = await supabase.rpc('execute_sql', { query: q });
        if (error) {
            console.error('RPC Error:', error);
        } else {
            console.log('✅ Result:', data);
        }
    }
}

applyMigration();
