const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log("Checking auth.users...");
  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    console.error("Error fetching users:", usersError);
  } else {
    const user = usersData.users.find(u => u.email === 'lohitexplores@gmail.com');
    if (user) {
      console.log("User found in auth.users:", user);
    } else {
      console.log("User NOT found in auth.users.");
    }
  }

  // check public.users if it exists
  console.log("\nChecking public.users...");
  const { data: pUsers, error: pError } = await supabase.from('users').select('*').eq('email', 'lohitexplores@gmail.com');
  if (pError) {
    console.error("Error fetching public.users:", pError.message);
  } else {
    console.log("Results from public.users:", pUsers);
  }
}

run();
