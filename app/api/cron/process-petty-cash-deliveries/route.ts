import { NextRequest,NextResponse } from 'next/server';
import { PettyCashNotificationService } from '@/backend/services/PettyCashNotificationService';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
    if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401});
    try{return NextResponse.json({outcomes:await PettyCashNotificationService.processDue()});}catch{return NextResponse.json({error:'Petty Cash notification processing failed'},{status:500});}
}
