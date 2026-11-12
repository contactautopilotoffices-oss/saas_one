/** GET /api/po-approver/connect?org_id= — sends the approver to Zoho to link THEIR OWN account. */
import { NextRequest, NextResponse } from 'next/server';
import { requireApprover, isApproverError } from '@/backend/lib/accounts/poApproverAccess';
import { approverEnvReady, authorizeUrl, signState } from '@/backend/lib/accounts/poApprover';

export const dynamic = 'force-dynamic';
const redirectUriFor = (request: NextRequest) => `${(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')}/api/po-approver/callback`;

export async function GET(request: NextRequest) {
    const a = await requireApprover(request);
    if (isApproverError(a)) return a;
    if (!approverEnvReady()) return NextResponse.json({ error: 'Zoho client credentials are not set on the server.' }, { status: 503 });
    return NextResponse.redirect(authorizeUrl(signState({ org: a.organizationId, user: a.user.id }), redirectUriFor(request)));
}
