const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkVisibility() {
    const { data, error } = await supabase
        .from('procurement_price_visibility')
        .select('*');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Visibility Rules:', JSON.stringify(data, null, 2));
}

checkVisibility();
