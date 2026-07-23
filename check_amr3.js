const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    const { data: prop } = await supabase.from('properties').select('id, name').ilike('name', '%amr altruist%').single();

    const { data, error } = await supabase
        .from('sop_completions')
        .select(`
            id,
            template_id,
            template:sop_templates(title, frequency, category, start_time, end_time),
            status,
            completion_date
        `)
        .eq('property_id', prop.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(10);
        
    console.log(JSON.stringify(data, null, 2));
})();
