const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testFeedbackQuery() {
  console.log('Testing monthly_requisition_feedback query...');
  const { data, error } = await supabase
    .from('monthly_requisition_feedback')
    .select(`
      *,
      properties (id, name),
      submitter:users!submitted_by (id, full_name, email)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching monthly_requisition_feedback:', error);
  } else {
    console.log('Query successful! Returned records count:', data.length);
  }
}

testFeedbackQuery();
