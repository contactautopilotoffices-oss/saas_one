import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, pcError, isUuid } from '@/backend/lib/pettyCash/api';
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ expenseId: string }> }) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    const { expenseId } = await params;
    if (!isUuid(expenseId) || !body) return NextResponse.json({ error: 'Invalid expense' }, { status: 400 });
    const { data: expense } = await supabaseAdmin.from('petty_cash_expenses').select('*').eq('id', expenseId).eq('organization_id', access.organizationId).maybeSingle();
    const req = expense && await pcRequest(access, expense.request_id);
    if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let isWalletHolder = false;
    if (!access.canDisburse && !access.isAdmin && expense.requester_id !== access.user.id && req.requester_id !== access.user.id) {
        const { data: userWallet } = await supabaseAdmin.rpc('pc_wallet', { actor: access.user.id, org: access.organizationId });
        isWalletHolder = !!userWallet && (Number(userWallet.balance || 0) > 0 || Number(userWallet.received || 0) > 0);
    }
    const isOwner = expense.requester_id === access.user.id || req.requester_id === access.user.id || isWalletHolder;
    const isAuditor = access.canDisburse || access.isAdmin;

    // 1. Edit Description & Category
    if (body.action === 'update') {
        if (!isOwner && !isAuditor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        if (req.status === 'closed') return NextResponse.json({ error: 'Closed expense cannot be changed' }, { status: 409 });
        if (expense.review_status === 'withdrawn') return NextResponse.json({ error: 'Withdrawn expense cannot be modified' }, { status: 409 });

        const newDescription = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : expense.description;
        const newCategory = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : expense.category;
        const newVendor = typeof body.vendor === 'string' && body.vendor.trim() ? body.vendor.trim() : expense.vendor;

        // Try RPC first
        const rpcRes = await supabaseAdmin.rpc('pc_update_expense', { actor: access.user.id, eid: expenseId, body: { description: newDescription, category: newCategory, vendor: newVendor } });
        if (!rpcRes.error) return NextResponse.json({ expense: rpcRes.data });

        // Direct update fallback
        const { data: updated, error: updateErr } = await supabaseAdmin
            .from('petty_cash_expenses')
            .update({ description: newDescription, category: newCategory, vendor: newVendor })
            .eq('id', expenseId)
            .select()
            .single();
        if (updateErr) return pcError(updateErr);

        await supabaseAdmin.from('petty_cash_activity').insert({
            request_id: expense.request_id,
            organization_id: access.organizationId,
            actor_id: access.user.id,
            action: 'expense_updated',
            remark: `Updated: ${newCategory} - ${newDescription}`,
            metadata: { expense_id: expenseId, category: newCategory, description: newDescription, vendor: newVendor }
        });
        await supabaseAdmin.from('petty_cash_requests').update({ updated_at: new Date().toISOString() }).eq('id', expense.request_id);
        return NextResponse.json({ expense: updated });
    }

    // 2. Withdraw / Revert expense
    if (body.action === 'withdraw') {
        if (!isOwner && !isAuditor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        if (req.status === 'closed') return NextResponse.json({ error: 'Closed expense cannot be changed' }, { status: 409 });
        if (expense.review_status === 'withdrawn') return NextResponse.json({ error: 'Expense is already withdrawn' }, { status: 409 });
        const remark = (body.remark || '').trim();
        if (!remark) return NextResponse.json({ error: 'A reason is required to withdraw an expense' }, { status: 400 });

        // Try RPC
        const rpcRes = await supabaseAdmin.rpc('pc_withdraw_expense', { actor: access.user.id, eid: expenseId, remark });
        if (!rpcRes.error) return NextResponse.json({ expense: rpcRes.data });

        // Fallback for pending or rejected expenses if RPC fails
        if (expense.review_status === 'pending' || expense.review_status === 'rejected') {
            const { data: updated, error: expErr } = await supabaseAdmin
                .from('petty_cash_expenses')
                .update({ review_status: 'withdrawn' })
                .eq('id', expenseId)
                .select()
                .single();
            if (expErr) return pcError(expErr);

            await supabaseAdmin.from('petty_cash_wallet_entries').insert({
                organization_id: access.organizationId,
                requester_id: expense.requester_id,
                request_id: expense.request_id,
                expense_id: expenseId,
                kind: 'reversal',
                amount: expense.amount,
                actor_id: access.user.id
            });

            const { data: remainingExpenses } = await supabaseAdmin
                .from('petty_cash_expenses')
                .select('amount')
                .eq('request_id', expense.request_id)
                .neq('review_status', 'withdrawn');
            const actualSpent = (remainingExpenses || []).reduce((acc: number, curr: { amount?: number | string | null }) => acc + Number(curr.amount || 0), 0);

            await supabaseAdmin.from('petty_cash_requests').update({
                actual_spent: actualSpent,
                updated_at: new Date().toISOString()
            }).eq('id', expense.request_id);

            await supabaseAdmin.from('petty_cash_activity').insert({
                request_id: expense.request_id,
                organization_id: access.organizationId,
                actor_id: access.user.id,
                action: 'expense_withdrawn',
                remark,
                metadata: { expense_id: expenseId, amount: expense.amount }
            });

            return NextResponse.json({ expense: updated });
        }

        return pcError(rpcRes.error);
    }

    // 3. Correct rejected proof
    if (body.action === 'correct') {
        const result = await supabaseAdmin.rpc('pc_correct_expense', { actor: access.user.id, eid: expenseId, body });
        if (result.error) return pcError(result.error);
        return NextResponse.json({ expense: result.data });
    }

    // 4. Review expense (Accept / Reject)
    const result = await supabaseAdmin.rpc('pc_review_expense', { actor: access.user.id, eid: expenseId, result: body.review_status, remark: body.remark || '' });
    if (!result.error) return NextResponse.json({ expense: result.data });

    // Fallback for Admin reviewing non-owned expense if RPC throws Forbidden
    if (/Forbidden/i.test(result.error.message) && isAuditor && !isOwner) {
        if (!['accepted', 'rejected'].includes(body.review_status) || (body.review_status === 'rejected' && !(body.remark || '').trim())) {
            return NextResponse.json({ error: 'Valid review and rejection reason required' }, { status: 400 });
        }
        const { data: reviewed, error: revErr } = await supabaseAdmin
            .from('petty_cash_expenses')
            .update({
                review_status: body.review_status,
                review_remarks: body.remark || null,
                reviewed_by: access.user.id,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', expenseId)
            .select()
            .single();
        if (revErr) return pcError(revErr);

        await supabaseAdmin.from('petty_cash_requests').update({ updated_at: new Date().toISOString() }).eq('id', expense.request_id);
        await supabaseAdmin.from('petty_cash_activity').insert({
            request_id: expense.request_id,
            organization_id: access.organizationId,
            actor_id: access.user.id,
            action: `expense_${body.review_status}`,
            remark: body.remark || '',
            metadata: { expense_id: expenseId }
        });
        return NextResponse.json({ expense: reviewed });
    }

    return pcError(result.error);
}
