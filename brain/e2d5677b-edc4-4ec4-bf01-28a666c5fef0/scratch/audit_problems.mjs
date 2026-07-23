
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function audit() {
    console.log('--- 🛡️ STORAGE AUDIT ---');
    const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
    if (bucketErr) {
        console.error('Failed to list buckets:', bucketErr.message);
    } else {
        buckets.forEach(b => {
            console.log(`Bucket: ${b.name} | Public: ${b.public}`);
        });
    }

    console.log('\n--- 👥 USER ROLE AUDIT ---');
    const techEmail = 'abhishekn@worksquare.in';
    const { data: user } = await supabase.from('users').select('id, email, full_name').eq('email', techEmail).maybeSingle();
    if (user) {
        console.log(`User found: ${user.full_name} (${user.id})`);
        const { data: memberships } = await supabase.from('property_memberships').select('property_id, role, is_active').eq('user_id', user.id);
        console.log('Memberships:', memberships);
    } else {
        console.log(`User ${techEmail} not found in DB.`);
    }

    const tenantEmail = 'tenant.ho@gmail.com';
    const { data: tenant } = await supabase.from('users').select('id, full_name').eq('email', tenantEmail).maybeSingle();
    console.log(`Tenant Name Check: ${tenant?.full_name}`);
}

audit();
