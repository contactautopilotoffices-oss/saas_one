/**
 * create_nirupam.js — provision the BD Super Admin "Nirupam Lahiri".
 *
 * Creates the auth user (a DB trigger creates the public.users row), then an
 * active org membership with role=bd_admin in the target org. Idempotent: skips
 * creation if the email already exists, but still ensures the membership.
 *
 *   node scripts/create_nirupam.js
 */
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';
const EMAIL = 'nirupam.lahiri@worksquare.in';
const FULL_NAME = 'Nirupam Lahiri';
const ROLE = 'bd_admin'; // full CRM access; email allowlist drives the CEO dashboard UI
// Strong random temp password — Nirupam should reset it on first login.
const TEMP_PASSWORD = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + 'Aa1!';

(async () => {
  // 1) Does the auth user already exist?
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = (list?.users || []).find((u) => (u.email || '').toLowerCase() === EMAIL.toLowerCase());

  if (user) {
    console.log('⏭  auth user already exists:', user.id);
  } else {
    const { data: created, error: cErr } = await sb.auth.admin.createUser({
      email: EMAIL,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME, role: ROLE },
    });
    if (cErr) { console.error('✗ createUser:', cErr.message); process.exit(1); }
    user = created.user;
    console.log('✅ created auth user:', user.id);
    console.log('🔑 temp password (share securely, then reset):', TEMP_PASSWORD);
  }

  // 2) Ensure public.users full_name (trigger sets it from metadata; be explicit).
  await sb.from('users').update({ full_name: FULL_NAME }).eq('id', user.id);

  // 3) Ensure an active org membership with a CRM-admin role.
  const { data: existingMem } = await sb
    .from('organization_memberships')
    .select('role, is_active')
    .eq('user_id', user.id)
    .eq('organization_id', ORG_ID)
    .maybeSingle();

  if (existingMem) {
    if (existingMem.role !== ROLE || existingMem.is_active === false) {
      await sb.from('organization_memberships')
        .update({ role: ROLE, is_active: true })
        .eq('user_id', user.id).eq('organization_id', ORG_ID);
      console.log('✅ updated membership →', ROLE);
    } else {
      console.log('⏭  membership already', ROLE, '(active)');
    }
  } else {
    const { error: mErr } = await sb.from('organization_memberships')
      .insert({ user_id: user.id, organization_id: ORG_ID, role: ROLE, is_active: true });
    if (mErr) { console.error('✗ membership insert:', mErr.message); process.exit(1); }
    console.log('✅ inserted membership →', ROLE);
  }

  console.log('\nDone. user_id =', user.id);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
