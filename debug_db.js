const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log('Checking property_memberships for role=procurement...');
    const { data: propData, error: propErr } = await supabase
        .from('property_memberships')
        .select('user_id, role, is_active')
        .eq('role', 'procurement');
    
    if (propErr) console.error('Prop Error:', propErr);
    else console.log('Property Memberships (exact low):', propData);

    const { data: propDataUpper, error: propErrUpper } = await supabase
        .from('property_memberships')
        .select('user_id, role, is_active')
        .eq('role', 'Procurement');
    
    if (propErrUpper) console.error('Prop Error Upper:', propErrUpper);
    else console.log('Property Memberships (exact upper):', propDataUpper);

    console.log('\nChecking organization_memberships for role=procurement...');
    const { data: orgData, error: orgErr } = await supabase
        .from('organization_memberships')
        .select('user_id, role')
        .eq('role', 'procurement');
    
    if (orgErr) console.error('Org Error:', orgErr);
    else console.log('Org Memberships (exact low):', orgData);

    const { data: orgDataUpper, error: orgErrUpper } = await supabase
        .from('organization_memberships')
        .select('user_id, role')
        .eq('role', 'Procurement');
    
    if (orgErrUpper) console.error('Org Error Upper:', orgErrUpper);
    else console.log('Org Memberships (exact upper):', orgDataUpper);

    console.log('\nSampling first 5 memberships to see role casing...');
    const { data: sample } = await supabase.from('property_memberships').select('role').limit(5);
    console.log('Sample roles:', sample);
}

run();
