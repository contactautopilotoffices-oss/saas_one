/**
 * VMS Face (testing) — ring the visitor's host with the Bolna approval agent, read the result,
 * retry once on no answer, then fall back to WhatsApp and let reception see "Host not answering".
 *
 * Env (names only):
 *   BOLNA_API_KEY                   shared Bolna account key
 *   VMS_FACE_BOLNA_AGENT_ID         this agent (created by scripts/vms-face-create-bolna-agent.ts)
 *   VMS_FACE_BOLNA_WEBHOOK_TOKEN    ?token= on /api/vms-face/bolna
 *   VMS_FACE_BOLNA_FROM_NUMBER      optional caller ID; falls back to BOLNA_FROM_NUMBER
 *   VMS_FACE_HOST_WA_CAMPAIGN       optional AiSensy template for the WhatsApp fallback
 */
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { getSettings, normaliseMobile } from './context';
import { hostSpoke, parseHostDecision } from './hostCallPrompt';

const BOLNA_BASE = 'https://api.bolna.ai';
const MAX_CALL_ATTEMPTS = 2; // first call + one retry
const STALE_CALL_MS = 3 * 60_000;
const FINAL_STATUSES = ['completed', 'call-disconnected', 'no-answer', 'busy', 'failed', 'canceled', 'balance-low', 'error', 'stopped'];

export const PURPOSE_LABELS: Record<string, string> = {
    meeting: 'a meeting', interview: 'an interview', delivery: 'a delivery',
    vendor_work: 'vendor work', personal: 'a personal visit', other: 'a visit',
};

export const isHostCallConfigured = () => !!(process.env.BOLNA_API_KEY && process.env.VMS_FACE_BOLNA_AGENT_ID);

interface VisitRow {
    id: string;
    organization_id: string;
    property_id: string;
    name: string;
    coming_from: string | null;
    purpose: string | null;
    host_id: string | null;
    status: string;
    approval_status: string;
    host_call_status: string;
    host_call_attempts: number;
    host_call_execution_id: string | null;
    host_whatsapp_sent_at: string | null;
}

const VISIT_FIELDS = 'id, organization_id, property_id, name, coming_from, purpose, host_id, status, approval_status, host_call_status, host_call_attempts, host_call_execution_id, host_whatsapp_sent_at';

async function loadCallContext(visit: VisitRow) {
    const [{ data: host }, { data: property }] = await Promise.all([
        visit.host_id
            ? supabaseAdmin.from('users').select('full_name, phone').eq('id', visit.host_id).maybeSingle()
            : Promise.resolve({ data: null }),
        supabaseAdmin.from('properties').select('name').eq('id', visit.property_id).maybeSingle(),
    ]);
    return {
        hostName: (host?.full_name as string | undefined) || 'there',
        hostPhone: normaliseMobile(host?.phone),
        propertyName: (property?.name as string | undefined) || 'the building',
    };
}

async function placeBolnaCall(to: string, userData: Record<string, string>): Promise<{ ok: true; executionId: string } | { ok: false; error: string }> {
    try {
        const body: Record<string, unknown> = {
            agent_id: process.env.VMS_FACE_BOLNA_AGENT_ID,
            recipient_phone_number: to,
            user_data: userData,
        };
        const from = process.env.VMS_FACE_BOLNA_FROM_NUMBER || process.env.BOLNA_FROM_NUMBER;
        if (from) body.from_phone_number = from;
        const res = await fetch(`${BOLNA_BASE}/call`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.execution_id) return { ok: false, error: `Bolna ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
        return { ok: true, executionId: String(data.execution_id) };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Ring the host for a pending visit. Marks the visit 'skipped' when there is nothing to call
 * (no host picked, no phone on file, switched off, Bolna not set up). Never throws.
 */
export async function startHostCall(visitId: string): Promise<{ status: string; error?: string }> {
    const { data: visit } = await supabaseAdmin.from('vms_face_visits').select(VISIT_FIELDS).eq('id', visitId).maybeSingle<VisitRow>();
    if (!visit) return { status: 'failed', error: 'Visit not found' };
    if (visit.status !== 'checked_in' || visit.approval_status !== 'pending') return { status: visit.host_call_status };

    const settings = await getSettings(visit.organization_id);
    const ctx = await loadCallContext(visit);
    const skip = async (reason: string) => {
        await supabaseAdmin.from('vms_face_visits')
            .update({ host_call_status: 'skipped', host_call_updated_at: new Date().toISOString() })
            .eq('id', visit.id);
        return { status: 'skipped', error: reason };
    };

    if (!settings.host_call_enabled) return skip('Host calls are switched off');
    if (!isHostCallConfigured()) return skip('Bolna host-call agent is not configured');
    if (!visit.host_id) return skip('No host selected');
    if (!ctx.hostPhone) return skip('Host has no valid mobile number on file');
    if (visit.host_call_attempts >= MAX_CALL_ATTEMPTS) return { status: visit.host_call_status };

    const call = await placeBolnaCall(ctx.hostPhone, {
        visit_id: visit.id,
        host_name: ctx.hostName,
        visitor_name: visit.name,
        visitor_company: visit.coming_from || 'their company',
        purpose: PURPOSE_LABELS[visit.purpose || ''] || 'a visit',
        property_name: ctx.propertyName,
    });

    const attempts = visit.host_call_attempts + 1;
    if (!call.ok) {
        await supabaseAdmin.from('vms_face_visits')
            .update({ host_call_status: 'failed', host_call_attempts: attempts, host_call_updated_at: new Date().toISOString() })
            .eq('id', visit.id);
        await sendHostWhatsApp(visit, ctx);
        return { status: 'failed', error: call.error };
    }

    await supabaseAdmin.from('vms_face_visits')
        .update({
            host_call_status: 'calling',
            host_call_attempts: attempts,
            host_call_execution_id: call.executionId,
            host_call_updated_at: new Date().toISOString(),
        })
        .eq('id', visit.id);
    return { status: 'calling' };
}

async function sendHostWhatsApp(visit: VisitRow, ctx: { hostName: string; hostPhone: string | null; propertyName: string }) {
    const campaign = process.env.VMS_FACE_HOST_WA_CAMPAIGN;
    if (!campaign || !ctx.hostPhone || visit.host_whatsapp_sent_at) return;
    const sent = await AiSensyService.sendTemplate({
        phone: ctx.hostPhone,
        campaignName: campaign,
        templateParams: [ctx.hostName, visit.name, visit.coming_from || '-', PURPOSE_LABELS[visit.purpose || ''] || 'a visit', ctx.propertyName],
    });
    if (sent.success) {
        await supabaseAdmin.from('vms_face_visits').update({ host_whatsapp_sent_at: new Date().toISOString() }).eq('id', visit.id);
    }
}

export interface BolnaExecution {
    id?: string;
    execution_id?: string;
    agent_id?: string;
    status?: string;
    transcript?: string;
    context_details?: { recipient_data?: Record<string, unknown> };
}

/**
 * Apply one Bolna execution (from the webhook or a poll) to its visit. Only the visit whose
 * current call id matches is touched, and only while it is still 'calling'.
 */
export async function handleExecution(ex: BolnaExecution): Promise<string> {
    const executionId = String(ex.id || ex.execution_id || '');
    const status = String(ex.status || '').toLowerCase();
    if (!executionId) return 'ignored: no execution id';
    if (ex.agent_id && ex.agent_id !== process.env.VMS_FACE_BOLNA_AGENT_ID) return 'ignored: other agent';
    if (!FINAL_STATUSES.includes(status)) return `ignored: status ${status || 'unknown'}`;

    const visitId = String(ex.context_details?.recipient_data?.visit_id || '');
    let query = supabaseAdmin.from('vms_face_visits').select(VISIT_FIELDS).eq('host_call_execution_id', executionId);
    if (visitId) query = query.eq('id', visitId);
    const { data: visit } = await query.maybeSingle<VisitRow>();
    if (!visit) return 'ignored: no matching visit';
    if (visit.host_call_status !== 'calling') return 'ignored: already handled';

    const transcript = ex.transcript || '';
    const answered = ['completed', 'call-disconnected'].includes(status) && hostSpoke(transcript);
    const now = new Date().toISOString();

    if (answered) {
        const decision = parseHostDecision(transcript);
        // Claim the row first so a duplicate webhook cannot apply the result twice.
        const { data: claimed } = await supabaseAdmin.from('vms_face_visits')
            .update({ host_call_status: 'answered', host_call_transcript: transcript.slice(0, 20000), host_call_updated_at: now })
            .eq('id', visit.id).eq('host_call_status', 'calling').eq('host_call_execution_id', executionId)
            .select('id').maybeSingle();
        if (!claimed) return 'ignored: already handled';

        if (decision !== 'unclear' && visit.approval_status === 'pending') {
            await supabaseAdmin.from('vms_face_visits')
                .update({ approval_status: decision, approved_via: 'voice_call' })
                .eq('id', visit.id).eq('approval_status', 'pending');
        }
        if (decision === 'unclear') await sendHostWhatsApp(visit, await loadCallContext(visit));
        return `answered: ${decision}`;
    }

    // Not answered (or nobody spoke). Retry once, then WhatsApp + "Host not answering".
    const { data: claimed } = await supabaseAdmin.from('vms_face_visits')
        .update({ host_call_status: 'no_answer', host_call_transcript: transcript.slice(0, 20000) || null, host_call_updated_at: now })
        .eq('id', visit.id).eq('host_call_status', 'calling').eq('host_call_execution_id', executionId)
        .select('id').maybeSingle();
    if (!claimed) return 'ignored: already handled';

    if (visit.host_call_attempts < MAX_CALL_ATTEMPTS && visit.approval_status === 'pending') {
        const retry = await startHostCall(visit.id);
        return `no answer: retry ${retry.status}`;
    }
    await sendHostWhatsApp(visit, await loadCallContext(visit));
    return 'no answer: gave up';
}

/** Safety net for a webhook that never arrived: poll calls stuck in 'calling' for this property. */
export async function refreshStaleCalls(propertyId: string): Promise<void> {
    if (!process.env.BOLNA_API_KEY) return;
    const { data: stale } = await supabaseAdmin.from('vms_face_visits')
        .select('host_call_execution_id')
        .eq('property_id', propertyId)
        .eq('host_call_status', 'calling')
        .lt('host_call_updated_at', new Date(Date.now() - STALE_CALL_MS).toISOString())
        .limit(3);
    for (const row of stale || []) {
        if (!row.host_call_execution_id) continue;
        try {
            const res = await fetch(`${BOLNA_BASE}/executions/${encodeURIComponent(row.host_call_execution_id)}`, {
                headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}` },
            });
            if (res.ok) await handleExecution(await res.json());
        } catch (e) {
            console.error('[VMS Face] Stale call poll failed:', e);
        }
    }
}
