const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkGenerators() {
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id, name')
    .eq('name', 'ETPL Digitide')
    .single();

  if (propErr) {
    console.log("Error finding property:", propErr);
    return;
  }
  
  console.log("Property ID:", prop.id);

  const { data: gens, error: genErr } = await supabase
    .from('generators')
    .select('*')
    .eq('property_id', prop.id);

  if (genErr) {
    console.log("Error fetching generators:", genErr);
  } else {
    console.log("Generators found (bypassing RLS):", gens.length);
    console.log(gens);
  }
}

checkGenerators();
