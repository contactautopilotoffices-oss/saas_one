/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * Accounts records alignment of an APPROVED request: creates the payment tranche in the
 * existing Payment Tracker. Alignment is not payment, and it does not verify any invoice.
 * POST {org_id, acknowledge_over_commit?}
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { alignFastTrack } from '@/backend/lib/invoices/fasttrack';
import { isUuid, send } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!isUuid(id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    return send(await alignFastTrack(a, id, body));
}
