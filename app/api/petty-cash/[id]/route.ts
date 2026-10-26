import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, pcError, isUuid } from '@/backend/lib/pettyCash/api';
import { requestWalletTotals } from '@/backend/lib/pettyCash/wallet';
import { applyPettyCashAction } from '@/backend/lib/pettyCash/actions';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const { id } = await params;
    try {
        const req = await pcRequest(access, id);
        if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const [docs, activity, expenses, ledger, reconciliation] = await Promise.all([
            supabaseAdmin.from('petty_cash_documents').select('*').eq('request_id', id),
            supabaseAdmin.from('petty_cash_activity').select('*,actor:users(full_name)').eq('request_id', id).order('created_at'),
            supabaseAdmin.from('petty_cash_expenses').select('*').eq('request_id', id).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }),
            supabaseAdmin.from('petty_cash_wallet_entries').select('*').eq('request_id', id),
            supabaseAdmin.from('petty_cash_settlement_status').select('*').eq('request_id', id).maybeSingle(),
        ]);
        const error = docs.error || activity.error || expenses.error || ledger.error || reconciliation.error;
        if (error) return pcError(error);
        const wallet = requestWalletTotals(ledger.data || []);
        return NextResponse.json({ request: req, documents: docs.data, activity: activity.data, expenses: expenses.data, balance: wallet.balance, wallet, reconciliation: reconciliation.data });
    } catch (error) { return pcError({ message: error instanceof Error ? error.message : 'Could not load request' }); }
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    const { id } = await params;
    if (!isUuid(id) || !body?.action) return NextResponse.json({ error: 'Valid request and action required' }, { status: 400 });
    // SQL checks visibility, exact assignment, finance scope, version and state atomically.
    const { data, error } = await applyPettyCashAction(access, id, body.action, body);
    return error ? pcError(error) : NextResponse.json({ request: data });
}
