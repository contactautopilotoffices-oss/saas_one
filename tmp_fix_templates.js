const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
    const { data, error } = await supabase
        .from('sop_templates')
        .update({ is_running: true })
        .eq('title', 'Testing');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Reset is_running: true');
}

fix();
