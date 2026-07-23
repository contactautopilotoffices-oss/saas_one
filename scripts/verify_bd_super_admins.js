// Read-only check: do the BD Super Admin users exist and hold a CRM role?
// Usage: node scripts/verify_bd_super_admins.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EMAILS = [
  'saniel@worksquare.in',
  'rushab@worksquare.in',
  'nirupam.lahiri@worksquare.in',
];

const CRM_ROLES = ['bd_rep', 'bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'];

async function main() {
  for (const email of EMAILS) {
    console.log('\n=== ' + email + ' ===');

    // 1) Find the auth user (case-insensitive).
    const { data: authList, error: authErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authErr) { console.log('  auth lookup error:', authErr.message); }
    const authUser = (authList?.users || []).find(
      (u) => (u.email || '').toLowerCase() === email.toLowerCase()
    );

    if (!authUser) {
      console.log('  ❌ NO auth account with this email — user must be created first.');
      continue;
    }
    console.log('  ✅ auth user id:', authUser.id);
    console.log('     user_metadata.role:', authUser.user_metadata?.role ?? '(none)');

    // 2) public.users row (role / master admin)
    const { data: pubUser } = await supabase
      .from('users')
      .select('id, email, role, is_master_admin')
      .eq('id', authUser.id)
      .maybeSingle();
    if (pubUser) {
      console.log('     users.role:', pubUser.role, '| is_master_admin:', pubUser.is_master_admin);
    }

    // 3) organization_memberships
    const { data: orgMems } = await supabase
      .from('organization_memberships')
      .select('role, organization_id, is_active')
      .eq('user_id', authUser.id);
    console.log('     org_memberships:', JSON.stringify(orgMems || []));

    // 4) property_memberships
    const { data: propMems } = await supabase
      .from('property_memberships')
      .select('role, property_id, organization_id, is_active')
      .eq('user_id', authUser.id);
    console.log('     property_memberships:', JSON.stringify(propMems || []));

    // 5) verdict
    const activeOrg = (orgMems || []).filter((m) => m.is_active !== false && CRM_ROLES.includes(m.role));
    const activeProp = (propMems || []).filter((m) => m.is_active !== false && CRM_ROLES.includes(m.role));
    const ok = pubUser?.is_master_admin || activeOrg.length > 0 || activeProp.length > 0;
    console.log(
      ok
        ? '  ✅ HAS a CRM role → can reach /crm → will get the BD Command Center (email is allowlisted).'
        : '  ⚠️  NO active CRM role → cannot reach /crm. Grant org_membership role=bd_admin in the org.'
    );
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
