import { NextResponse } from 'next/server';
import { runAutoSlaEscalation } from '@/backend/lib/hr/slaEscalation';

export async function GET() {
    try {
        const result = await runAutoSlaEscalation();
        return NextResponse.json({ success: true, ...result });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
