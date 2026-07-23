const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://xvucakstcmtfoanmgcql.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2dWNha3N0Y210Zm9hbm1nY3FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzMyMjQ2NSwiZXhwIjoyMDgyODk4NDY1fQ.7WFGFGxTkSurehfwGNVPS2qzNf9toM3bO1GLaLClEwg';
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanupDuplicates() {
    console.log('--- CLEANING UP CATALOG DUPLICATES ---');

    // 1. Fetch all items
    const { data: items, error } = await supabase
        .from('procurement_catalog')
        .select('id, name, organization_id')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching items:', error);
        return;
    }

    const seen = new Set();
    const toDelete = [];

    for (const item of items) {
        // Create a unique key based on name and organization
        const key = `${item.organization_id}_${item.name.toLowerCase().trim()}`;
        
        if (seen.has(key)) {
            toDelete.push(item.id);
        } else {
            seen.add(key);
        }
    }

    if (toDelete.length === 0) {
        console.log('No duplicates found.');
        return;
    }

    console.log(`Found ${toDelete.length} duplicates. Deleting...`);

    // Delete in batches if necessary
    for (const id of toDelete) {
        const { error: delError } = await supabase
            .from('procurement_catalog')
            .delete()
            .eq('id', id);
        
        if (delError) {
            console.error(`Failed to delete ${id}:`, delError);
        } else {
            console.log(`Deleted duplicate ID: ${id}`);
        }
    }

    console.log('--- CLEANUP FINISHED ---');
}

cleanupDuplicates();
