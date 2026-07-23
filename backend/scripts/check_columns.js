
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
    console.log('Checking columns...');
    const cols = ['full_name', 'phone', 'avatar_url', 'user_photo_url', 'phone_number'];
    for (const col of cols) {
        const { error } = await supabase.from('users').select(col).limit(1);
        if (error) {
            console.log(`Column [${col}] does NOT exist (Error: ${error.message})`);
        } else {
            console.log(`Column [${col}] exists.`);
        }
    }
}

checkColumns();
