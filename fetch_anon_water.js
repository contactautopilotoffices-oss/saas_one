const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
fetch(supabaseUrl + '/rest/v1/water_sources?select=id', {
  headers: {
    apikey: supabaseKey,
    Authorization: 'Bearer ' + supabaseKey
  }
}).then(res => res.json()).then(data => console.log('Anon fetch water_sources:', data.length || data));
