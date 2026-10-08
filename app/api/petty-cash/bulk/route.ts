import { NextRequest, NextResponse } from 'next/server';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, isUuid } from '@/backend/lib/pettyCash/api';
import { applyPettyCashAction } from '@/backend/lib/pettyCash/actions';
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    if (!body || !['allocate', 'approve'].includes(body.action) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100 || new Set(body.items.map((i: { id: string }) => i.id)).size !== body.items.length) return NextResponse.json({ error: 'Select 1–100 distinct requests to allocate or approve' }, { status: 400 });
    const results = [];
    const batchId = crypto.randomUUID();
    for (const item of body.items) {
        if (!isUuid(item.id)) { results.push({ id: item.id, ok: false, error: 'Invalid request' }); continue; }
        try {
            const req = await pcRequest(access, item.id);
            if (!req) { results.push({ id: item.id, ok: false, error: 'Forbidden' }); continue; }
            const { data, error } = await applyPettyCashAction(access, item.id, body.action, { ...item, remark: `${body.remark || ''} [Batch ${batchId}]` });
            results.push({ id: item.id, ok: !error, error: error?.message, request: data });
        } catch (error) { results.push({ id: item.id, ok: false, error: error instanceof Error ? error.message : 'Could not process request' }); }
    }
    return NextResponse.json({ results, batch_id: batchId });
}
