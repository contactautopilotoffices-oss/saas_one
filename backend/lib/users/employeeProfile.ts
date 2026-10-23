import type { SupabaseClient } from '@supabase/supabase-js';

// Columns that actually exist on public.employee_profiles.
// `full_name` and `contact_number` were written here historically; neither column exists,
// so PostgREST rejected the whole statement and the caller's empty catch swallowed it.
// Names live in first_name / last_name and the number lives in phone.

export interface EnsureEmployeeProfileInput {
    organizationId: string | null;
    userId: string;
    email: string;
    fullName?: string | null;
    phone?: string | null;
    appRole: string;
}

export interface EnsureEmployeeProfileResult {
    status: 'linked_existing' | 'created' | 'skipped' | 'failed';
    employeeCode?: string;
    error?: string;
}

const HR_ROLES = ['hr', 'hr_head'];

// Roles that get an employee profile. Kept here so the approve and create routes cannot drift.
export const EMPLOYEE_PROFILE_ROLES = ['hr', 'hr_head', 'staff', 'property_admin', 'org_super_admin', 'ops_super_admin'];

export function splitFullName(fullName: string | null | undefined, email: string) {
    const source = (fullName || '').trim() || (email || '').split('@')[0] || 'Employee';
    const parts = source.split(/\s+/);
    return {
        firstName: parts[0] || 'Employee',
        lastName: parts.slice(1).join(' ') || ''
    };
}

// Next free employee code in the organization, as E<number> continuing the existing series.
// The HR master is seeded with E001..E2xx, so a random code in that range would collide with
// a real employee and, with an upsert on (organization_id, employee_code), overwrite their row.
async function nextEmployeeCode(admin: SupabaseClient, organizationId: string | null): Promise<string> {
    let query = admin.from('employee_profiles').select('employee_code');
    query = organizationId ? query.eq('organization_id', organizationId) : query.is('organization_id', null);

    const { data, error } = await query;
    if (error) throw error;

    let highest = 0;
    for (const row of data || []) {
        const match = /^E(\d+)$/i.exec((row.employee_code || '').trim());
        if (match) {
            const value = Number(match[1]);
            if (Number.isFinite(value) && value > highest) highest = value;
        }
    }

    return `E${String(highest + 1).padStart(3, '0')}`;
}

/**
 * Makes sure an approved or newly created user has an employee_profiles row, and returns what happened.
 *
 * An unlinked profile already exists for most staff because the HR master is seeded ahead of signup,
 * matched on email with user_id left NULL. That row is the one to link: it carries the real employee
 * code, department and designation, so it is linked in place rather than duplicated under a new code.
 * Curated HR master fields are never overwritten here; only blanks are filled.
 */
export async function ensureEmployeeProfile(
    admin: SupabaseClient,
    input: EnsureEmployeeProfileInput
): Promise<EnsureEmployeeProfileResult> {
    const { organizationId, userId, email, fullName, phone, appRole } = input;

    if (!EMPLOYEE_PROFILE_ROLES.includes(appRole)) {
        return { status: 'skipped' };
    }

    try {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const { firstName, lastName } = splitFullName(fullName, email);
        const isHrAuthority = HR_ROLES.includes(appRole);

        const COLUMNS = 'id, user_id, employee_code, first_name, last_name, email, phone, department, designation';

        // 1a. A row already linked to this user wins outright.
        let byUser = admin.from('employee_profiles').select(COLUMNS).eq('user_id', userId).limit(1);
        if (organizationId) byUser = byUser.eq('organization_id', organizationId);
        const { data: linkedRows, error: linkedError } = await byUser;
        if (linkedError) throw linkedError;

        type ProfileRow = NonNullable<typeof linkedRows>[number];
        let existing: ProfileRow | null = (linkedRows || [])[0] || null;

        // 1b. Otherwise the seeded-but-unlinked row carrying their email, which holds their real
        //     employee code. Scoped to the organization: without one, an email match could reach
        //     another organization's staff, so only the user_id match above is trusted.
        if (!existing && normalizedEmail && organizationId) {
            const { data: emailRows, error: emailError } = await admin
                .from('employee_profiles')
                .select(COLUMNS)
                .eq('organization_id', organizationId)
                .ilike('email', normalizedEmail)
                .limit(20);
            if (emailError) throw emailError;

            // ilike treats _ and % as wildcards and plenty of addresses contain _, so the
            // candidates are re-checked here for an exact case-insensitive match.
            existing = (emailRows || []).find(
                row => (row.email || '').trim().toLowerCase() === normalizedEmail
            ) || null;
        }

        if (existing) {
            // Link it and fill blanks only. The HR master owns name, department and designation.
            const updates: Record<string, unknown> = {
                user_id: userId,
                reconciliation_status: 'linked',
                is_active: true,
                updated_at: new Date().toISOString()
            };
            if (!existing.email && normalizedEmail) updates.email = email;
            if (!existing.phone && phone) updates.phone = phone;
            if (!existing.first_name) updates.first_name = firstName;
            if (!existing.last_name && lastName) updates.last_name = lastName;
            if (isHrAuthority) updates.is_hr_authority = true;

            const { error: updateError } = await admin
                .from('employee_profiles')
                .update(updates)
                .eq('id', existing.id);
            if (updateError) throw updateError;

            return { status: 'linked_existing', employeeCode: existing.employee_code };
        }

        // 2. Genuinely new person: insert under the next free code, retrying if another
        //    request took that code between the read and the insert.
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const employeeCode = await nextEmployeeCode(admin, organizationId);
            const { error: insertError } = await admin
                .from('employee_profiles')
                .insert({
                    organization_id: organizationId,
                    user_id: userId,
                    employee_code: employeeCode,
                    first_name: firstName,
                    last_name: lastName,
                    email: email || null,
                    phone: phone || null,
                    department: isHrAuthority ? 'Human Resources' : 'Operations',
                    designation: appRole === 'hr_head' ? 'HR Head' : (appRole === 'hr' ? 'HR Executive' : 'Executive'),
                    is_hr_authority: isHrAuthority,
                    reconciliation_status: 'linked',
                    is_active: true
                });

            if (!insertError) return { status: 'created', employeeCode };

            // 23505 is the unique violation on (organization_id, employee_code)
            if (insertError.code !== '23505') throw insertError;
            lastError = insertError;
        }

        throw lastError;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Never silent: this failing is why approved users ended up with no employee code.
        console.error('[ensureEmployeeProfile] Could not link or create employee profile', {
            userId,
            organizationId,
            appRole,
            error: message
        });
        return { status: 'failed', error: message };
    }
}
