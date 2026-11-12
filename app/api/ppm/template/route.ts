import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { buildPpmTemplateWorkbook } from '@/backend/lib/ppm/template';

/** GET /api/ppm/template — downloadable .xlsx upload template for PPM schedules. */
export async function GET() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const buffer = await buildPpmTemplateWorkbook();
    return new NextResponse(new Uint8Array(buffer), {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="ppm_upload_template.xlsx"',
        },
    });
}
