import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, pcError, isUuid } from '@/backend/lib/pettyCash/api';
import { detectDuplicateExpense } from '@/backend/lib/pettyCash/fraudDetection';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    const { id } = await params;
    if (!isUuid(id) || !body) return NextResponse.json({ error: 'Invalid expense' }, { status: 400 });
    const req = await pcRequest(access, id);
    if (!req || req.requester_id !== access.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const paymentRef = typeof body.payment_ref === 'string' ? body.payment_ref.trim() : '';
    const paymentMode = typeof body.payment_mode === 'string' ? body.payment_mode : 'Cash';
    const amount = Number(body.amount);
    const vendor = typeof body.vendor === 'string' ? body.vendor.trim() : '';
    const expenseDate = typeof body.expense_date === 'string' ? body.expense_date : '';

    // Multi-layer fraud and duplicate prevention check
    const dupCheck = await detectDuplicateExpense({
        organizationId: access.organizationId,
        paymentRef,
        paymentMode,
        amount,
        vendor,
        expenseDate,
        requestId: id,
    });

    if (dupCheck.isDuplicate) {
        return NextResponse.json({
            error: dupCheck.reason || 'Duplicate transaction detected. Submitting the same expense or UTR again is blocked by Fraud Guard.'
        }, { status: 409 });
    }

    // Check if uploaded document was already attached to an existing expense
    if (Array.isArray(body.documents) && body.documents.length > 0) {
        const uploadIds = body.documents.map((d: any) => d.upload_id).filter(Boolean);
        if (uploadIds.length > 0) {
            const { data: existingDoc } = await supabaseAdmin
                .from('petty_cash_documents')
                .select('id, upload_id, request_id, file_name, request:petty_cash_requests(request_no)')
                .in('upload_id', uploadIds)
                .not('expense_id', 'is', null)
                .limit(1)
                .maybeSingle();

            if (existingDoc) {
                const reqNo = (existingDoc.request as any)?.request_no || 'another request';
                return NextResponse.json({
                    error: `Duplicate receipt file: '${existingDoc.file_name}' was already claimed for an expense in ${reqNo}. Reusing bills/receipts is blocked.`
                }, { status: 409 });
            }
        }
    }

    const { data, error } = await supabaseAdmin.rpc('pc_expense', { actor: access.user.id, rid: id, body });
    if (!error && data) {
        try {
            const { data: recentScans } = await supabaseAdmin
                .from('petty_cash_activity')
                .select('metadata')
                .eq('request_id', id)
                .eq('action', 'vision_ocr_scan')
                .order('created_at', { ascending: false })
                .limit(5);

            const fileHashes = (recentScans || [])
                .map(s => (s.metadata as any)?.file_hash)
                .filter(Boolean);

            if (fileHashes.length > 0) {
                const { data: lastAct } = await supabaseAdmin
                    .from('petty_cash_activity')
                    .select('id, metadata')
                    .eq('request_id', id)
                    .eq('action', 'expense_recorded')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (lastAct) {
                    await supabaseAdmin
                        .from('petty_cash_activity')
                        .update({
                            metadata: {
                                ...((lastAct.metadata as any) || {}),
                                file_hashes: fileHashes,
                            }
                        })
                        .eq('id', lastAct.id);
                }
            }
        } catch (e) {
            console.warn('Metadata linking warning:', e);
        }
    }
    return error ? pcError(error) : NextResponse.json({ expense: data }, { status: 201 });
}
