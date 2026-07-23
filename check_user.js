const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    const { data: user, error: uErr } = await supabase.from('users').select('*').eq('email', 'sanyog@gmail.com').single();
    if (!user) {
        console.log("User not found");
        return;
    }
    console.log("User:", user);

    const { data: orgMemb } = await supabase.from('organization_memberships').select('*').eq('user_id', user.id);
    console.log("Org Memberships:", orgMemb);

    const { data: propMemb } = await supabase.from('property_memberships').select('*').eq('user_id', user.id);
    console.log("Property Memberships:", propMemb);
})();
