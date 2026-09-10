import { cache } from 'react';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import VMSKiosk from '@/frontend/components/vms/VMSKiosk';
import { notFound } from 'next/navigation';

interface Props {
    params: Promise<{ propertyId: string }>;
}

/**
 * The kiosk is a public route (see proxy.ts) — the visitor standing at the
 * lobby tablet has no session, so the anon client's RLS on `properties`
 * returns nothing and every kiosk link 404s. Read through the service role
 * instead, exactly as the check-in and hosts routes under /api/vms already do.
 *
 * Only the property's public identity is selected; nothing here is more than
 * what is already printed on the building.
 */
const getKioskProperty = cache(async (propertyId: string) => {
    // A malformed id would make Postgres throw on the uuid comparison rather
    // than return an empty row, so screen it before it reaches the query.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
    if (!isUuid) return null;

    const supabase = createAdminClient();

    const { data: property, error } = await supabase
        .from('properties')
        .select('id, name, code')
        .eq('id', propertyId)
        .maybeSingle();

    if (error) {
        console.error('Kiosk property lookup failed:', error);
        return null;
    }

    return property;
});

export default async function KioskPage({ params }: Props) {
    const { propertyId } = await params;
    const property = await getKioskProperty(propertyId);

    if (!property) {
        notFound();
    }

    return (
        <VMSKiosk
            propertyId={propertyId}
            propertyName={property.name}
        />
    );
}

// Generate metadata
export async function generateMetadata({ params }: Props) {
    const { propertyId } = await params;
    const property = await getKioskProperty(propertyId);

    return {
        title: property ? `Visitor Check-In | ${property.name}` : 'Visitor Check-In | VMS',
        description: 'Visitor Management System Kiosk',
    };
}
