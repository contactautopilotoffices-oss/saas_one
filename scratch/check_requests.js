const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRequests() {
    const { data, error } = await supabase
        .from('material_requests')
        .select('id, items, total_amount')
        .limit(5);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Requests Found:', data.length);
    data.forEach(req => {
        console.log(`ID: ${req.id}`);
        console.log(`Total Amount: ${req.total_amount}`);
        console.log(`Items:`, JSON.stringify(req.items, null, 2));
        console.log('---');
    });
}

checkRequests();
