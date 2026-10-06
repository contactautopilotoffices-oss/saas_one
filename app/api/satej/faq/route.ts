/**
 * The FAQ page in the Satej console: the answers Meera may give vendors.
 *   GET  ?organizationId=                                      → entries, the section as Meera will read it, canPublish
 *   POST { organizationId, action:'create', entry }            → new draft
 *   POST { organizationId, action:'update', id, entry }        → edit; approving or archiving needs publish rights
 *   POST { organizationId, action:'publish' }                  → write the approved answers into Meera's live script (admins)
 *
 * Drafts are open to the procurement team. Approving and publishing change what
 * every vendor hears, so they follow the Caller script rule (access.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { canPublishVoiceScript, requireSatejCaller } from '@/backend/lib/satej/access';
import { createFaq, faqSection, listFaq, publishFaq, updateFaq, type FaqInput } from '@/backend/lib/satej/faq';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    try {
        const [entries, canPublish] = await Promise.all([listFaq(organizationId!), canPublishVoiceScript(caller.userId, organizationId!)]);
        return NextResponse.json({ entries, section: faqSection(entries), canPublish });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the FAQ' }, { status: 503 });
    }
}

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string; action?: string; id?: string; entry?: FaqInput };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;
    const org = body.organizationId!;
    const entry = { ...(body.entry ?? {}) };
    const admin = await canPublishVoiceScript(caller.userId, org);
    const needsAdmin = body.action === 'publish' || (entry.status !== undefined && entry.status !== 'draft');
    if (needsAdmin && !admin) {
        return NextResponse.json({ error: 'Only org super admins and master admins can approve answers or publish them to Meera. Leave it as a draft for one of them.' }, { status: 403 });
    }
    // A wording change by someone who cannot approve sends the answer back to draft,
    // so an admin sees it before Meera says it.
    if (!admin && body.action === 'update' && (entry.question !== undefined || entry.answer !== undefined)) entry.status = 'draft';
    try {
        switch (body.action) {
            case 'create':
                return NextResponse.json({ entry: await createFaq(org, { ...entry, status: entry.status ?? 'draft' }, caller.name) });
            case 'update':
                if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
                return NextResponse.json({ entry: await updateFaq(org, body.id, entry, caller.name) });
            case 'publish':
                return NextResponse.json({ script: await publishFaq(org, { id: caller.userId, name: caller.name }) });
            default:
                return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'The FAQ action failed' }, { status: 400 });
    }
}
