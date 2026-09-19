import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import {
    isProcurementUser,
    resolveOrganizationId,
    isMissingSchemaError,
    MISSING_SCHEMA_MESSAGE,
} from '@/backend/lib/procurement/catalogAccess';
import {
    generateCatalogTemplateWorkbook,
    TEMPLATE_VERSION,
    type TemplateSeedItem,
} from '@/backend/lib/procurement/catalogTemplate';

/**
 * GET /api/procurement/catalog/template
 *
 * Downloads the standard requisition item template as .xlsx.
 *   ?include=current  pre-fills the sheet with the org's active catalog, so
 *                     procurement edits the live list instead of retyping it.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const organizationId = await resolveOrganizationId(user.id, searchParams.get('organizationId'));
        if (!organizationId) {
            return NextResponse.json({ error: 'Valid Organization ID is required' }, { status: 400 });
        }

        if (!(await isProcurementUser(user.id, organizationId))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        const adminSupabase = createAdminClient();
        const { data: org } = await adminSupabase
            .from('organizations')
            .select('name')
            .eq('id', organizationId)
            .maybeSingle();

        let items: TemplateSeedItem[] = [];
        if (searchParams.get('include') === 'current') {
            const { data: catalog, error } = await adminSupabase
                .from('procurement_catalog')
                .select('item_code, name, category, brand, color_size_details, unit, unit_price, estimated_price, photo_url, sort_order, description')
                .eq('organization_id', organizationId)
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true });

            if (error) {
                console.error('[Catalog Template] Failed to load current catalog:', error);
                if (isMissingSchemaError(error)) {
                    return NextResponse.json({ error: MISSING_SCHEMA_MESSAGE }, { status: 503 });
                }
                return NextResponse.json({ error: 'Database error' }, { status: 500 });
            }
            items = catalog || [];
        }

        const buffer = await generateCatalogTemplateWorkbook({
            organizationName: org?.name,
            items,
        });

        const suffix = items.length > 0 ? 'Current-Items' : 'Blank';
        const fileName = `Standard-Requisition-Items-${TEMPLATE_VERSION}-${suffix}.xlsx`;

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Content-Length': String(buffer.length),
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[Catalog Template] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
