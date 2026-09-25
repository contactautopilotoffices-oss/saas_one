/**
 * Procurement UI feature flags.
 *
 * Kept as plain constants (not env vars) so the state is visible in review and
 * a rollback on production is a one-line change with no redeploy config.
 */

/**
 * Per-property price / budget / export controls on the Monthly Requisitions screen.
 *
 * These existed because every property had its own item list and its own rates.
 * The standardised item master (docs/MONTHLY_REQUISITION_STANDARD_CATALOG_PLAN.md)
 * replaces that, so the controls are hidden:
 *   - "Site Prices"          → per-property contracted rates
 *   - "Property Budgets"     → per-site/floor requisition budgets
 *   - "Export Master (.xlsx)" → consolidated all-property export
 * and the matching "Site Pricing & Aliases" / "Property Budgets" sidebar tabs.
 *
 * NOTE: hiding the Budgets admin UI does not switch budget enforcement off.
 * Budgets already stored against a property are still applied on the requisition
 * sheet (over-budget warning and approval routing) — they simply can no longer be
 * edited from the UI. Set this back to `true` to restore the controls.
 */
export const SHOW_LEGACY_PER_PROPERTY_CONTROLS = false;
