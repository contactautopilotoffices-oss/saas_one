require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase
    .from('meeting_room_bookings')
    .select('*')
    .limit(1);
    
  if (error) {
    console.error('Error:', error);
  } else if (data && data.length > 0) {
    console.log('Columns:', Object.keys(data[0]));
  } else {
    // If no data, try to fetch the schema
    console.log('No rows found. Please insert a test row to see schema or use psql.');
    // let's just do a deliberate error to see postgrest response
    const { error: err2 } = await supabase.from('meeting_room_bookings').select('non_existent_column_for_schema_check').limit(1);
    console.log('Schema error msg:', err2);
  }
}
check();
