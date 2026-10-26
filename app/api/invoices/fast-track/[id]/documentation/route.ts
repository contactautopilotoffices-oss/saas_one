/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/** POST {org_id, mode: close|waive, reason} — end the invoice chase. Close needs an accepted invoice; waive is a super-admin policy decision. */

import { NextRequest, NextResponse } from 'next/server';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { documentationAction } from '@/backend/lib/invoices/fasttrack';
import { isUuid, send } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!isUuid(id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    return send(await documentationAction(a, id, body));
}
