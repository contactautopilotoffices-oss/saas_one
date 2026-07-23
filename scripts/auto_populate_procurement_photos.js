const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://xvucakstcmtfoanmgcql.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2dWNha3N0Y210Zm9hbm1nY3FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzMyMjQ2NSwiZXhwIjoyMDgyODk4NDY1fQ.7WFGFGxTkSurehfwGNVPS2qzNf9toM3bO1GLaLClEwg';
const supabase = createClient(supabaseUrl, supabaseKey);

async function autoPopulatePhotos() {
    console.log('--- AUTO-POPULATING CATALOG PHOTOS ---');

    // 1. Fetch catalog items that have no photo
    const { data: items, error } = await supabase
        .from('procurement_catalog')
        .select('id, name')
        .is('photo_url', null);

    if (error) {
        console.error('Error fetching catalog:', error);
        return;
    }

    console.log(`Found ${items.length} items without photos.`);

    let updatedCount = 0;

    for (const item of items) {
        // 2. Use a public placeholder service (LoremFlickr)
        // Format: https://loremflickr.com/400/400/{item_name}
        const encodedName = encodeURIComponent(item.name.toLowerCase());
        const autoPhotoUrl = `https://loremflickr.com/400/400/${encodedName}`;

        // 3. Update the item
        const { error: updateError } = await supabase
            .from('procurement_catalog')
            .update({ photo_url: autoPhotoUrl })
            .eq('id', item.id);

        if (updateError) {
            console.error(`Failed to update "${item.name}":`, updateError);
        } else {
            console.log(`Auto-photo set for: ${item.name}`);
            updatedCount++;
        }
    }

    console.log(`--- FINISHED. Updated ${updatedCount} items with auto-photos. ---`);
    console.log('NOTE: These are placeholder photos. You can replace them with real ones in the Admin UI later.');
}

autoPopulatePhotos();
