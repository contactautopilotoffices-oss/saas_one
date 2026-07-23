/**
 * BD Super Admin gating.
 *
 * The BD Super Admin ("CEO Dashboard") portal shares the SAME backend access
 * wiring as bd_admin — full org-wide CRM visibility — but renders a distinct
 * CEO/GTM command-center dashboard and sidebar. Access to that UI is gated to
 * an explicit allowlist of emails (mirrors the existing email-override pattern
 * in frontend/hooks/useAppSession.ts).
 *
 * NOTE: this is a UI-only gate. It never grants extra data access on its own —
 * backend authorization is still driven by the user's CRM role (bd_admin etc.)
 * in backend/lib/crm/access.ts. Because these three users remain bd_admin on
 * the backend, no migration is required for the dashboard to work today; the
 * 'bd_super_admin' role string is also a first-class role in the type system
 * for when a membership is explicitly set to it.
 */
export const BD_SUPER_ADMIN_EMAILS = [
    'saniel@worksquare.in',
    'rushab@worksquare.in',
    'nirupam.lahiri@worksquare.in',
] as const;

export function isBdSuperAdminEmail(email?: string | null): boolean {
    if (!email) return false;
    return (BD_SUPER_ADMIN_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}

/** True when the user should see the BD Super Admin portal (email allowlist or explicit role). */
export function isBdSuperAdmin(email?: string | null, role?: string | null): boolean {
    return isBdSuperAdminEmail(email) || role === 'bd_super_admin';
}
