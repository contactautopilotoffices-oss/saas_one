const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id, name')
    .eq('name', 'SS Plaza')
    .single();

  if (propErr) {
    console.log("Error finding property:", propErr);
    return;
  }
  
  console.log("Property ID:", prop.id);

  const { data: sources, error: sourceErr } = await supabase
    .from('water_sources')
    .select('*')
    .eq('property_id', prop.id);

  if (sourceErr) {
    console.log("Error fetching water sources:", sourceErr);
  } else {
    console.log("Water sources found (bypassing RLS):", sources.length);
    console.log(sources);
  }
})();
