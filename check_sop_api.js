const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    // Let's just do the exact query from the API using service role to see if data exists
    const { data, error } = await supabase
        .from('sop_completions')
        .select(`
            *,
            template:sop_templates(title, frequency),
            user:users(id, full_name),
            items:sop_completion_items(*)
        `)
        .limit(2);
        
    console.log(JSON.stringify(data, null, 2));
    if (error) console.error(error);
})();
