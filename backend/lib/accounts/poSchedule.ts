import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isPoEligible } from '@/backend/lib/invoices/types';
import type { MilestoneBasis, MilestoneTrigger } from './paymentSchedule';

/**
 * Shared pieces of the PO payment schedule: loading what the parser needs, working out
 * when each milestone's trigger was REACHED, and checking a schedule a person has edited.
 *
 * "Reached" is evidence, not a decision. It says "the log shows delivery on 3 Oct" or "25%
 * was recorded on 12 Oct". Whether the money is due is Purchase's click; a milestone can be
 * marked due before it is reached, but that is recorded as early.
 */

export interface SchedulePo {
    id: string; po_number: string; vendor_name: string | null; po_amount: number | null; status: string | null;
    po_date: string | null; project_name: string | null;
}

export async function loadPoForSchedule(orgId: string, poId: string): Promise<{ po: SchedulePo; text: string; basic: number | null } | null> {
    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders')
        .select('id, po_number, vendor_name, po_amount, status, po_date, project_name, detail')
        .eq('id', poId).eq('organization_id', orgId).maybeSingle();
    if (!po) return null;
    const { data: lines } = await supabaseAdmin.from('zoho_po_line_items').select('item_total').eq('po_id', poId);
    const basic = (lines ?? []).reduce((s, l) => s + Number(l.item_total ?? 0), 0);
    const d = (po.detail ?? {}) as { terms?: string; notes?: string };
    return {
        po: { id: po.id, po_number: po.po_number, vendor_name: po.vendor_name, po_amount: po.po_amount == null ? null : Number(po.po_amount), status: po.status, po_date: po.po_date, project_name: po.project_name },
        text: [d.terms, d.notes].filter(Boolean).join('\n'),
        basic: basic > 0 ? Math.round(basic * 100) / 100 : null,
    };
}

export interface LogEntry { kind: 'progress' | 'delivery'; progress_pct: number | null; recorded_on: string }

export interface ReachedContext {
    po: Pick<SchedulePo, 'status' | 'po_date'>;
    log: LogEntry[];
    /** Earliest date an invoice for this PO was received, if any. */
    firstInvoiceOn: string | null;
}

export interface Reached { date: string | null; auto: boolean }

/** When each trigger was reached, from the evidence on record. `auto:false` means nothing in the system can tell. */
export function reachedFor(m: { trigger: MilestoneTrigger; progress_pct: number | null }, c: ReachedContext): Reached {
    const earliest = (rows: LogEntry[]) => rows.map((r) => r.recorded_on).sort()[0] ?? null;
    switch (m.trigger) {
        case 'on_po':
            return { date: isPoEligible(c.po.status) ? (c.po.po_date ?? null) : null, auto: true };
        case 'on_delivery':
            return { date: earliest(c.log.filter((l) => l.kind === 'delivery')), auto: true };
        case 'on_progress':
            return { date: earliest(c.log.filter((l) => l.kind === 'progress' && (l.progress_pct ?? 0) >= (m.progress_pct ?? 101))), auto: true };
        case 'on_completion':
            return { date: earliest(c.log.filter((l) => l.kind === 'progress' && (l.progress_pct ?? 0) >= 100)), auto: true };
        case 'on_invoice':
            return { date: c.firstInvoiceOn, auto: true };
        default:
            // gst_on_portal / other: no signal in the system (GST portal status is not read).
            return { date: null, auto: false };
    }
}

export async function reachedContext(orgId: string, po: SchedulePo): Promise<ReachedContext & { logRows: (LogEntry & { id: string; note: string | null; recorded_by: string | null; created_at: string })[] }> {
    const [log, inv] = await Promise.all([
        supabaseAdmin.from('po_progress_log').select('id, kind, progress_pct, recorded_on, note, recorded_by, created_at').eq('organization_id', orgId).eq('po_id', po.id).order('recorded_on').order('created_at'),
        supabaseAdmin.from('invoices').select('submitted_at').eq('organization_id', orgId).eq('po_id', po.id).not('review_status', 'in', '(rejected,resubmission_required)').order('submitted_at').limit(1),
    ]);
    const rows = (log.data ?? []).map((r) => ({ ...r, progress_pct: r.progress_pct == null ? null : Number(r.progress_pct) })) as (LogEntry & { id: string; note: string | null; recorded_by: string | null; created_at: string })[];
    return { po, log: rows, logRows: rows, firstInvoiceOn: inv.data?.[0]?.submitted_at?.slice(0, 10) ?? null };
}

// --- checking a schedule a person has typed or edited -------------------------------

const TRIGGERS: MilestoneTrigger[] = ['on_po', 'on_delivery', 'on_progress', 'on_completion', 'on_invoice', 'gst_on_portal', 'other'];
const BASES: MilestoneBasis[] = ['basic', 'gst', 'total'];

export interface MilestoneInput {
    label: string; basis: MilestoneBasis; percent: number; amount: number; trigger: MilestoneTrigger; progress_pct: number | null; due_within_days: number | null;
}

export function validateMilestones(raw: unknown): { ok: true; rows: MilestoneInput[] } | { ok: false; error: string } {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) return { ok: false, error: 'A schedule needs between 1 and 30 milestones.' };
    const rows: MilestoneInput[] = [];
    for (const [i, r] of (raw as Record<string, unknown>[]).entries()) {
        const n = i + 1;
        const label = String(r?.label ?? '').trim().slice(0, 140);
        if (!label) return { ok: false, error: `Milestone ${n} needs a name.` };
        const basis = String(r.basis ?? 'basic') as MilestoneBasis;
        if (!BASES.includes(basis)) return { ok: false, error: `Milestone ${n}: unknown basis.` };
        const trigger = String(r.trigger ?? 'other') as MilestoneTrigger;
        if (!TRIGGERS.includes(trigger)) return { ok: false, error: `Milestone ${n}: unknown trigger.` };
        const percent = Number(r.percent);
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { ok: false, error: `Milestone ${n}: percentage must be above 0 and at most 100.` };
        const amount = Number(r.amount);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) return { ok: false, error: `Milestone ${n}: amount is not valid.` };
        let progress: number | null = null;
        if (trigger === 'on_progress') {
            progress = Math.round(Number(r.progress_pct));
            if (!Number.isFinite(progress) || progress < 1 || progress > 100) return { ok: false, error: `Milestone ${n}: say at what % complete it is payable.` };
        }
        const days = r.due_within_days == null || r.due_within_days === '' ? null : Math.round(Number(r.due_within_days));
        if (days != null && (!Number.isFinite(days) || days < 0 || days > 365)) return { ok: false, error: `Milestone ${n}: days must be between 0 and 365.` };
        rows.push({ label, basis, percent: Math.round(percent * 1000) / 1000, amount: Math.round(amount * 100) / 100, trigger, progress_pct: progress, due_within_days: days });
    }
    const paySum = rows.filter((m) => m.basis !== 'gst').reduce((s, m) => s + m.percent, 0);
    if (Math.abs(paySum - 100) > 0.01) return { ok: false, error: `The payment percentages add to ${Math.round(paySum * 1000) / 1000}%. They must add to 100%.` };
    return { ok: true, rows };
}
