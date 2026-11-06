/**
 * Phase 0 baseline (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md): how the WhatsApp bot is doing today, per day, so later phases can
 * prove they helped.
 *
 *   npx tsx task-manager/brain/baseline_report.ts [--days 7]
 *
 * READ-ONLY (SELECTs on task_audit_logs and whatsapp_assistant_events). Sends nothing, writes nothing. The Supabase keys are
 * read from .env and never printed. Prints counts only — no phone numbers, names, message text or previews.
 *
 * Honest limit: real replies to users are NOT written to the audit log today (only Pretend-Mode ones are), so
 * "messages that got no reply" cannot be counted yet. Phase 1's inbound ledger fixes that.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface AuditRow { created_at: string; event_type: string; details: any }
export interface QueueRow { created_at: string; updated_at: string | null; status: string; attempts: number | null }
/** Phase 1 "never silent" ledger row (no message text). */
export interface LedgerRow { route: string | null; received_at: string; replied_at: string | null; apology_sent_at: string | null }

export const AUDIT_EVENTS = ['whatsapp_received', 'brain_live', 'brain_shadow', 'voice_note', 'whatsapp_sent', 'whatsapp_blocked_by_kill_switch'];

/** Old-router reasons that mean the person got a menu, a help text or the facility default instead of an answer. */
export const FALLBACK_REASONS: Record<string, string> = {
    ambiguous_employee_greeting_or_help: 'menu (greeting / help)',
    nl_unclear_in_task_session: 'menu (unclear during a task chat)',
    active_task_context: 'old task help reply',
    default_facility_fallback: 'sent to facility by default',
};

const STUCK_MS = 10 * 60_000;

/** IST calendar day, e.g. 2026-10-10. */
export function istDay(iso: string): string {
    return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] || 0) + by; };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export interface DayStats {
    inbound: { router: number; smartChat: number; voice: number; facilityQueue: number };
    routerBySystem: Record<string, number>;
    fallbacks: Record<string, number>;
    smartChatOutcomes: Record<string, number>;
    shadow: { total: number; aiUnavailable: number; outcomes: Record<string, number> };
    scheduled: Record<string, number>;   // "<type> · <status>"
    blocked: number;
}

export interface Baseline {
    days: string[];
    byDay: Record<string, DayStats>;
    brainMs: number[];
    queue: Record<string, number>;
    queueStuck: number;
    queueRetried: number;
    /** null = the ledger table is not there yet, or the switch has never been on. */
    ledger: { routed: number; replied: number; apologised: number; silent: number } | null;
}

const emptyDay = (): DayStats => ({
    inbound: { router: 0, smartChat: 0, voice: 0, facilityQueue: 0 }, routerBySystem: {}, fallbacks: {},
    smartChatOutcomes: {}, shadow: { total: 0, aiUnavailable: 0, outcomes: {} }, scheduled: {}, blocked: 0,
});

/** Pure: turns raw rows into per-day counts. No I/O. */
export function summarize(audit: AuditRow[], queue: QueueRow[], now = new Date(), ledgerRows: LedgerRow[] | null = null): Baseline {
    const byDay: Record<string, DayStats> = {};
    const day = (iso: string) => (byDay[istDay(iso)] ||= emptyDay());
    const brainMs: number[] = [];

    for (const r of audit) {
        const d = r.details || {};
        const s = day(r.created_at);
        switch (r.event_type) {
            case 'whatsapp_received':
                s.inbound.router++;
                inc(s.routerBySystem, String(d.system || 'unknown'));
                if (FALLBACK_REASONS[d.reason]) inc(s.fallbacks, FALLBACK_REASONS[d.reason]);
                break;
            case 'brain_live':
                s.inbound.smartChat++;
                inc(s.smartChatOutcomes, d.status && d.status !== 'ok' ? 'ai_unavailable' : String(d.outcome || 'unknown'));
                if (typeof d.ms === 'number') brainMs.push(d.ms);
                break;
            case 'brain_shadow':
                s.shadow.total++;
                if (d.status && d.status !== 'ok') s.shadow.aiUnavailable++;
                else inc(s.shadow.outcomes, String(d.outcome || 'unknown'));
                if (typeof d.ms === 'number') brainMs.push(d.ms);
                break;
            case 'voice_note':
                s.inbound.voice++;
                break;
            case 'whatsapp_sent':
                // Bot replies only appear here in Pretend Mode; scheduled notifications always do.
                if (d.type === 'bot_reply') break;
                inc(s.scheduled, `${d.type || 'unknown'} · ${d.status || 'unknown'}`);
                break;
            case 'whatsapp_blocked_by_kill_switch':
                s.blocked++;
                break;
        }
    }

    const q: Record<string, number> = {};
    let queueStuck = 0; let queueRetried = 0;
    for (const e of queue) {
        day(e.created_at).inbound.facilityQueue++;
        inc(q, e.status);
        if ((e.attempts || 0) > 1) queueRetried++;
        if ((e.status === 'pending' || e.status === 'processing' || e.status === 'ready')
            && now.getTime() - new Date(e.updated_at || e.created_at).getTime() > STUCK_MS) queueStuck++;
    }

    let ledger: Baseline['ledger'] = null;
    if (ledgerRows) {
        const routed = ledgerRows.filter(r => r.route);
        ledger = {
            routed: routed.length,
            replied: routed.filter(r => r.replied_at).length,
            apologised: routed.filter(r => !r.replied_at && r.apology_sent_at).length,
            // no reply and no apology, and old enough that one was due (the watchdog waits 2 minutes)
            silent: routed.filter(r => !r.replied_at && !r.apology_sent_at && now.getTime() - new Date(r.received_at).getTime() > 3 * 60_000).length,
        };
    }

    return { days: Object.keys(byDay).sort(), byDay, brainMs, queue: q, queueStuck, queueRetried, ledger };
}

const fmt = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '–';

/** Pure: the printable report. */
export function render(b: Baseline, daysAsked: number): string {
    const out: string[] = [];
    const tot = { router: 0, smart: 0, voice: 0, queue: 0, fallback: 0, shadow: 0, shadowDown: 0, failedSched: 0, sentSched: 0 };
    out.push(`WhatsApp bot baseline — last ${daysAsked} day(s), IST. Counts only.\n`);

    for (const k of b.days) {
        const s = b.byDay[k];
        const fb = Object.values(s.fallbacks).reduce((a, v) => a + v, 0);
        tot.router += s.inbound.router; tot.smart += s.inbound.smartChat; tot.voice += s.inbound.voice; tot.queue += s.inbound.facilityQueue;
        tot.fallback += fb; tot.shadow += s.shadow.total; tot.shadowDown += s.shadow.aiUnavailable;
        for (const [key, v] of Object.entries(s.scheduled)) { if (key.endsWith('· failed')) tot.failedSched += v; if (key.endsWith('· sent')) tot.sentSched += v; }

        out.push(`── ${k} ──────────────────────────────`);
        out.push(`  Messages in      old router ${s.inbound.router} · Smart chat ${s.inbound.smartChat} · voice ${s.inbound.voice} · facility AI queue ${s.inbound.facilityQueue}`);
        out.push(`  Old router went  ${fmt(s.routerBySystem)}`);
        out.push(`  Fallbacks        ${fb} (${pct(fb, s.inbound.router)} of old-router messages)${fb ? ` — ${fmt(s.fallbacks)}` : ''}`);
        if (s.inbound.smartChat) out.push(`  Smart chat       ${fmt(s.smartChatOutcomes)}`);
        if (s.shadow.total) out.push(`  Shadow (AI)      ${s.shadow.total} read · AI unavailable ${s.shadow.aiUnavailable} · ${fmt(s.shadow.outcomes)}`);
        if (Object.keys(s.scheduled).length) out.push(`  Scheduled sends  ${fmt(s.scheduled)}`);
        if (s.blocked) out.push(`  Blocked          ${s.blocked} by kill switch`);
        out.push('');
    }

    const ms = median(b.brainMs);
    out.push('══ TOTALS ═══════════════════════════════');
    out.push(`  Messages in       ${tot.router + tot.smart + tot.voice + tot.queue}  (old router ${tot.router} · Smart chat ${tot.smart} · voice ${tot.voice} · facility AI ${tot.queue})`);
    out.push(`  Fallback rate     ${tot.fallback} / ${tot.router} old-router messages = ${pct(tot.fallback, tot.router)}`);
    out.push(`  AI (shadow)       ${tot.shadow ? `${tot.shadow} read · unavailable ${pct(tot.shadowDown, tot.shadow)}` : 'no shadow rows — is TASK_BRAIN_SHADOW=true on Vercel, sandbox ON?'}`);
    out.push(`  AI median time    ${ms === null ? '–' : `${ms} ms`}`);
    out.push(`  Scheduled sends   accepted by AiSensy ${tot.sentSched} · failed ${tot.failedSched}  (accepted ≠ delivered: Meta can still reject — the red "!")`);
    out.push(`  Facility AI queue ${fmt(b.queue)} · stuck >10 min ${b.queueStuck} · retried ${b.queueRetried}`);
    if (b.ledger) {
        const l = b.ledger;
        out.push(`  No-reply count    ${l.silent} silent · ${l.apologised} got only an apology · ${l.replied} answered — of ${l.routed} Task Manager messages`);
    } else {
        out.push(`  No-reply count    NOT MEASURABLE YET — apply the Phase 1 ledger migration and set WHATSAPP_NEVER_SILENT_ENABLED=true.`);
    }
    return out.join('\n');
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
    const page = 1000; const rows: T[] = [];
    for (let from = 0; ; from += page) {
        const { data, error } = await build(from, from + page - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < page) return rows;
    }
}

async function main() {
    const root = path.resolve(__dirname, '../..');
    const envFile = path.join(root, '.env');
    if (fs.existsSync(envFile)) {
        for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
    const i = process.argv.indexOf('--days');
    const days = i > -1 ? Math.max(1, Math.min(30, Number(process.argv[i + 1]) || 7)) : 7;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');

    const audit = await fetchAll<AuditRow>((a, b) => supabaseAdmin.from('task_audit_logs').select('created_at, event_type, details')
        .in('event_type', AUDIT_EVENTS).gte('created_at', since).order('created_at').range(a, b));
    let queue: QueueRow[] = [];
    try {
        queue = await fetchAll<QueueRow>((a, b) => supabaseAdmin.from('whatsapp_assistant_events').select('created_at, updated_at, status, attempts')
            .gte('created_at', since).order('created_at').range(a, b));
    } catch { console.warn('(facility AI queue not readable — skipped)\n'); }

    let ledger: LedgerRow[] | null = null;
    try {
        ledger = await fetchAll<LedgerRow>((a, b) => supabaseAdmin.from('whatsapp_inbound_ledger').select('route, received_at, replied_at, apology_sent_at')
            .gte('received_at', since).order('received_at').range(a, b));
    } catch { /* Phase 1 ledger not installed yet */ }

    console.log(render(summarize(audit, queue, new Date(), ledger), days));
}

if (require.main === module) main().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
