import { supabaseAdmin } from '@/backend/lib/supabase/admin';
/* eslint-disable @typescript-eslint/no-explicit-any -- audit-log JSON is schemaless and normalized immediately */
import { computeBotHealth, alertKinds, singleLineAlert, type BotHealthMetrics } from './BotHealth';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';

/** Approved template "System Incident Alert" — one blank: the incident details (one line). */
export const ADMIN_ALERT_CAMPAIGN = process.env.AISENSY_BOT_ADMIN_ALERT_CAMPAIGN || 'whatsapp_bot_admin_alert_v2';

export async function readBotHealth(now = new Date()): Promise<BotHealthMetrics & { window15: { apologies: number; aiFailures: number; brainMessages: number } }> {
    const since24 = new Date(now.getTime() - 86400_000).toISOString(), since15 = new Date(now.getTime() - 15 * 60_000).toISOString();
    const [ledger, audits, reviews] = await Promise.all([
        supabaseAdmin.from('whatsapp_inbound_ledger').select('received_at,replied_at,apology_sent_at').gte('received_at', since24),
        supabaseAdmin.from('task_audit_logs').select('event_type,details,created_at').gte('created_at', since24).in('event_type', ['brain_live', 'brain_fallback', 'whatsapp_fallback']),
        supabaseAdmin.from('whatsapp_bot_review_items').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
    ]);
    if (ledger.error) throw ledger.error; if (audits.error) throw audits.error; if (reviews.error) throw reviews.error;
    const ar = (audits.data || []) as any[];
    const failed = (x: any) => x.details?.status === 'ai_unavailable' || x.details?.aiUnavailable === true;
    const base = computeBotHealth((ledger.data || []).map((r: any) => ({ receivedAt: Date.parse(r.received_at), repliedAt: r.replied_at ? Date.parse(r.replied_at) : null, apology: !!r.apology_sent_at })), {
        fallbacks: ar.filter(x => x.event_type.includes('fallback') || x.details?.fallback === true).length, aiFailures: ar.filter(failed).length,
        brainMessages: ar.filter(x => x.event_type === 'brain_live').length, reviewWaiting: reviews.count || 0,
    });
    const recent = ar.filter(x => x.created_at >= since15);
    const ledger15 = (ledger.data || []).filter((x: any) => x.received_at >= since15);
    return { ...base, window15: { apologies: ledger15.filter((x: any) => !!x.apology_sent_at).length, aiFailures: recent.filter(failed).length, brainMessages: recent.filter(x => x.event_type === 'brain_live').length } };
}

export async function sendHealthAlerts(now = new Date()): Promise<number> {
    const health = await readBotHealth(now); const kinds = alertKinds(health.window15); if (!kinds.length) return 0;
    const cfg = await TaskDatabaseService.getTestingConfig(); const admins = cfg.botAlertAdmins || []; if (!admins.length) return 0;
    let sent = 0; const since = new Date(now.getTime() - 3600_000).toISOString();
    for (const kind of kinds) {
        const { count } = await supabaseAdmin.from('task_audit_logs').select('id', { count: 'exact', head: true }).eq('event_type', 'bot_admin_alert_attempted').eq('details->>kind', kind).gte('created_at', since);
        if (count) continue;
        const text = singleLineAlert(kind === 'apology_spike' ? `Bot health alert: ${health.window15.apologies} apologies in the last 15 minutes. Open Task Manager Bot Health.` : `Bot health alert: ${health.window15.aiFailures} of ${health.window15.brainMessages} Smart-chat messages had AI failures in the last 15 minutes. Open Task Manager Bot Health.`);
        await TaskDatabaseService.logAudit({ eventType: 'bot_admin_alert_attempted', details: { kind, recipients: admins.length } });
        let delivered = 0; for (const admin of admins) if (await TaskMessagingService.sendTemplateNotification({ phone: admin.phone, campaignName: ADMIN_ALERT_CAMPAIGN, templateParams: [text] })) { sent++; delivered++; }
        await TaskDatabaseService.logAudit({ eventType: delivered ? 'bot_admin_alert_sent' : 'bot_admin_alert_failed', details: { kind, recipients: admins.length, delivered } });
    }
    return sent;
}

export async function alertWaitingPrompt(promptId: string, summary: string): Promise<number> {
    const { count } = await supabaseAdmin.from('task_audit_logs').select('id', { count: 'exact', head: true }).eq('event_type', 'bot_prompt_waiting_alert_attempted').eq('details->>promptId', promptId);
    if (count) return 0;
    const admins = (await TaskDatabaseService.getTestingConfig()).botAlertAdmins || []; let delivered = 0;
    const text = singleLineAlert(`A new AI-instruction version is waiting for approval: ${summary}. Open Prompt versions to review it.`);
    await TaskDatabaseService.logAudit({ eventType: 'bot_prompt_waiting_alert_attempted', details: { promptId, recipients: admins.length } });
    for (const admin of admins) if (await TaskMessagingService.sendTemplateNotification({ phone: admin.phone, campaignName: ADMIN_ALERT_CAMPAIGN, templateParams: [text] })) delivered++;
    await TaskDatabaseService.logAudit({ eventType: delivered ? 'bot_prompt_waiting_alert_sent' : 'bot_prompt_waiting_alert_failed', details: { promptId, recipients: admins.length, delivered } }); return delivered;
}
