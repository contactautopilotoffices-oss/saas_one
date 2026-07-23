
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
    const { data, error } = await supabase
        .from('procurement_catalog')
        .select('*');

    if (error) {
        console.error(error);
        return;
    }

    const missing = data.filter(i => !i.photo_url || i.photo_url.includes('loremflickr.com')).map(i => ({id: i.id, name: i.name}));
    
    fs.writeFileSync(path.join(__dirname, 'missing_photos.json'), JSON.stringify(missing, null, 2));
    console.log(`Found ${missing.length} items missing photos.`);
}

main();
