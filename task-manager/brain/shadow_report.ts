/**
 * Shows what the brain WOULD have done next to what the old bot actually did, for the latest shadow-mode messages.
 *
 *   npx tsx task-manager/brain/shadow_report.ts [--limit 40]
 *
 * READ-ONLY (two SELECTs on the audit log). Sends nothing, writes nothing. The Supabase keys are read from .env and never printed.
 * Old-bot decision = the router's own "whatsapp_received" row for the same messageId.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}

async function main() {
    const i = process.argv.indexOf('--limit');
    const limit = i > -1 ? Math.max(1, Math.min(200, Number(process.argv[i + 1]) || 40)) : 40;
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');

    const { data: shadow, error } = await supabaseAdmin.from('task_audit_logs').select('created_at, details').eq('event_type', 'brain_shadow')
        .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    const rows = shadow || [];
    const ids = rows.map(r => (r.details as any)?.messageId).filter(Boolean);
    const { data: old } = ids.length
        ? await supabaseAdmin.from('task_audit_logs').select('details').eq('event_type', 'whatsapp_received').in('details->>messageId', ids)
        : { data: [] as any[] };
    const oldBy = new Map((old || []).map((o: any) => [o.details?.messageId, o.details]));

    console.log(`Latest ${rows.length} shadow message(s). BRAIN = what it would have done · OLD = what the keyword bot did.\n`);
    for (const r of rows.reverse()) {
        const d: any = r.details; const o: any = oldBy.get(d.messageId);
        console.log(`${String(r.created_at).slice(0, 19)}  ${d.phoneMasked}  (${d.messageChars} chars, ${d.ms} ms${d.fastPath ? ', fast path' : ''})`);
        console.log(`   BRAIN  ${d.status !== 'ok' ? 'AI unavailable' : `${d.intent} (${d.confidence}) → ${d.outcome}${d.reason ? `/${d.reason}` : ''}${d.actionType ? ` [${d.actionType} ×${d.actionCount}]` : ''}`}`);
        if (d.summary) console.log(`          understood: ${d.summary}`);
        if (d.replyText) console.log(`          would say : ${String(d.replyText).replace(/\n/g, ' / ').slice(0, 160)}`);
        console.log(`   OLD    ${o ? `${o.system} (${o.reason})` : '(no router row found for this message)'}\n`);
    }
}
main().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
