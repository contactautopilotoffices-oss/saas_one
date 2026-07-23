/**
 * backfill_meta_year.js — pull ~1 year of Meta campaign spend + metrics.
 *
 * Uses the stored (permanent) token in crm_meta_config. Chunks the window into
 * ~30-day slices to stay under Meta's daily-breakdown limits, upserts
 * crm_campaign_spend (spend) and crm_campaign_metrics (impressions/clicks/…).
 * Manual spend entries (source != meta_api) are never overwritten.
 *
 *   node scripts/backfill_meta_year.js            # dry run (counts only)
 *   node scripts/backfill_meta_year.js --commit   # write
 *   node scripts/backfill_meta_year.js --commit --days=365
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';
const COMMIT = process.argv.includes('--commit');
const DAYS = (() => { const a = process.argv.find(x => x.startsWith('--days=')); return a ? Math.max(1, parseInt(a.split('=')[1]) || 365) : 365; })();
const CHUNK = 30;
const isoDate = (d) => d.toISOString().split('T')[0];
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

(async () => {
  console.log(`\n${COMMIT ? '🟢 COMMIT' : '🔵 DRY RUN'}  backfill ${DAYS} days, ${CHUNK}-day chunks\n`);
  const { data: cfg } = await sb.from('crm_meta_config').select('meta_ad_account_id, meta_user_access_token').eq('organization_id', ORG_ID).maybeSingle();
  const token = cfg?.meta_user_access_token;
  const aid = (cfg?.meta_ad_account_id || '').startsWith('act_') ? cfg.meta_ad_account_id : 'act_' + cfg?.meta_ad_account_id;
  if (!token) { console.error('✗ no token'); process.exit(1); }

  const { data: linkedLocal } = await sb.from('crm_campaigns').select('id, meta_campaign_id').eq('organization_id', ORG_ID).not('meta_campaign_id', 'is', null);
  const localByMeta = new Map((linkedLocal || []).map(c => [c.meta_campaign_id, c.id]));
  const localIds = Array.from(localByMeta.values());
  console.log(`Linked campaigns: ${localIds.length}`);
  if (!localIds.length) { console.error('✗ no linked campaigns — run go_live_meta/setup first'); process.exit(1); }

  // Manual spend rows to protect (over the whole window).
  const winStart = isoDate(addDays(new Date(), -DAYS));
  const { data: manualRows } = await sb.from('crm_campaign_spend').select('campaign_id, spend_date').eq('organization_id', ORG_ID).in('campaign_id', localIds).gte('spend_date', winStart).neq('source', 'meta_api');
  const protectedKeys = new Set((manualRows || []).map(r => `${r.campaign_id}|${r.spend_date}`));

  let spendUpserts = 0, metricUpserts = 0, skipped = 0, totalSpend = 0, totalImpr = 0, totalClicks = 0, errors = 0;
  const today = new Date();

  for (let offset = 0; offset < DAYS; offset += CHUNK) {
    const until = isoDate(addDays(today, -offset));
    const since = isoDate(addDays(today, -Math.min(DAYS, offset + CHUNK)));
    let url = `https://graph.facebook.com/v19.0/${aid}/insights?` + new URLSearchParams({
      fields: 'campaign_id,spend,impressions,clicks,reach,ctr,cpc,cpm,frequency',
      time_increment: '1', level: 'campaign', time_range: JSON.stringify({ since, until }), limit: '500', access_token: token,
    });
    let pages = 0, chunkRows = 0;
    while (url && pages < 30) {
      pages++;
      const j = await fetch(url).then(r => r.json()).catch(e => ({ error: { message: e.message } }));
      if (j.error) { console.error(`   ${since}→${until} error:`, JSON.stringify(j.error)); errors++; break; }
      for (const row of (j.data || [])) {
        const cid = localByMeta.get(row.campaign_id); if (!cid) continue;
        const dateKey = row.date_start, amount = Number(row.spend || 0);
        totalSpend += amount; totalImpr += Number(row.impressions || 0); totalClicks += Number(row.clicks || 0); chunkRows++;
        if (!COMMIT) continue;
        // spend (protect manual)
        if (!protectedKeys.has(`${cid}|${dateKey}`)) {
          const { data: exRow } = await sb.from('crm_campaign_spend').select('id').eq('campaign_id', cid).eq('spend_date', dateKey).maybeSingle();
          if (exRow) await sb.from('crm_campaign_spend').update({ amount, source: 'meta_api' }).eq('id', exRow.id);
          else await sb.from('crm_campaign_spend').insert({ organization_id: ORG_ID, campaign_id: cid, spend_date: dateKey, amount, source: 'meta_api', notes: 'Backfill from Meta Marketing API' });
          spendUpserts++;
        } else skipped++;
        // metrics
        const { error: mErr } = await sb.from('crm_campaign_metrics').upsert({
          organization_id: ORG_ID, campaign_id: cid, metric_date: dateKey,
          impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0),
          reach: row.reach != null ? Number(row.reach) : null, ctr: row.ctr != null ? Number(row.ctr) : null,
          cpc: row.cpc != null ? Number(row.cpc) : null, cpm: row.cpm != null ? Number(row.cpm) : null,
          frequency: row.frequency != null ? Number(row.frequency) : null, source: 'meta_api', updated_at: new Date().toISOString(),
        }, { onConflict: 'campaign_id,metric_date' });
        if (!mErr) metricUpserts++;
      }
      url = j.paging?.next || null;
    }
    console.log(`  ${since} → ${until}: ${chunkRows} rows`);
  }

  console.log(`\nWindow totals — spend ₹${Math.round(totalSpend).toLocaleString('en-IN')} | impressions ${totalImpr.toLocaleString('en-IN')} | clicks ${totalClicks.toLocaleString('en-IN')}`);
  console.log(COMMIT ? `Written — spend upserts:${spendUpserts} metric upserts:${metricUpserts} skipped(manual):${skipped} errors:${errors}` : `🔵 DRY RUN — re-run with --commit to write.`);

  if (COMMIT) {
    const { count } = await sb.from('crm_campaign_spend').select('id', { count: 'exact', head: true }).eq('organization_id', ORG_ID).eq('source', 'meta_api');
    const { data: range } = await sb.from('crm_campaign_spend').select('spend_date').eq('organization_id', ORG_ID).eq('source', 'meta_api').order('spend_date', { ascending: true }).limit(1);
    console.log(`📊 total meta_api spend rows: ${count} | earliest: ${range?.[0]?.spend_date || '-'}`);
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
