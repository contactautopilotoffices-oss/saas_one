const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://xvucakstcmtfoanmgcql.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2dWNha3N0Y210Zm9hbm1nY3FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzMyMjQ2NSwiZXhwIjoyMDgyODk4NDY1fQ.7WFGFGxTkSurehfwGNVPS2qzNf9toM3bO1GLaLClEwg';
const supabase = createClient(supabaseUrl, supabaseKey);

const PROPERTY_ID = '79ba1aa5-bf91-4956-9dbe-ce9986790b53'; // SS Plaza

async function cleanup() {
    console.log('--- CLEANING UP SS PLAZA LATE STATUS ---');

    // 1. Fetch completions that are marked late
    const { data: completions, error } = await supabase
        .from('sop_completions')
        .select(`
            id, 
            is_late, 
            completed_at, 
            completion_date,
            template:sop_templates(start_time, end_time)
        `)
        .eq('property_id', PROPERTY_ID)
        .eq('is_late', true)
        .eq('status', 'completed')
        .gte('completed_at', new Date(Date.now() - 7 * 86400000).toISOString());

    if (error) {
        console.error('Error fetching completions:', error);
        return;
    }

    console.log(`Found ${completions.length} late completions to check.`);

    let fixedCount = 0;

    for (const comp of completions) {
        if (!comp.template || !comp.template.end_time) continue;

        const completedAt = new Date(comp.completed_at);
        
        // Convert to India time
        const indiaTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        });
        const parts = indiaTime.formatToParts(completedAt);
        const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
        const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
        const currentMins = h * 60 + m;

        const [sH, sM] = comp.template.start_time.slice(0, 5).split(':').map(Number);
        const [eH, eM] = comp.template.end_time.slice(0, 5).split(':').map(Number);
        const startM = sH * 60 + sM;
        const endM = eH * 60 + eM;

        const isOvernight = endM < startM;

        // NEW LOGIC: Is it actually after the window?
        const isActuallyLate = isOvernight
            ? (currentMins >= endM && currentMins < startM)
            : (currentMins >= endM);

        if (!isActuallyLate) {
            console.log(`Fixing record ${comp.id}: Completed at ${h}:${m}, window ends ${comp.template.end_time}. Setting is_late = false.`);
            const { error: updateError } = await supabase
                .from('sop_completions')
                .update({ is_late: false })
                .eq('id', comp.id);
            
            if (updateError) console.error(`Failed to fix ${comp.id}:`, updateError);
            else fixedCount++;
        }
    }

    console.log(`--- FINISHED. Fixed ${fixedCount} records. ---`);
}

cleanup();
