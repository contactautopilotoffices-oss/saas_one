import { NextRequest } from 'next/server';
import { GET as handleGet, POST as handlePost } from '@/app/api/sop/ai-learning-loop/route';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const url = new URL(request.url);
    if (!url.searchParams.has('propertyId')) {
        url.searchParams.set('propertyId', propertyId);
    }
    const forwardedRequest = new NextRequest(url.toString(), {
        headers: request.headers,
        method: 'GET',
    });
    return handleGet(forwardedRequest);
}

export async function POST(
    request: NextRequest,
    { params: _params }: { params: Promise<{ propertyId: string }> }
) {
    return handlePost(request);
}

