/**
 * go_live_meta.js — one-shot: exchange a short-lived User token for a 60-day
 * long-lived token, store it, mirror Meta campaigns locally, and pull real spend.
 *
 *   META_SHORT_TOKEN="EAAX…" node scripts/go_live_meta.js            # dry run
 *   META_SHORT_TOKEN="EAAX…" node scripts/go_live_meta.js --commit   # apply
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';
const COMMIT = process.argv.includes('--commit');
const DAYS = 30;
const SHORT = process.env.META_SHORT_TOKEN;
const isoDate = (d) => d.toISOString().split('T')[0];
const mask = (s) => s ? (String(s).slice(0, 8) + '…' + String(s).slice(-4) + ` (len ${String(s).length})`) : '(none)';
const ts = (n) => (n === 0 ? 'NEVER ✅' : n ? new Date(n * 1000).toISOString() : '(none)');
const mapStatus = (s) => ({ ACTIVE: 'running', PAUSED: 'draft', ARCHIVED: 'cancelled', DELETED: 'cancelled' }[(s || '').toUpperCase()] || 'draft');

(async () => {
  if (!SHORT) { console.error('✗ META_SHORT_TOKEN env var required'); process.exit(1); }
  console.log(`\n${COMMIT ? '🟢 COMMIT' : '🔵 DRY RUN'}  org=${ORG_ID}\n`);

  const { data: cfg } = await sb.from('crm_meta_config').select('*').eq('organization_id', ORG_ID).maybeSingle();
  if (!cfg?.meta_app_id || !cfg?.app_secret) { console.error('✗ crm_meta_config missing app id / secret'); process.exit(1); }
  const aid = (cfg.meta_ad_account_id || '').startsWith('act_') ? cfg.meta_ad_account_id : 'act_' + cfg.meta_ad_account_id;

  // 1) Exchange short-lived → long-lived (60 days).
  console.log('⏳ Exchanging short-lived token → long-lived…');
  const exUrl = `https://graph.facebook.com/v19.0/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: cfg.meta_app_id, client_secret: cfg.app_secret, fb_exchange_token: SHORT,
  });
  const ex = await fetch(exUrl).then(r => r.json());
  if (ex.error || !ex.access_token) { console.error('✗ exchange failed:', JSON.stringify(ex.error || ex)); process.exit(1); }
  const longToken = ex.access_token;
  const expiresInDays = ex.expires_in ? Math.round(ex.expires_in / 86400) : '(none returned)';
  console.log(`✅ long-lived token: ${mask(longToken)}  | expires_in ≈ ${expiresInDays} days`);

  // 2) Confirm via debug_token.
  const appToken = `${cfg.meta_app_id}|${cfg.app_secret}`;
  const dbg = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${encodeURIComponent(longToken)}&access_token=${encodeURIComponent(appToken)}`).then(r => r.json());
  const d = dbg.data || {};
  console.log(`   debug_token → type=${d.type} valid=${d.is_valid} expires_at=${ts(d.expires_at)} scopes=[${(d.scopes || []).join(', ')}]`);

  // 3) Store it.
  if (COMMIT) {
    const upd = { meta_user_access_token: longToken, is_active: true };
    if (d.expires_at) upd.meta_token_expires_at = new Date(d.expires_at * 1000).toISOString();
    const { error } = await sb.from('crm_meta_config').update(upd).eq('organization_id', ORG_ID);
    if (error) { console.error('✗ store token failed:', error.message); process.exit(1); }
    console.log('✅ stored long-lived token in crm_meta_config');
  } else {
    console.log('🔵 (dry run) would store the long-lived token in crm_meta_config');
  }

  // 4) Mirror campaigns.
  const camps = (await fetch(`https://graph.facebook.com/v19.0/${aid}/campaigns?fields=id,name,status&limit=200&access_token=${encodeURIComponent(longToken)}`).then(r => r.json())).data || [];
  const { data: admins } = await sb.from('organization_memberships').select('user_id').eq('organization_id', ORG_ID).in('role', ['org_super_admin', 'org_admin', 'bd_admin']).eq('is_active', true).limit(1);
  const createdBy = admins?.[0]?.user_id;
  const { data: locals } = await sb.from('crm_campaigns').select('id, name, meta_campaign_id').eq('organization_id', ORG_ID);
  const byMeta = new Map((locals || []).filter(c => c.meta_campaign_id).map(c => [c.meta_campaign_id, c]));
  const byName = new Map((locals || []).map(c => [c.name.toLowerCase().trim(), c]));
  let created = 0, linked = 0, already = 0;
  console.log(`\n⏳ Mirroring ${camps.length} Meta campaigns…`);
  for (const mc of camps) {
    if (byMeta.has(mc.id)) { already++; continue; }
    const ex2 = byName.get(mc.name.toLowerCase().trim());
    if (ex2) { linked++; if (COMMIT) await sb.from('crm_campaigns').update({ meta_campaign_id: mc.id, channel: 'meta_ads' }).eq('id', ex2.id); }
    else { created++; if (COMMIT) { const { error } = await sb.from('crm_campaigns').insert({ organization_id: ORG_ID, created_by: createdBy, name: mc.name, status: mapStatus(mc.status), channel: 'meta_ads', meta_campaign_id: mc.id }); if (error) console.error(`   ⚠ insert "${mc.name}": ${error.message}`); } }
  }
  console.log(`   campaigns — created:${created} linked:${linked} alreadyLinked:${already}`);

  if (!COMMIT) { console.log('\n🔵 DRY RUN — nothing written. Re-run with --commit.'); return; }

  // 5) Pull spend (last DAYS days), upsert; never clobber manual entries.
  const { data: linkedLocal } = await sb.from('crm_campaigns').select('id, meta_campaign_id').eq('organization_id', ORG_ID).not('meta_campaign_id', 'is', null);
  const localByMeta = new Map((linkedLocal || []).map(c => [c.meta_campaign_id, c.id]));
  const localIds = Array.from(localByMeta.values());
  const since = isoDate(new Date(Date.now() - DAYS * 86400000)), until = isoDate(new Date());
  const { data: manualRows } = await sb.from('crm_campaign_spend').select('campaign_id, spend_date').eq('organization_id', ORG_ID).in('campaign_id', localIds.length ? localIds : ['00000000-0000-0000-0000-000000000000']).gte('spend_date', since).lte('spend_date', until).neq('source', 'meta_api');
  const protectedKeys = new Set((manualRows || []).map(r => `${r.campaign_id}|${r.spend_date}`));

  console.log(`\n⏳ Pulling Meta spend ${since} → ${until}…`);
  let url = `https://graph.facebook.com/v19.0/${aid}/insights?` + new URLSearchParams({ fields: 'campaign_id,spend,impressions,clicks', time_increment: '1', level: 'campaign', time_range: JSON.stringify({ since, until }), limit: '500', access_token: longToken });
  let upserted = 0, skipped = 0, totalSpend = 0, pages = 0;
  while (url && pages < 25) {
    pages++;
    const j = await fetch(url).then(r => r.json());
    if (j.error) { console.error('   insights error:', JSON.stringify(j.error)); break; }
    for (const row of (j.data || [])) {
      const cid = localByMeta.get(row.campaign_id); if (!cid) continue;
      const dateKey = row.date_start, amount = Number(row.spend || 0); totalSpend += amount;
      if (protectedKeys.has(`${cid}|${dateKey}`)) { skipped++; continue; }
      const { data: exRow } = await sb.from('crm_campaign_spend').select('id').eq('campaign_id', cid).eq('spend_date', dateKey).maybeSingle();
      if (exRow) await sb.from('crm_campaign_spend').update({ amount, source: 'meta_api' }).eq('id', exRow.id);
      else await sb.from('crm_campaign_spend').insert({ organization_id: ORG_ID, campaign_id: cid, spend_date: dateKey, amount, source: 'meta_api', notes: 'Auto-synced from Meta Marketing API' });
      upserted++;
    }
    url = j.paging?.next || null;
  }
  console.log(`   spend rows upserted: ${upserted} | manual skipped: ${skipped} | total spend in window: ₹${Math.round(totalSpend).toLocaleString('en-IN')}`);

  const { count: metaSpend } = await sb.from('crm_campaign_spend').select('id', { count: 'exact', head: true }).eq('organization_id', ORG_ID).eq('source', 'meta_api');
  console.log(`\n📊 total crm_campaign_spend rows (source=meta_api): ${metaSpend ?? 0}`);
  console.log('✅ Done. Refresh the BD Command Center — Total Spend + Spend-per-city now show real Meta ₹.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
