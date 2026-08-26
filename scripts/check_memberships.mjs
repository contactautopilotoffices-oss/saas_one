import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMemberships() {
    const { data: om, error: omErr } = await supabase.from('organization_memberships').select('is_active').limit(1);
    console.log('organization_memberships.is_active:', { om, omErr });

    const { data: pm, error: pmErr } = await supabase.from('property_memberships').select('is_active').limit(1);
    console.log('property_memberships.is_active:', { pm, pmErr });
}

checkMemberships();
