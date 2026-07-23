const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    const { data: prop } = await supabase.from('properties').select('id, name').ilike('name', '%amr altruist%').single();
    if (!prop) {
        console.log("Property not found");
        return;
    }

    const { data, error } = await supabase
        .from('sop_completions')
        .select(`
            *,
            template:sop_templates(title, frequency, category, start_time, end_time),
            user:users(id, full_name),
            items:sop_completion_items(is_checked, value)
        `)
        .eq('property_id', prop.id)
        .limit(2);
        
    console.log(JSON.stringify(data, null, 2));
    if (error) console.error("Error:", error);
})();
