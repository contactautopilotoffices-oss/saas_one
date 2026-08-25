const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: orgs } = await supabase.from('organizations').select('id, name');
    console.log('--- ORGANIZATIONS ---');
    console.log(JSON.stringify(orgs));

    const { data: props, error } = await supabase.from('properties').select('id, name, organization_id');
    if (error) console.error(error);
    else {
        console.log('--- PROPERTIES ---');
        props.forEach(p => console.log(`${p.id} | ${p.name}`));
    }
}
run();
