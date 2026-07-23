/**
 * setup_meta_spend.js — finish wiring Meta Marketing API spend for an org.
 *
 * PREREQUISITE: crm_meta_config.meta_user_access_token must be a VALID, current
 * token (refresh it first — short-lived tokens expire in ~1-2h; use a long-lived
 * or system-user token). If the token is expired this script tells you and stops.
 *
 * What it does:
 *   1. Lists your real campaigns from the Meta Marketing API (proves the token).
 *   2. Creates/links local crm_campaigns rows (channel=meta_ads, meta_campaign_id set).
 *   3. Triggers the real sync (/api/cron/sync-meta-insights via the dev server)
 *      so spend lands in crm_campaign_spend.
 *   4. Reports the spend rows that landed.
 *
 * SAFE BY DEFAULT — dry run unless --commit.
 *   node scripts/setup_meta_spend.js            # preview Meta campaigns + planned links
 *   node scripts/setup_meta_spend.js --commit   # create/link campaigns + run the sync
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';
const COMMIT = process.argv.includes('--commit');
const DEV_URL = process.env.APP_URL || 'http://localhost:3000';
// Backfill window for this manual run (the production cron uses a rolling 4 days).
const DAYS = (() => { const a = process.argv.find(x => x.startsWith('--days=')); return a ? Math.max(1, parseInt(a.split('=')[1]) || 30) : 30; })();
const isoDate = (d) => d.toISOString().split('T')[0];

// Map Meta status -> local crm_campaigns.status enum.
function mapStatus(metaStatus) {
  switch ((metaStatus || '').toUpperCase()) {
    case 'ACTIVE': return 'running';
    case 'PAUSED': return 'draft';
    case 'ARCHIVED':
    case 'DELETED': return 'cancelled';
    default: return 'draft';
  }
}

(async () => {
  console.log(`\n${COMMIT ? '🟢 COMMIT' : '🔵 DRY RUN'}  org=${ORG_ID}\n`);

  // 0) Config + a created_by (any CRM admin in the org).
  const { data: cfg } = await sb.from('crm_meta_config')
    .select('meta_ad_account_id, meta_user_access_token')
    .eq('organization_id', ORG_ID).maybeSingle();
  if (!cfg?.meta_ad_account_id || !cfg?.meta_user_access_token) {
    console.error('✗ crm_meta_config missing ad account id or token. Configure it first.'); process.exit(1);
  }
  const { data: admins, error: admErr } = await sb.from('organization_memberships')
    .select('user_id').eq('organization_id', ORG_ID)
    .in('role', ['org_super_admin', 'org_admin', 'bd_admin'])
    .eq('is_active', true).limit(1);
  if (admErr) console.error('  (admin lookup error:', admErr.message, ')');
  const createdBy = admins?.[0]?.user_id;
  if (!createdBy) { console.error('✗ no admin user found to own campaigns'); process.exit(1); }

  // 1) Fetch Meta campaigns (validates the token).
  const aid = cfg.meta_ad_account_id.startsWith('act_') ? cfg.meta_ad_account_id : 'act_' + cfg.meta_ad_account_id;
  const url = `https://graph.facebook.com/v19.0/${aid}/campaigns?fields=id,name,status,effective_status&limit=200&access_token=${encodeURIComponent(cfg.meta_user_access_token)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok) {
    if (j?.error?.code === 190) {
      console.error('🔴 Meta token is EXPIRED/INVALID:', j.error.message);
      console.error('   → Refresh the token (Graph API Explorer / Business Settings → System User token),');
      console.error('     update crm_meta_config.meta_user_access_token, then re-run this script.');
    } else {
      console.error('✗ Meta API error:', JSON.stringify(j.error));
    }
    process.exit(1);
  }
  const metaCampaigns = j.data || [];
  console.log(`✅ Token valid. ${metaCampaigns.length} Meta campaigns found.`);

  // 2) Existing local campaigns (match by meta_campaign_id, then by name).
  const { data: locals } = await sb.from('crm_campaigns')
    .select('id, name, meta_campaign_id').eq('organization_id', ORG_ID);
  const byMetaId = new Map((locals || []).filter(c => c.meta_campaign_id).map(c => [c.meta_campaign_id, c]));
  const byName = new Map((locals || []).map(c => [c.name.toLowerCase().trim(), c]));

  let created = 0, linked = 0, already = 0;
  for (const mc of metaCampaigns) {
    if (byMetaId.has(mc.id)) { already++; console.log(`  ⏭  ${mc.name} — already linked`); continue; }
    const existing = byName.get(mc.name.toLowerCase().trim());
    if (existing) {
      console.log(`  🔗 link "${mc.name}" → ${mc.id} (existing local campaign)`);
      if (COMMIT) {
        await sb.from('crm_campaigns').update({ meta_campaign_id: mc.id, channel: 'meta_ads' }).eq('id', existing.id);
      }
      linked++;
    } else {
      console.log(`  ＋ create "${mc.name}" (${mapStatus(mc.status)}) → ${mc.id}`);
      if (COMMIT) {
        const { error } = await sb.from('crm_campaigns').insert({
          organization_id: ORG_ID, created_by: createdBy, name: mc.name,
          status: mapStatus(mc.status), channel: 'meta_ads', meta_campaign_id: mc.id,
        });
        if (error) console.error(`    ⚠ insert failed: ${error.message}`);
      }
      created++;
    }
  }
  console.log(`\nCampaigns — created:${created} linked:${linked} alreadyLinked:${already}`);

  if (!COMMIT) {
    console.log('\n🔵 DRY RUN — nothing written. Re-run with --commit to create/link + sync.');
    return;
  }

  // 3) Inline spend sync — same logic as backend/services/metaInsightsSync.ts,
  //    but self-contained (no dev server / CRON_SECRET needed). Pulls the last
  //    DAYS days of campaign-level spend and upserts crm_campaign_spend.
  //    Manual entries (source != meta_api) are never clobbered.
  const { data: linkedLocal } = await sb.from('crm_campaigns')
    .select('id, meta_campaign_id').eq('organization_id', ORG_ID).not('meta_campaign_id', 'is', null);
  const localByMeta = new Map((linkedLocal || []).map(c => [c.meta_campaign_id, c.id]));
  const localIds = Array.from(localByMeta.values());

  const since = isoDate(new Date(Date.now() - DAYS * 86400000));
  const until = isoDate(new Date());
  console.log(`\n⏳ Pulling Meta spend ${since} → ${until} (level=campaign, time_increment=1)…`);

  // Protected (manual) rows we must not overwrite.
  const { data: manualRows } = await sb.from('crm_campaign_spend')
    .select('campaign_id, spend_date').eq('organization_id', ORG_ID)
    .in('campaign_id', localIds.length ? localIds : ['00000000-0000-0000-0000-000000000000'])
    .gte('spend_date', since).lte('spend_date', until).neq('source', 'meta_api');
  const protectedKeys = new Set((manualRows || []).map(r => `${r.campaign_id}|${r.spend_date}`));

  // Paginate insights.
  let url = `https://graph.facebook.com/v19.0/${aid}/insights?` + new URLSearchParams({
    fields: 'campaign_id,campaign_name,spend,impressions,clicks',
    time_increment: '1', level: 'campaign',
    time_range: JSON.stringify({ since, until }), limit: '500',
    access_token: cfg.meta_user_access_token,
  });
  let upserted = 0, skipped = 0, totalSpend = 0, pages = 0;
  while (url && pages < 25) {
    pages++;
    const j = await fetch(url).then(r => r.json());
    if (j.error) { console.error('   insights error:', JSON.stringify(j.error)); break; }
    for (const row of (j.data || [])) {
      const cid = localByMeta.get(row.campaign_id);
      if (!cid) continue;
      const dateKey = row.date_start;
      const amount = Number(row.spend || 0);
      totalSpend += amount;
      if (protectedKeys.has(`${cid}|${dateKey}`)) { skipped++; continue; }
      const { data: ex } = await sb.from('crm_campaign_spend')
        .select('id').eq('campaign_id', cid).eq('spend_date', dateKey).maybeSingle();
      if (ex) {
        await sb.from('crm_campaign_spend').update({ amount, source: 'meta_api' }).eq('id', ex.id);
      } else {
        await sb.from('crm_campaign_spend').insert({
          organization_id: ORG_ID, campaign_id: cid, spend_date: dateKey,
          amount, source: 'meta_api', notes: 'Auto-synced from Meta Marketing API',
        });
      }
      upserted++;
    }
    url = j.paging?.next || null;
  }
  console.log(`   spend rows upserted: ${upserted} | manual skipped: ${skipped} | total spend in window: ₹${Math.round(totalSpend).toLocaleString('en-IN')}`);

  // 4) Report.
  const { count: metaSpend } = await sb.from('crm_campaign_spend')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ORG_ID).eq('source', 'meta_api');
  console.log(`\n📊 crm_campaign_spend rows with source=meta_api: ${metaSpend ?? 0}`);
  console.log('✅ Done. Refresh the BD Command Center — Total Spend + Spend-per-city now use real Meta data.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
