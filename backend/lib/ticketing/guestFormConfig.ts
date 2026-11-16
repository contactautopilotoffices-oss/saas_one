import { supabaseAdmin } from '@lib/supabase/admin';
import {
    DEFAULT_GUEST_FORM_FIELDS,
    GuestFormField,
    normalizeGuestFormFields,
} from '@/frontend/lib/guestTicketForm';

/**
 * Server-side resolution of a property's client-support intake form.
 *
 * Returns the stored field list, or the default one when the property has never been configured.
 * If `property_ticket_form_configs` has not been created yet (the migration is applied by hand),
 * this falls back to the default form rather than breaking the public QR page.
 */
export async function resolveGuestFormFields(propertyId: string): Promise<GuestFormField[]> {
    try {
        const { data, error } = await supabaseAdmin
            .from('property_ticket_form_configs')
            .select('fields')
            .eq('property_id', propertyId)
            .maybeSingle();

        if (error) {
            // 42P01 = undefined_table: the migration has not been run yet.
            if (error.code !== '42P01') {
                console.error('resolveGuestFormFields error:', error);
            }
            return [...DEFAULT_GUEST_FORM_FIELDS];
        }

        return data ? normalizeGuestFormFields(data.fields) : [...DEFAULT_GUEST_FORM_FIELDS];
    } catch (err) {
        console.error('resolveGuestFormFields error:', err);
        return [...DEFAULT_GUEST_FORM_FIELDS];
    }
}
