
const { createClient } = require('@supabase/supabase-js');
const u = process.env.NEXT_PUBLIC_SUPABASE_URL;
const k = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!u || !k) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set.');
    process.exit(1);
}

const s = createClient(u, k);
async function c() {
    const cols = ['full_name', 'phone', 'avatar_url', 'user_photo_url'];
    for (const col of cols) {
        const { error } = await s.from('users').select(col).limit(1);
        console.log(`${col}: ${error ? 'NO' : 'YES'}`);
    }
}
c();
