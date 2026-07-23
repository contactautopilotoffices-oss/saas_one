/**
 * create-bd-team.js — create the BD team accounts + memberships + territories.
 *
 * Idempotent: skips any roster member whose email already exists. Reps get a
 * campaign-scoped crm_territories row; admins see the whole org (no territory).
 *
 * SAFE BY DEFAULT — dry run unless --commit.
 *   node scripts/create-bd-team.js --org=<ORG_UUID>            # preview
 *   node scripts/create-bd-team.js --org=<ORG_UUID> --commit   # create
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xvucakstcmtfoanmgcql.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error('✗ SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const COMMIT = !!args.commit;
const ORG_ID = args.org;
if (!ORG_ID) { console.error('✗ --org=<ORG_UUID> is required'); process.exit(1); }

const PASSWORD = '123456';

// Roster. Reps carry campaign-scoped territories; admins none (full org).
// city is recorded on rep territory rows for display, but scoping uses campaign.
const TEAM = [
    { name: 'Shravani Naik',        email: 'shravani.naik@worksquare.in',                role: 'bd_rep',   territories: [{ city: 'Mumbai', campaign: 'Lower Parel' }] },
    { name: 'Shubham Gavali',       email: 'shubham.gavali@worksquare.in',               role: 'bd_rep',   territories: [{ city: 'Mumbai', campaign: 'Andheri' }] },
    { name: 'Harshini Ranganathan', email: 'harshini.ranganathan@autopilotoffices.com',  role: 'bd_rep',   territories: [{ city: 'Bangalore', campaign: 'Bangalore' }] },
    { name: 'Manjunath Kalyanpur',  email: 'manjunath.kalyanpur@autopilotoffices.com',   role: 'bd_admin', territories: [] },
    { name: 'Madhvi Jain',          email: 'madhvi.jain@worksquare.in',                  role: 'bd_admin', territories: [] },
    { name: 'Neha Kumari',          email: 'neha.kumari@worksquare.in',                  role: 'bd_rep',   territories: [{ city: 'Delhi & Noida', campaign: 'F1 Skymark' }] },
    { name: 'Saniel',               email: 'saniel@worksquare.in',                       role: 'bd_admin', territories: [] },
    { name: 'Tisha Rathod',         email: 'tishaarathod25@gmail.com',                   role: 'bd_rep',   intern: true, territories: [{ city: 'Mumbai', campaign: 'Lower Parel' }, { city: 'Mumbai', campaign: 'Andheri' }] },
];

(async () => {
    console.log(`\n${COMMIT ? '🟢 COMMIT' : '🔵 DRY RUN'}  org=${ORG_ID}\n`);

    // existing accounts by email
    const emails = TEAM.map(t => t.email);
    const { data: existing } = await sb.from('users').select('id, email').in('email', emails);
    const byEmail = new Map((existing || []).map(u => [u.email.toLowerCase(), u.id]));

    for (const m of TEAM) {
        const exists = byEmail.get(m.email.toLowerCase());
        if (exists) { console.log(`  ⏭  ${m.email.padEnd(46)} exists (${exists.slice(0, 8)}) — skipped`); continue; }

        if (!COMMIT) {
            console.log(`  ＋ ${m.email.padEnd(46)} ${m.role}${m.intern ? ' (intern)' : ''}  territories=${JSON.stringify(m.territories)}`);
            continue;
        }

        // 1. auth user (trigger on_auth_user_created creates public.users)
        const { data: created, error: cErr } = await sb.auth.admin.createUser({
            email: m.email,
            password: PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: m.name, role: m.role, ...(m.intern ? { bd_intern: true } : {}) },
        });
        if (cErr) { console.error(`  ✗ ${m.email}: ${cErr.message}`); continue; }
        const uid = created.user.id;

        // ensure public.users full_name (trigger sets it from metadata, but be explicit)
        await sb.from('users').update({ full_name: m.name }).eq('id', uid);

        // 2. org-level membership (BD roles route + scope by org membership)
        const { error: mErr } = await sb.from('organization_memberships')
            .insert({ user_id: uid, organization_id: ORG_ID, role: m.role, is_active: true });
        if (mErr && !/duplicate/i.test(mErr.message)) console.error(`  ⚠ membership ${m.email}: ${mErr.message}`);

        // 3. territories (reps only)
        for (const t of m.territories) {
            const { error: tErr } = await sb.from('crm_territories')
                .insert({ user_id: uid, city: t.city, campaign: t.campaign, is_active: true });
            if (tErr && !/duplicate/i.test(tErr.message)) console.error(`  ⚠ territory ${m.email}: ${tErr.message}`);
        }

        console.log(`  ✅ ${m.email.padEnd(46)} ${m.role}  uid=${uid.slice(0, 8)}  territories=${m.territories.length}`);
    }

    console.log(`\n${COMMIT ? '✅ done.' : '🔵 DRY RUN complete — nothing written. Re-run with --commit.'}\n`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
