import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAssetAccess, isAssetAccessError, readOrgId } from '@/backend/lib/assets/access';
import { buildTemplateWorkbook } from '@/backend/lib/assets/import';

/** GET /api/assets/template — downloadable .xlsx import template, seeded with this org's categories. */
export async function GET(request: NextRequest) {
    const access = await resolveAssetAccess(request, readOrgId(request));
    if (isAssetAccessError(access)) return access;

    const { data: categories } = await supabaseAdmin
        .from('asset_categories')
        .select('name, code, organization_id')
        .or(`organization_id.eq.${access.organizationId},organization_id.is.null`)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

    const seen = new Set<string>();
    const list = (categories || []).filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));

    const buffer = await buildTemplateWorkbook(list);
    return new NextResponse(new Uint8Array(buffer), {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="asset_import_template.xlsx"',
        },
    });
}
