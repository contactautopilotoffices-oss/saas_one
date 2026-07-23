/**
 * seed-crm-stages.js — install the org's 13-stage lead lifecycle and remap
 * the existing leads onto it.
 *
 * What it does (idempotent, org-scoped to NEXT_PUBLIC_AUTOPILOT_ORG_ID):
 *   1. Upsert the 13 lifecycle stages (Warm … Close/Loss) as org statuses.
 *   2. Remap every non-archived lead from its old status (org "Hot Lead"/… and
 *      global "New Lead"/"Lost"/… ) to the matching new stage.
 *   3. Deactivate the 4 superseded org statuses so they leave the pipeline.
 *
 * SAFE BY DEFAULT — dry run unless --commit.
 *   node scripts/seed-crm-stages.js            # preview (no writes)
 *   node scripts/seed-crm-stages.js --commit   # apply
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = process.env.NEXT_PUBLIC_AUTOPILOT_ORG_ID;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('✗ SUPABASE env missing'); process.exit(1); }
if (!ORG) { console.error('✗ NEXT_PUBLIC_AUTOPILOT_ORG_ID missing'); process.exit(1); }

const COMMIT = process.argv.includes('--commit');
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// The 13 stages. `icon` is mapped by name in the frontend (frontend/lib/crm/stages.ts);
// no DB column is required, but we keep the field here for documentation.
const STAGES = [
    { name: 'Warm',          color: '#F59E0B', sort_order: 10,  is_default: true,  is_won: false, is_lost: false, is_terminal: false },
    { name: 'Ring 1',        color: '#FB923C', sort_order: 20 },
    { name: 'Ring 2',        color: '#F97316', sort_order: 30 },
    { name: 'Ring 3',        color: '#EA580C', sort_order: 40 },
    { name: 'Cold',          color: '#38BDF8', sort_order: 50 },
    { name: 'Hot',           color: '#EF4444', sort_order: 60 },
    { name: 'Future',        color: '#8B5CF6', sort_order: 70 },
    { name: 'Visit Pending', color: '#0EA5E9', sort_order: 80 },
    { name: 'Visit Done',    color: '#14B8A6', sort_order: 90 },
    { name: 'Layout Shared', color: '#A855F7', sort_order: 100 },
    { name: 'LOI',           color: '#6366F1', sort_order: 110 },
    { name: 'Close',         color: '#22C55E', sort_order: 120, is_won: true,  is_terminal: true },
    { name: 'Loss',          color: '#64748B', sort_order: 130, is_lost: true, is_terminal: true },
];

// old status name (lower) -> new stage name. Covers both the org-custom rows and
// the global defaults currently in use.
const REMAP = {
    'hot lead': 'Hot',
    'warm lead': 'Warm',
    'cold lead': 'Cold',
    'not responsive': 'Cold',
    'new lead': 'Warm',
    'contacted': 'Warm',
    'meeting scheduled': 'Visit Pending',
    'site visit scheduled': 'Visit Pending',
    'proposal shared': 'Layout Shared',
    'negotiation': 'LOI',
    'won': 'Close',
    'lost': 'Loss',
    'dropped': 'Loss',
    'on hold': 'Future',
};

// Org statuses that are superseded once the new pipeline exists.
const RETIRE = ['hot lead', 'warm lead', 'cold lead', 'not responsive'];

(async () => {
    console.log(`\n${COMMIT ? '🟢 COMMIT' : '🔵 DRY RUN'}  org=${ORG}\n`);

    // ---- 1. Upsert the 13 stages -------------------------------------------
    const { data: existing } = await sb
        .from('crm_lead_statuses')
        .select('id, name, organization_id, is_active')
        .or(`organization_id.eq.${ORG},organization_id.is.null`);
    const orgByName = new Map((existing || []).filter(s => s.organization_id === ORG).map(s => [s.name.toLowerCase(), s]));

    const stageIdByName = {}; // new stage name -> id (resolved/created)
    for (const st of STAGES) {
        const payload = {
            name: st.name, color: st.color, sort_order: st.sort_order,
            is_default: !!st.is_default, is_won: !!st.is_won, is_lost: !!st.is_lost,
            is_terminal: !!st.is_terminal, is_active: true,
        };
        const found = orgByName.get(st.name.toLowerCase());
        if (found) {
            stageIdByName[st.name] = found.id;
            if (COMMIT) await sb.from('crm_lead_statuses').update(payload).eq('id', found.id);
            console.log(`  ~ stage ${st.name.padEnd(14)} (update${st.is_default ? ', default' : ''})`);
        } else if (COMMIT) {
            const { data: created, error } = await sb.from('crm_lead_statuses')
                .insert({ ...payload, organization_id: ORG }).select('id').single();
            if (error) { console.error(`  ✗ insert ${st.name}: ${error.message}`); continue; }
            stageIdByName[st.name] = created.id;
            console.log(`  ＋ stage ${st.name.padEnd(14)} (created)`);
        } else {
            console.log(`  ＋ stage ${st.name.padEnd(14)} (would create)`);
        }
    }

    // Resolve any stage ids we couldn't create in dry-run, for reporting only.
    const resolveStageId = (name) => stageIdByName[name];

    // ---- 2. Remap leads -----------------------------------------------------
    // Build a map: current status id -> new stage name, by joining status names.
    const { data: allStatuses } = await sb
        .from('crm_lead_statuses').select('id, name, organization_id')
        .or(`organization_id.eq.${ORG},organization_id.is.null`);
    const statusName = new Map((allStatuses || []).map(s => [s.id, s.name]));

    const { data: leads } = await sb
        .from('crm_leads').select('id, status').eq('organization_id', ORG).eq('is_archived', false);
    const plan = {}; // newStageName -> count
    const updates = []; // {id, newId}
    let unmapped = 0;
    for (const l of leads || []) {
        const curName = (statusName.get(l.status) || '').toLowerCase();
        const target = REMAP[curName];
        if (!target) {
            // Already on a new stage? skip. Else count as unmapped.
            const isNewStage = STAGES.some(s => s.name.toLowerCase() === curName);
            if (!isNewStage) unmapped++;
            continue;
        }
        const newId = resolveStageId(target);
        plan[target] = (plan[target] || 0) + 1;
        if (newId && l.status !== newId) updates.push({ id: l.id, newId });
    }

    console.log(`\n  Remap plan (${leads ? leads.length : 0} leads):`);
    Object.entries(plan).forEach(([k, v]) => console.log(`    → ${k.padEnd(14)} ${v}`));
    if (unmapped) console.log(`    (unmapped/left as-is: ${unmapped})`);

    if (COMMIT) {
        let done = 0;
        // group updates by target id for fewer round-trips
        const byTarget = {};
        for (const u of updates) (byTarget[u.newId] ??= []).push(u.id);
        for (const [newId, ids] of Object.entries(byTarget)) {
            for (let i = 0; i < ids.length; i += 200) {
                const chunk = ids.slice(i, i + 200);
                const { error } = await sb.from('crm_leads').update({ status: newId }).in('id', chunk);
                if (error) { console.error(`  ✗ remap chunk: ${error.message}`); continue; }
                done += chunk.length;
            }
        }
        console.log(`  ✅ remapped ${done} leads`);
    } else {
        console.log(`  (would remap ${updates.length} leads)`);
    }

    // ---- 3. Retire superseded org statuses ---------------------------------
    const retireRows = (existing || []).filter(s => s.organization_id === ORG && RETIRE.includes(s.name.toLowerCase()));
    for (const r of retireRows) {
        console.log(`  ${COMMIT ? '🗑 ' : '(would retire) '} ${r.name}`);
        if (COMMIT) await sb.from('crm_lead_statuses').update({ is_active: false, is_default: false }).eq('id', r.id);
    }

    console.log(`\n${COMMIT ? '✅ done.' : '🔵 DRY RUN — nothing written. Re-run with --commit.'}\n`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
