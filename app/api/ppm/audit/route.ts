import { NextRequest, NextResponse } from 'next/server';
import { generateAudit } from '@/app/api/ppm/audit/auditService';
import { guardOrg, guardProperty, propertyOrgId } from '@/backend/lib/auth/callerAccess';

/**
 * GET /api/ppm/audit?organization_id=...&property_id=...&audit_month=YYYY-MM
 * Returns summary and items.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const organizationId = searchParams.get('organization_id');
  const propertyId = searchParams.get('property_id');
  const auditMonth = searchParams.get('audit_month');

  if (!organizationId || !auditMonth) {
    return NextResponse.json({ error: 'organization_id and audit_month required' }, { status: 400 });
  }
  if (propertyId) {
    const denied = await guardProperty(request, propertyId);
    if (denied) return denied;
    if ((await propertyOrgId(propertyId)) !== organizationId) {
      return NextResponse.json({ error: 'Property does not belong to this organization' }, { status: 400 });
    }
  } else {
    const denied = await guardOrg(request, organizationId);
    if (denied) return denied;
  }

  try {
    const result = await generateAudit(organizationId, propertyId, auditMonth);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Audit generation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
