import { createAdminClient } from './frontend/utils/supabase/admin.js';

async function checkUser() {
    const supabase = createAdminClient();
    const { data: users, error } = await supabase
        .from('users')
        .select('id, full_name, email')
        .ilike('full_name', '%harsh%');
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Found users:', JSON.stringify(users, null, 2));
    
    for (const user of users) {
        console.log('Checking memberships for:', user.full_name, '(', user.id, ')');
        const { data: propMem } = await supabase
            .from('property_memberships')
            .select('property_id, properties(name), role')
            .eq('user_id', user.id);
        console.log('Property Memberships:', JSON.stringify(propMem, null, 2));
        
        const { data: orgMem } = await supabase
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', user.id);
        console.log('Org Memberships:', JSON.stringify(orgMem, null, 2));
        console.log('---');
    }
}

checkUser();
