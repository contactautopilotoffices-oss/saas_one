/**
 * Satej requirements.
 *   GET  ?organizationId=  → the organisation's requirements, newest first
 *   POST { organizationId, ...form } → raise a requirement; Satej starts on it straight after the response
 */

import { after, NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { missingKeys } from '@/backend/lib/satej/config';
import { advance, createRequirement, isSatejPaused, validateInput } from '@/backend/lib/satej/pipeline';
import { getRepo } from '@/backend/lib/satej/repo';
import type { RequirementInput } from '@/backend/lib/satej/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    try {
        const list = await getRepo().listRequirements(organizationId!, 100);
        return NextResponse.json({
            requirements: list.map((r) => ({
                id: r.id,
                code: r.code,
                title: r.input.title,
                spendType: r.input.spendType,
                city: r.brief?.locationCity || r.input.locationCity,
                status: r.status,
                round: r.round,
                topVendor: r.ranking?.find((x) => x.score.qualification === 'qualified')?.vendorName ?? null,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
            })),
        });
    } catch (e) {
        console.error('[satej] list failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load requirements' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as Partial<RequirementInput> & { organizationId?: string };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;
    const organizationId = body.organizationId!;

    const missing = missingKeys();
    if (missing.length) {
        return NextResponse.json({ error: `Satej is not configured on this server yet. Missing: ${missing.join(', ')}` }, { status: 503 });
    }
    if (await isSatejPaused(organizationId)) {
        return NextResponse.json({ error: 'Satej is paused in the Agent Console. Resume it there to raise new requirements.' }, { status: 409 });
    }
    const errors = validateInput(body);
    if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });

    const vendorTarget = Number(body.vendorTarget);
    try {
        const r = await createRequirement(
            organizationId,
            {
                title: String(body.title ?? '').trim(),
                spendType: body.spendType === 'capex' ? 'capex' : 'opex',
                itemDescription: String(body.itemDescription ?? '').trim(),
                quantity: String(body.quantity ?? '').trim(),
                unit: String(body.unit ?? '').trim(),
                scope: String(body.scope ?? '').trim(),
                locationCity: String(body.locationCity ?? '').trim(),
                locationArea: String(body.locationArea ?? '').trim(),
                siteName: body.siteName?.trim(),
                timeline: body.timeline?.trim(),
                budgetHint: body.budgetHint?.trim(),
                notes: body.notes?.trim(),
                vendorTarget: Number.isFinite(vendorTarget) ? Math.min(40, Math.max(3, Math.round(vendorTarget))) : undefined,
                requestedBy: String(body.requestedBy ?? '').trim() || caller.name,
                requestedByUserId: caller.userId,
                notifyWhatsapp: String(body.notifyWhatsapp ?? '').trim(),
            },
            request.nextUrl.origin,
        );
        // Run the first stages after the response is sent, so the form returns at once.
        after(() => advance(r.id, { trigger: 'manual' }).then(() => undefined));
        return NextResponse.json({ id: r.id, code: r.code, status: r.status }, { status: 201 });
    } catch (e) {
        console.error('[satej] create failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not create the requirement' }, { status: 500 });
    }
}
