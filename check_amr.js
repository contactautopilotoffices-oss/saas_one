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
    console.log("Found property:", prop);

    const { data, error } = await supabase
        .from('sop_completions')
        .select(`
            id,
            template_id,
            template:sop_templates(title, frequency),
            user:users(id, full_name)
        `)
        .eq('property_id', prop.id)
        .limit(2);
        
    console.log(JSON.stringify(data, null, 2));
    if (error) console.error(error);
})();
