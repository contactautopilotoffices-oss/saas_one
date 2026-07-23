const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from('property_memberships')
    .select('*')
    .limit(1);

  if (error) {
    console.error("Error fetching property_memberships:", error);
  } else {
    console.log("property_memberships structure:", Object.keys(data[0] || {}));
  }

  const { data: orgData, error: orgError } = await supabase
    .from('organization_memberships')
    .select('*')
    .limit(1);

  if (orgError) {
    console.error("Error fetching organization_memberships:", orgError);
  } else {
    console.log("organization_memberships structure:", Object.keys(orgData[0] || {}));
  }
}

run();
