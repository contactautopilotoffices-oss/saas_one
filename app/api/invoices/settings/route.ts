/**
 * Invoice Control policy. Everyone with access can read it; only org super admins and
 * master admins can change it. Each save bumps policy_version, and every decision stores
 * the version it was made under.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { logInvoiceEvent } from '@/backend/lib/invoices/audit';
import { dbError } from '@/backend/lib/invoices/http';
import type { InvoiceSettings } from '@/backend/lib/invoices/types';

export const dynamic = 'force-dynamic';

// Roles the pickers may offer. Anything else is rejected, so a typo cannot silently
// leave nobody able to approve.
const ROLE_CHOICES = ['org_super_admin', 'master_admin', 'org_admin', 'accounts', 'purchase_manager'];

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    return NextResponse.json({ settings: a.settings, can_configure: a.canConfigure, role_choices: ROLE_CHOICES });
}

export async function PUT(request: NextRequest) {
    const body = await request.json().catch(() => null) as Partial<InvoiceSettings> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canConfigure) return forbidden('Only super admins can change this policy.');

    const s = a.settings;
    const int = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback; };
    const dec = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1000) / 1000 : fallback; };
    const roles = (v: unknown, fallback: string[]) => Array.isArray(v) ? [...new Set(v.map(String).filter((r) => ROLE_CHOICES.includes(r)))] : fallback;

    const next = {
        link_expiry_hours: int(body.link_expiry_hours, 1, 720, s.link_expiry_hours),
        max_file_mb: int(body.max_file_mb, 1, 25, s.max_file_mb),
        amount_tolerance: dec(body.amount_tolerance, 0, 1000, s.amount_tolerance),
        rate_tolerance_pct: dec(body.rate_tolerance_pct, 0, 25, s.rate_tolerance_pct),
        qty_tolerance_pct: dec(body.qty_tolerance_pct, 0, 25, s.qty_tolerance_pct),
        min_confidence: int(body.min_confidence, 0, 100, s.min_confidence),
        approver_roles: roles(body.approver_roles, s.approver_roles),
        approval_limit: dec(body.approval_limit, 0, 1e9, s.approval_limit),
        escalation_roles: roles(body.escalation_roles, s.escalation_roles),
        evidence_required: typeof body.evidence_required === 'boolean' ? body.evidence_required : s.evidence_required,
        doc_deadline_days: int(body.doc_deadline_days, 1, 90, s.doc_deadline_days),
    };
    // Somebody must always be able to decide, and someone above the limit.
    if (!next.approver_roles.length || !next.escalation_roles.length) return NextResponse.json({ error: 'Pick at least one approver role and one escalation role.' }, { status: 400 });

    const { error } = await supabaseAdmin.from('invoice_control_settings').upsert({
        organization_id: a.orgId, ...next, policy_version: s.policy_version + 1, updated_by: a.userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
    if (error) return dbError(error);

    await logInvoiceEvent({ organizationId: a.orgId, actorUserId: a.userId, actorRole: a.roles[0], eventType: 'policy_changed', poId: null, linkId: null, requestId: null, invoiceId: null, details: { before: s, after: next, policy_version: s.policy_version + 1 } });
    return NextResponse.json({ settings: { ...next, policy_version: s.policy_version + 1 } });
}
