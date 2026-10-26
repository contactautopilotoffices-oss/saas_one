import { NextRequest, NextResponse } from 'next/server';
import { GET as getRoutingCandidates } from '@/app/api/petty-cash/candidates/route';

/** Compatibility lookup for routing configuration; requesters cannot choose actors. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ propertyId: string }> }) {
    const { propertyId } = await params;
    const url = new URL(request.url);
    url.searchParams.set('property_id', propertyId);
    url.searchParams.set('search', url.searchParams.get('q') || url.searchParams.get('search') || '');
    const response = await getRoutingCandidates(new NextRequest(url, { headers: request.headers }));
    if (!response.ok) return response;
    const { users } = await response.json();
    return NextResponse.json({ approvers: users.map((user: { id: string; full_name: string; email: string; roles: string[] }) => ({
        id: user.id, name: user.full_name || user.email || 'User', email: user.email, role: user.roles.join(', '),
    })) });
}
