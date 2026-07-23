const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    const { data, error } = await supabase
        .from('sop_templates')
        .select('*')
        .in('id', ['40099f97-ef8e-40c7-a173-c82804543b78', '89802c39-abfe-4225-a100-07e2da6ff761']);
        
    console.log(JSON.stringify(data, null, 2));
    if (error) console.error("Error:", error);
})();
