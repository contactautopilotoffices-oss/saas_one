import { NextResponse } from 'next/server';

// Approval is deliberately individual, including requisitions uploaded together.
export async function POST() {
    return NextResponse.json({
        error: 'Bulk approval is disabled. Open and review each requisition separately.'
    }, { status: 410 });
}
