import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

// Payment totals, pending amount and workflow flags are all resolved by the
// po_alignment_queue view (20260801000004). Computing them here meant a capped
// candidate set and a silently-clamped payments lookup — see that migration's header.
const QUEUE_VIEW = 'po_alignment_queue';

// Postgres "undefined_table". Surfaced as an actionable 503 rather than falling back to
// the old capped path, because a silent fallback returns WRONG pending amounts.
const UNDEFINED_TABLE = '42P01';

function migrationRequired() {
    return NextResponse.json(
        { error: 'Payment Tracker requires a pending database migration (20260801000004_po_alignment_queue_view). Apply migrations and retry.' },
        { status: 503 },
    );
}

// GET /api/accounts/pos — tab=to_align (POs with pending amount) | all (paginated)
export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const tab = sp.get('tab') || 'all';
    const page = Math.max(1, parseInt(sp.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '25')));
    const search = (sp.get('search') || '').trim();
    const vendor = sp.get('vendor');
    const site = sp.get('site');
    const department = sp.get('department');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const criticalOnly = sp.get('critical_only') === 'true';

    const applyFilters = (q: any) => {
        q = q.eq('organization_id', access.organizationId);
        if (search) q = q.or(`po_number.ilike.%${search}%,vendor_name.ilike.%${search}%`);
        if (vendor) q = q.eq('vendor_name', vendor);
        if (site) q = q.eq('project_name', site);
        if (department) q = q.eq('department', department);
        if (dateFrom) q = q.gte('po_date', dateFrom);
        if (dateTo) q = q.lte('po_date', dateTo);
        return q;
    };

    let q = applyFilters(supabaseAdmin.from(QUEUE_VIEW).select('*', { count: 'exact' }));

    // The pending filter now runs across the WHOLE table, so nothing is excluded by a
    // candidate cap. 0.5 absorbs rounding on NUMERIC(14,2) totals.
    // is_payable drops cancelled/draft Zoho POs, which can never be aligned and would
    // otherwise head the queue at their full value (the view computes it NULL-safely).
    if (tab === 'to_align') q = q.gt('pending_amount', 0.5).eq('is_payable', true);
    if (criticalOnly) q = q.eq('is_critical', true);

    // Critical first ONLY on the queue, so a PO flagged "needs alignment ASAP" surfaces
    // on page 1. The full ledger deliberately skips it: is_critical comes from a joined
    // table, and leading with it forces a sort of every row, which stops idx_zpo_org_po_date
    // (organization_id, po_date DESC, created_at DESC) from serving the browse tab at all.
    if (tab === 'to_align') q = q.order('is_critical', { ascending: false });
    q = q.order('po_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

    const from = (page - 1) * pageSize;
    const { data, error, count } = await q.range(from, from + pageSize - 1);
    if (error) {
        if (error.code === UNDEFINED_TABLE) return migrationRequired();
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        pos: data || [],
        pagination: { page, page_size: pageSize, total: count || 0, total_pages: Math.ceil((count || 0) / pageSize) },
    });
}

// POST /api/accounts/pos — manual add a PO, or bulk-import { rows: [...] } (CSV).
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    if (!access.canAlign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rows: any[] = Array.isArray(body.rows) ? body.rows : [body];
    const toInsert = rows
        .filter((r) => r && (r.po_number || r.po_no || r['PO No'] || r['Purchase Order#']))
        .map((r) => ({
            organization_id: access.organizationId,
            po_number: String(r.po_number || r.po_no || r['PO No'] || r['Purchase Order#']).trim(),
            vendor_name: r.vendor_name || r['Vendor Name'] || r['Vendor name'] || null,
            po_amount: Number(r.po_amount ?? r['Amount'] ?? r['Total PO amount'] ?? r['PO Value'] ?? 0) || 0,
            status: r.status || r['Status'] || r['Po Status'] || null,
            department: r.department || r['Department'] || null,
            project_name: r.project_name || r['Project Name'] || r['Site'] || null,
            category: r.category || r['Category'] || null,
            po_date: r.po_date || null,
            source: Array.isArray(body.rows) ? 'csv' : 'manual',
            created_by: access.user.id,
        }));

    if (!toInsert.length) return NextResponse.json({ error: 'No valid rows (PO number required)' }, { status: 400 });

    // De-dupe by po_number (last row wins) — a single ON CONFLICT statement may
    // not touch the same (organization_id, po_number) target twice, and CSV
    // exports commonly repeat a PO across line-item rows.
    const deduped = Array.from(
        toInsert.reduce((m, r) => m.set(r.po_number, r), new Map<string, (typeof toInsert)[number]>()).values(),
    );

    // NOT an upsert. Migration 20260731000001 dropped the unique constraint on
    // (organization_id, po_number) — Zoho does not guarantee PO numbers are unique, and
    // keying on them was silently discarding real POs. Manual/CSV rows are now guarded by
    // a PARTIAL unique index (WHERE zoho_po_id IS NULL), which PostgREST cannot infer for
    // ON CONFLICT, so the insert-vs-update split is resolved explicitly here.
    const existing = new Map<string, string>();
    for (let i = 0; i < deduped.length; i += 200) {
        const numbers = deduped.slice(i, i + 200).map((r) => r.po_number);
        const { data: found } = await supabaseAdmin
            .from('zoho_purchase_orders').select('id, po_number')
            .eq('organization_id', access.organizationId)
            .is('zoho_po_id', null)                       // never touch Zoho-owned rows
            .in('po_number', numbers);
        for (const r of found || []) existing.set(r.po_number, r.id);
    }

    const results: { id: string; po_number: string }[] = [];

    const fresh = deduped.filter((r) => !existing.has(r.po_number));
    if (fresh.length) {
        const { data, error } = await supabaseAdmin
            .from('zoho_purchase_orders').insert(fresh).select('id, po_number');
        if (error) {
            console.error('PO import insert error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        results.push(...(data || []));
    }

    for (const row of deduped.filter((r) => existing.has(r.po_number))) {
        const { data, error } = await supabaseAdmin
            .from('zoho_purchase_orders').update(row)
            .eq('id', existing.get(row.po_number)!)
            .eq('organization_id', access.organizationId)   // assert the tenant, do not infer it
            .is('zoho_po_id', null)                          // never overwrite a Zoho-owned row
            .select('id, po_number').single();
        if (error) {
            console.error('PO import update error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        if (data) results.push(data);
    }

    return NextResponse.json({ imported: results.length, pos: results }, { status: 201 });
}
