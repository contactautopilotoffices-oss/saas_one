require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing env vars');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    console.log('Checking bucket...');
    const { data: buckets, error: getError } = await supabase.storage.listBuckets();
    
    if (getError) {
        console.error('Error fetching buckets:', getError);
        process.exit(1);
    }
    
    const exists = buckets.find(b => b.name === 'feedback-attachments');
    if (exists) {
        console.log('Bucket already exists.');
        process.exit(0);
    }
    
    console.log('Creating bucket...');
    const { data, error } = await supabase.storage.createBucket('feedback-attachments', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        fileSizeLimit: 5242880 // 5MB
    });
    
    if (error) {
        console.error('Error creating bucket:', error);
        process.exit(1);
    }
    
    console.log('Bucket created successfully!');
}

main();
