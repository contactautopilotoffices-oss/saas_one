import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { settingsSchema, defaultSettings } from '@/backend/lib/whatsapp/interpreter/config.mjs';
import { interpretTurn } from '@/backend/lib/whatsapp/interpreter/interpret.mjs';
import { getOrganizationUsers } from '@/backend/lib/whatsapp/interpreter/organization-users.mjs';

async function authorize(organizationId: string) {
    if (!z.string().uuid().safeParse(organizationId).success) return { error: NextResponse.json({ error: 'Valid organization ID required' }, { status: 400 }) };
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    const [membership, profile] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('role').eq('user_id',user.id).eq('organization_id',organizationId)
            .eq('is_active',true).eq('role','org_super_admin').maybeSingle(),
        supabaseAdmin.from('users').select('is_approved,approval_status').eq('id',user.id).maybeSingle(),
    ]);
    if (membership.error || profile.error) throw new Error('Authorization unavailable');
    if (!membership.data || !(profile.data?.is_approved || profile.data?.approval_status === 'approved')) return { error: NextResponse.json({error:'Organization Super Admin access required'},{status:403}) };
    return { user };
}

export async function GET(req: NextRequest) {
    try {
        const organizationId = req.nextUrl.searchParams.get('organizationId') || '';
        const auth = await authorize(organizationId);
        if (auth.error) return auth.error;
        if (req.nextUrl.searchParams.get('view') === 'users') {
            return NextResponse.json({ users: await getOrganizationUsers(supabaseAdmin, organizationId) }, { headers: { 'Cache-Control': 'private, no-store' } });
        }
        const { data, error } = await supabaseAdmin.from('whatsapp_interpreter_settings').select('config').eq('organization_id',organizationId).maybeSingle();
        if (error) throw error;
        const parsed = settingsSchema.safeParse(data?.config || defaultSettings);
        return NextResponse.json({ config:parsed.success ? parsed.data : defaultSettings, userId:auth.user?.id,
            readiness:{ llm:!!process.env.GROQ_TASK_CHAT_API_KEY, projectApi:!!process.env.AISENSY_PROJECT_ID && !!process.env.AISENSY_PROJECT_API_KEY,
                globalEnabled:process.env.WHATSAPP_LLM_INTERPRETER_ENABLED === 'true' && process.env.AISENSY_ASSISTANT_ENABLED === 'true' } });
    } catch { return NextResponse.json({error:req.nextUrl.searchParams.get('view')==='users'
        ? 'Organization users could not be loaded. Retry loading settings.'
        : 'Settings unavailable. Check the interpreter migration.'},{status:503}); }
}

export async function PUT(req: NextRequest) {
    try {
        const parsed = z.object({ organizationId:z.string().uuid(),config:settingsSchema }).strict().safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({error:'Invalid interpreter settings'},{status:400});
        const auth = await authorize(parsed.data.organizationId);
        if (auth.error) return auth.error;
        if (parsed.data.config.accessMode === 'selected' && parsed.data.config.pilotUserIds.length) {
            const users = await getOrganizationUsers(supabaseAdmin, parsed.data.organizationId);
            const allowed = new Set(users.filter(user => user.selectable).map(user => user.id));
            if (parsed.data.config.pilotUserIds.some(id => !allowed.has(id))) {
                return NextResponse.json({ error: 'Choose active, approved organization users with a valid WhatsApp phone number. Remove unavailable selections before saving.' }, { status: 400 });
            }
        }
        const { error } = await supabaseAdmin.from('whatsapp_interpreter_settings').upsert({ organization_id:parsed.data.organizationId,config:parsed.data.config,updated_at:new Date().toISOString() });
        if (error) throw error;
        return NextResponse.json({config:parsed.data.config});
    } catch { return NextResponse.json({error:'Settings could not be saved'},{status:503}); }
}

// A dry run extracts candidate phrases only. There is no action executor on this route.
export async function POST(req: NextRequest) {
    try {
        const parsed = z.object({organizationId:z.string().uuid(),workflow:z.enum(['booking','ticket']),text:z.string().min(1).max(8000)}).strict().safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({error:'Invalid preview request'},{status:400});
        const auth = await authorize(parsed.data.organizationId);
        if (auth.error) return auth.error;
        const result = await interpretTurn({workflow:parsed.data.workflow,text:parsed.data.text},{includeDiagnostics:true});
        return NextResponse.json({result,executed:false});
    } catch { return NextResponse.json({error:'Preview unavailable'},{status:503}); }
}
