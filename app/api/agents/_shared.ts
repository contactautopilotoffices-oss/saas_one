/**
 * Shared, PRIVATE helpers for /api/agents/*.
 *
 * Not a route: Next only routes `route.ts`, so this module is invisible to the
 * router. It exists because three sibling routes need exactly the same three
 * things and a route.ts may not export anything other than HTTP handlers.
 *
 *   1. GRACEFUL DEGRADE. Migration 20260830000001_agent_runtime.sql has not been
 *      applied yet. Every handler must answer 200 with { provisioned: false }
 *      rather than 500, so the console renders "not provisioned" instead of a
 *      broken panel.
 *   2. THE DOMAIN CATALOG. "Build from real config" needs to know which tables
 *      an FMS agent is even allowed to be pointed at. information_schema is not
 *      reachable through PostgREST, so discovery is a curated allowlist probed
 *      against the live database — which is the safer direction anyway: a table
 *      nobody curated can never be offered to an agent.
 *   3. THE HARD DENY. Credentials, secrets, tokens, keys, passwords, sessions
 *      and the auth/storage schemas are refused at every layer — catalog build,
 *      discovery output, and bundle write — not just filtered from the UI list.
 */

import { createClient } from '@/frontend/utils/supabase/server';
import {
    AGENT_MODULES as CANONICAL_MODULES,
    AGENT_MODULE_LABELS,
    type ModuleKey,
} from '@/frontend/types/agentRuntime';

/**
 * THE CANONICAL MODULE VOCABULARY LIVES IN frontend/types/agentRuntime.ts.
 *
 * This file used to declare a second, different one — 14 slugs against that
 * file's 15, with only 8 in common. Nothing reconciled them, and
 * oem_agent_runs.module is free text with no CHECK, so a module surface could
 * mount a slug (`diesel`) that existed in neither list and its pulse strip
 * would stay empty forever with no error anywhere. Everything below is now
 * DERIVED from the canonical list; the metadata maps are Record<ModuleKey, …>,
 * so adding a slug there and forgetting it here is a compile error.
 *
 * Re-exported here so /api/agents/* routes keep importing from one place.
 */
export {
    AGENT_MODULES as AGENT_MODULE_KEYS,
    AGENT_MODULE_LABELS,
    isAgentModule,
    normalizeModule,
    type ModuleKey,
} from '@/frontend/types/agentRuntime';

export type Db = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------------- */
/* 1. Degrade                                                                 */
/* ------------------------------------------------------------------------- */

/** Postgres / PostgREST codes that mean "the schema isn't there yet". */
const NOT_PROVISIONED_CODES = new Set([
    '42P01', // undefined_table
    // 42703 (undefined_column) deliberately NOT here — see isMissingSchema.
    '42883', // undefined_function
    'PGRST202', // function not found in schema cache
    'PGRST204', // column not found in schema cache
    'PGRST205', // table not found in schema cache
]);

export interface PgLikeError {
    code?: string | null;
    message?: string | null;
    details?: string | null;
}

/** True when the error is "this object does not exist yet", not a real failure. */
export function isMissingSchema(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as PgLikeError;
    if (e.code && NOT_PROVISIONED_CODES.has(e.code)) return true;
    const msg = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();

    // A MISSING COLUMN IS NOT A MISSING TABLE. Postgres says
    // "column oem_agent_bundles.notes does not exist" for a schema drift bug,
    // and this used to match the bare 'does not exist' test — so operators were
    // told to run a migration that was already applied, and running it again
    // changed nothing. A column fault is a real error and must surface as one.
    if (/\bcolumn\b.*does not exist/.test(msg)) return false;
    if (e.code === '42703') return false;

    return (
        msg.includes('does not exist') ||
        msg.includes('could not find the table') ||
        msg.includes('schema cache')
    );
}

/** The migration the UI should tell the operator to run. */
export const RUNTIME_MIGRATION = '20260830000001_agent_runtime';
export const BASE_MIGRATION = '20260825000001_org_efficiency_meter';

/* ------------------------------------------------------------------------- */
/* 2. Hard deny                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Any table whose NAME matches this may never be bundled, discovered, listed or
 * composed against — regardless of who asks. oem_agent_credentials is the
 * obvious one; the pattern also catches password_reset_tokens, user_sessions,
 * api_keys and anything a future migration names in the same family.
 */
export const DENY_NAME_PATTERN = /credential|secret|token|passwo?rd|api_key|_key$|^keys?$|session|otp|oauth/i;

/** Schemas an agent bundle may never name, even if PostgREST could reach them. */
export const DENY_SCHEMA_PREFIX = /^(auth|storage|vault|pgsodium|supabase_|net|extensions|graphql|realtime|information_schema|pg_)/i;

/** Identity / access-control tables. Not secrets, but not agent surface either. */
const DENY_EXACT = new Set([
    'users',
    'organization_memberships',
    'property_memberships',
    'super_tenant_properties',
    'user_management_audit_logs',
    'email_action_tokens',
    'oem_agent_credentials',
]);

export function isDeniedTable(name: string): boolean {
    const n = (name ?? '').trim().toLowerCase();
    if (!n) return true;
    if (n.includes('.')) {
        const schema = n.split('.')[0];
        if (DENY_SCHEMA_PREFIX.test(schema)) return true;
    }
    if (DENY_SCHEMA_PREFIX.test(n)) return true;
    if (DENY_EXACT.has(n)) return true;
    if (DENY_NAME_PATTERN.test(n)) return true;
    // Only plain identifiers. No quoting, no schema hopping, no injection.
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(n)) return true;
    return false;
}

/* ------------------------------------------------------------------------- */
/* 3. The domain catalog                                                      */
/* ------------------------------------------------------------------------- */

export interface CatalogEntry {
    name: string;
    domain: ModuleKey;
    /** What a bundle should default to when this table is added by a human. */
    suggested_access: 'read' | 'write';
    purpose: string;
}

export interface ModuleDescriptor {
    key: ModuleKey;
    label: string;
    description: string;
}

/**
 * One line of prose per canonical module. Exhaustive by type — a new slug in
 * the canonical AGENT_MODULES list that is not described here will not compile.
 */
const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
    tickets: 'Complaints, categories, SLA breach and the escalation ladder.',
    sop: 'Shift checklists, completions and the proof behind them.',
    ppm: 'Planned maintenance schedules, PPM audits and maintenance vendors.',
    assets: 'Asset registry, condition and AMC contracts.',
    housekeeping: 'Cleaning deployment, consumables and housekeeping quality.',
    roster: 'Shifts, deployment, attendance and reliability events.',
    frontdesk: 'Visitors, meeting rooms, guest requests and feedback.',
    electricity: 'Bills, readings, disputes, chase tasks and payment runs.',
    diesel: 'DG runtime, diesel consumption and fuel cost basis.',
    utilities: 'Water sources, sub-meters, multipliers and tariffs.',
    procurement: 'Requisitions, quotations, POs, budgets and stock.',
    vendors: 'Vendor master, documents, assignments and revenue.',
    accounts: 'Ledgers, invoices and the finance view of the portfolio.',
    payments: 'Payment runs, payouts and their approval state.',
    audit: 'Audit submissions, master items and pending actions.',
    documents: 'Statutory document vault, expiry and OCR text.',
    reports: 'Imported statements and the periodic reporting pack.',
    crm: 'Leads, campaigns and activity.',
    comms: 'Calls, WhatsApp, mailbox threads and notifications.',
    core: 'Properties and organization settings.',
    council: 'The agent council: deliberation, dissent and decisions.',
    agentops: 'The agent workforce itself: goals, tasks, runs and feedback.',
};

/**
 * The module surface the registry route publishes: one RICH OBJECT per module
 * ({ key, label, description }), for a UI that renders a module picker.
 *
 * DELIBERATELY NOT NAMED `AGENT_MODULES`. That name already belongs to the
 * canonical SLUG ARRAY in frontend/types/agentRuntime.ts, and while this module
 * also exported an `AGENT_MODULES` two different shapes shared one identifier:
 * `import { AGENT_MODULES }` gave you `['tickets', ...]` or
 * `[{ key: 'tickets', ... }]` depending only on which path you imported from.
 * That is how `allowed: AGENT_MODULES` in an error body ends up shipping
 * descriptor objects to a client that expected slugs. One name, one shape:
 *   - AGENT_MODULE_KEYS        — the slugs (re-export of the canonical list)
 *   - AGENT_MODULE_DESCRIPTORS — the slugs plus label and prose (this)
 * Error bodies and any `allowed:` list must use AGENT_MODULE_KEYS — a client
 * told `allowed: [{...}]` cannot read it.
 *
 * Order and membership come from the canonical list; only the prose lives here.
 */
export const AGENT_MODULE_DESCRIPTORS: ModuleDescriptor[] = CANONICAL_MODULES.map((key) => ({
    key,
    label: AGENT_MODULE_LABELS[key],
    description: MODULE_DESCRIPTIONS[key],
}));

/**
 * The curated FMS surface. Deliberately an allowlist, not a scan: an agent can
 * only ever be pointed at a table someone put on this list on purpose.
 * `suggested_access: 'write'` is reserved for artefacts an agent legitimately
 * AUTHORS (its own tasks, a chase, a note, an outbound message). Everything a
 * human owns is 'read' — a human can still promote it, but not by default.
 */
const RAW_CATALOG: CatalogEntry[] = [
    // --- tickets
    { name: 'tickets', domain: 'tickets', suggested_access: 'read', purpose: 'Every complaint and work order with status, SLA and assignee.' },
    { name: 'ticket_activity_log', domain: 'tickets', suggested_access: 'read', purpose: 'State transitions on a ticket — the audit trail.' },
    { name: 'ticket_comments', domain: 'tickets', suggested_access: 'write', purpose: 'Thread on a ticket. An agent may post its findings here.' },
    { name: 'ticket_escalation_logs', domain: 'tickets', suggested_access: 'read', purpose: 'When and to whom a ticket was escalated.' },
    { name: 'issue_categories', domain: 'tickets', suggested_access: 'read', purpose: 'Category tree used to classify a complaint.' },
    { name: 'issue_logs', domain: 'tickets', suggested_access: 'read', purpose: 'Raw issue capture before triage.' },
    { name: 'escalation_hierarchies', domain: 'tickets', suggested_access: 'read', purpose: 'Who a breach escalates to, per property and category.' },
    { name: 'escalation_levels', domain: 'tickets', suggested_access: 'read', purpose: 'Ladder rungs and their time thresholds.' },
    { name: 'resolver_stats', domain: 'tickets', suggested_access: 'read', purpose: 'Per-resolver throughput and closure quality.' },

    // --- sop
    { name: 'sop_templates', domain: 'sop', suggested_access: 'read', purpose: 'The checklist definitions a shift must complete.' },
    { name: 'sop_completions', domain: 'sop', suggested_access: 'read', purpose: 'One row per completed checklist run, with timing and proof.' },
    { name: 'sop_completion_items', domain: 'sop', suggested_access: 'read', purpose: 'Line-level answers inside a completion.' },
    { name: 'sop_checklist_items', domain: 'sop', suggested_access: 'read', purpose: 'The items a template asks for.' },

    // --- ppm / assets
    { name: 'ppm_schedules', domain: 'ppm', suggested_access: 'read', purpose: 'Planned preventive maintenance calendar.' },
    { name: 'ppm_audit_reports', domain: 'ppm', suggested_access: 'read', purpose: 'Outcome of a PPM visit.' },
    { name: 'amc_contracts', domain: 'ppm', suggested_access: 'read', purpose: 'Annual maintenance contracts and their expiry.' },
    { name: 'maintenance_vendors', domain: 'ppm', suggested_access: 'read', purpose: 'Vendors bound to maintenance scopes.' },

    // --- electricity
    { name: 'electricity_bills', domain: 'electricity', suggested_access: 'read', purpose: 'Bill master: units, amount, due date, status.' },
    { name: 'electricity_readings', domain: 'electricity', suggested_access: 'read', purpose: 'Meter reads underpinning consumption.' },
    { name: 'electricity_meters', domain: 'electricity', suggested_access: 'read', purpose: 'Meter registry and multipliers.' },
    { name: 'electricity_billing_accounts', domain: 'electricity', suggested_access: 'read', purpose: 'Consumer numbers, discom and billing cycle.' },
    { name: 'electricity_bill_documents', domain: 'electricity', suggested_access: 'read', purpose: 'The PDF/OCR evidence behind a bill.' },
    { name: 'electricity_bill_validations', domain: 'electricity', suggested_access: 'read', purpose: 'Automated checks run on an incoming bill.' },
    { name: 'electricity_disputes', domain: 'electricity', suggested_access: 'read', purpose: 'Raised disputes and their state.' },
    { name: 'electricity_chase_tasks', domain: 'electricity', suggested_access: 'write', purpose: 'Follow-ups an agent creates and closes.' },
    { name: 'electricity_payment_runs', domain: 'electricity', suggested_access: 'read', purpose: 'Batched payments and their approval state.' },
    { name: 'electricity_savings_targets', domain: 'electricity', suggested_access: 'read', purpose: 'Per-site savings commitments.' },

    // --- diesel / DG
    { name: 'diesel_readings', domain: 'diesel', suggested_access: 'read', purpose: 'DG fuel and runtime readings.' },
    { name: 'generators', domain: 'diesel', suggested_access: 'read', purpose: 'DG asset registry and capacity.' },
    { name: 'dg_tariffs', domain: 'diesel', suggested_access: 'read', purpose: 'Diesel cost basis for per-unit maths.' },
    // --- water & meters
    { name: 'water_readings', domain: 'utilities', suggested_access: 'read', purpose: 'Water consumption reads.' },
    { name: 'water_sources', domain: 'utilities', suggested_access: 'read', purpose: 'Tanker, borewell and municipal sources.' },
    { name: 'water_tariffs', domain: 'utilities', suggested_access: 'read', purpose: 'Water rate cards.' },
    { name: 'facility_meters', domain: 'utilities', suggested_access: 'read', purpose: 'Generic sub-meter registry.' },
    { name: 'facility_meter_readings', domain: 'utilities', suggested_access: 'read', purpose: 'Sub-meter reads over time.' },
    { name: 'facility_meter_groups', domain: 'utilities', suggested_access: 'read', purpose: 'Meter groupings for roll-ups.' },
    { name: 'facility_meter_categories', domain: 'utilities', suggested_access: 'read', purpose: 'Meter classification.' },
    { name: 'meter_multipliers', domain: 'utilities', suggested_access: 'read', purpose: 'CT/PT multipliers applied to raw reads.' },

    // --- procurement
    { name: 'material_requests', domain: 'procurement', suggested_access: 'read', purpose: 'Site indents awaiting procurement.' },
    { name: 'material_request_items', domain: 'procurement', suggested_access: 'read', purpose: 'Line items on an indent.' },
    { name: 'material_request_comparatives', domain: 'procurement', suggested_access: 'read', purpose: 'Quote comparison behind a decision.' },
    { name: 'procurement_requisitions', domain: 'procurement', suggested_access: 'read', purpose: 'Formal requisitions.' },
    { name: 'procurement_quotations', domain: 'procurement', suggested_access: 'read', purpose: 'Vendor quotes against a requisition.' },
    { name: 'procurement_catalog', domain: 'procurement', suggested_access: 'read', purpose: 'Item master with expected rates.' },
    { name: 'procurement_budgets', domain: 'procurement', suggested_access: 'read', purpose: 'Budget envelopes by site and month.' },
    { name: 'property_monthly_requisitions', domain: 'procurement', suggested_access: 'read', purpose: 'Monthly consumable requisition per site.' },
    { name: 'property_monthly_requisition_budgets', domain: 'procurement', suggested_access: 'read', purpose: 'The cap a monthly requisition is judged against.' },
    { name: 'zoho_purchase_orders', domain: 'procurement', suggested_access: 'read', purpose: 'Purchase orders mirrored from Zoho Books.' },
    { name: 'po_payments', domain: 'procurement', suggested_access: 'read', purpose: 'Payments recorded against a PO.' },
    { name: 'po_workflow_state', domain: 'procurement', suggested_access: 'read', purpose: 'Where a PO sits in the approval chain.' },
    { name: 'po_activity_log', domain: 'procurement', suggested_access: 'read', purpose: 'PO audit trail.' },
    { name: 'stock_items', domain: 'procurement', suggested_access: 'read', purpose: 'On-hand stock per site.' },
    { name: 'stock_movements', domain: 'procurement', suggested_access: 'read', purpose: 'Issue and receipt movements.' },
    { name: 'stock_reports', domain: 'procurement', suggested_access: 'read', purpose: 'Periodic stock statements.' },
    { name: 'petty_cash_requests', domain: 'procurement', suggested_access: 'read', purpose: 'Site petty cash and its approval state.' },

    // --- vendors
    { name: 'vendors', domain: 'vendors', suggested_access: 'read', purpose: 'Vendor master.' },
    { name: 'vendor_profiles', domain: 'vendors', suggested_access: 'read', purpose: 'Vendor KYC, GST, bank and Zoho linkage.' },
    { name: 'vendor_documents', domain: 'vendors', suggested_access: 'read', purpose: 'Compliance documents and expiry.' },
    { name: 'vendor_property_assignments', domain: 'vendors', suggested_access: 'read', purpose: 'Which vendor serves which site.' },
    { name: 'vendor_daily_revenue', domain: 'vendors', suggested_access: 'read', purpose: 'Daily revenue booked against a vendor.' },

    // --- roster / people
    { name: 'staff_rosters', domain: 'roster', suggested_access: 'read', purpose: 'Planned deployment by shift.' },
    { name: 'offline_roster_staff', domain: 'roster', suggested_access: 'read', purpose: 'Staff who are not app users but are deployed.' },
    { name: 'shift_logs', domain: 'roster', suggested_access: 'read', purpose: 'Actual shift start/end and handover.' },
    { name: 'shift_configurations', domain: 'roster', suggested_access: 'read', purpose: 'Shift windows per site.' },
    { name: 'employee_reliability_events', domain: 'roster', suggested_access: 'read', purpose: 'The events that move a person’s reliability score.' },
    { name: 'skill_groups', domain: 'roster', suggested_access: 'read', purpose: 'Skill grouping used for assignment.' },
    { name: 'mst_skills', domain: 'roster', suggested_access: 'read', purpose: 'Skill master.' },

    // --- front of house
    { name: 'visitor_logs', domain: 'frontdesk', suggested_access: 'read', purpose: 'Visitor in/out records.' },
    { name: 'meeting_rooms', domain: 'frontdesk', suggested_access: 'read', purpose: 'Bookable rooms and capacity.' },
    { name: 'meeting_room_bookings', domain: 'frontdesk', suggested_access: 'read', purpose: 'Bookings, no-shows and utilisation.' },
    { name: 'meeting_room_credits', domain: 'frontdesk', suggested_access: 'read', purpose: 'Credit balances per tenant.' },
    { name: 'guest_requests', domain: 'frontdesk', suggested_access: 'read', purpose: 'Requests raised by occupants via QR.' },
    { name: 'feedback_tickets', domain: 'frontdesk', suggested_access: 'read', purpose: 'Occupant feedback and sentiment.' },
    { name: 'qr_facility_zones', domain: 'frontdesk', suggested_access: 'read', purpose: 'QR-mapped zones behind guest requests.' },

    // --- comms
    { name: 'omnichannel_call_logs', domain: 'comms', suggested_access: 'read', purpose: 'Unified call record across WhatsApp, Plivo and Bolna.' },
    { name: 'whatsapp_queue', domain: 'comms', suggested_access: 'write', purpose: 'Outbound WhatsApp queue. An agent may enqueue a message.' },
    { name: 'mailbox_threads', domain: 'comms', suggested_access: 'read', purpose: 'Ingested mailbox conversations.' },
    { name: 'notifications', domain: 'comms', suggested_access: 'write', purpose: 'In-app notifications an agent raises for a human.' },
    { name: 'event_outbox', domain: 'comms', suggested_access: 'read', purpose: 'Transactional outbox driving downstream delivery.' },
    { name: 'crm_calls', domain: 'comms', suggested_access: 'read', purpose: 'Sales call records.' },

    // --- audit
    { name: 'property_audit_submissions', domain: 'audit', suggested_access: 'read', purpose: 'Digital audit submissions per site.' },
    { name: 'audit_master_items', domain: 'audit', suggested_access: 'read', purpose: 'The audit question bank.' },
    { name: 'document_bank', domain: 'documents', suggested_access: 'read', purpose: 'Statutory document vault with expiry and OCR text.' },
    { name: 'pending_actions', domain: 'audit', suggested_access: 'write', purpose: 'Cross-module action queue. An agent may raise and close items.' },

    // --- crm
    { name: 'crm_leads', domain: 'crm', suggested_access: 'read', purpose: 'Leads and their stage.' },
    { name: 'crm_campaigns', domain: 'crm', suggested_access: 'read', purpose: 'Campaign definitions and spend.' },
    { name: 'crm_activity_log', domain: 'crm', suggested_access: 'read', purpose: 'Touchpoints against a lead.' },

    // --- core
    { name: 'properties', domain: 'core', suggested_access: 'read', purpose: 'The portfolio an agent reasons over.' },
    { name: 'organization_settings', domain: 'core', suggested_access: 'read', purpose: 'Org-level switches an agent must respect.' },

    // --- agent operations (self-awareness)
    { name: 'oem_goals', domain: 'agentops', suggested_access: 'read', purpose: 'The goal tree this agent is bound to.' },
    { name: 'oem_tasks', domain: 'agentops', suggested_access: 'write', purpose: 'The agent’s own task list. It creates and completes these.' },
    { name: 'oem_measurements', domain: 'agentops', suggested_access: 'write', purpose: 'Periodic metric readings the agent posts against a goal.' },
    { name: 'oem_agent_runs', domain: 'agentops', suggested_access: 'read', purpose: 'Its own execution history.' },
    { name: 'oem_agent_feedback', domain: 'agentops', suggested_access: 'read', purpose: 'Praise, rejections and ROI flags aimed at it.' },
];

/** Deny is applied at catalog construction, so a denied table cannot even leak. */
export const AGENT_TABLE_CATALOG: CatalogEntry[] = RAW_CATALOG.filter((t) => !isDeniedTable(t.name));

const CATALOG_BY_NAME = new Map(AGENT_TABLE_CATALOG.map((t) => [t.name, t]));

export function catalogEntry(name: string): CatalogEntry | undefined {
    return CATALOG_BY_NAME.get((name ?? '').trim().toLowerCase());
}

/* ------------------------------------------------------------------------- */
/* 4. Discovery — "build from real config"                                    */
/* ------------------------------------------------------------------------- */

export interface DiscoveredTable {
    name: string;
    domain: ModuleKey;
    /**
     * Row count for THIS organization, or null for "unknown".
     *
     * It is never a cross-tenant number. A table with no organization_id column
     * cannot be counted for one org, so it reports null rather than the global
     * total: an org admin must not be able to read another tenant's data volume
     * off a discovery panel, not even as an estimate. Consumers must render null
     * as "no count", never as 0.
     */
    rows_estimate: number | null;
    /** True when rows_estimate was filtered to this organization. */
    org_scoped: boolean;
    /** Alias of org_scoped. When false, rows_estimate is null by construction. */
    scoped: boolean;
    /** False when the table is not in the database yet. */
    present: boolean;
    /**
     * Org-scoped tables: this organization has rows. Unscoped tables: the table
     * is non-empty — presence only, no volume, and not attributable to this org.
     */
    has_data: boolean;
    suggested_access: 'read' | 'write';
    purpose: string;
}

async function probe(db: Db, entry: CatalogEntry, orgId: string, withCounts: boolean): Promise<DiscoveredTable> {
    const base: DiscoveredTable = {
        name: entry.name,
        domain: entry.domain,
        rows_estimate: null,
        org_scoped: false,
        scoped: false,
        present: true,
        has_data: false,
        suggested_access: entry.suggested_access,
        purpose: entry.purpose,
    };

    if (!withCounts) return base;

    try {
        // head:true means no rows cross the wire — this is a COUNT, not a SELECT.
        // 'estimated' asks PostgREST for the planner estimate on large relations
        // and an exact count on small ones, which is the cheap-where-cheap rule.
        const scoped = await db
            .from(entry.name)
            .select('*', { head: true, count: 'estimated' })
            .eq('organization_id', orgId);

        if (!scoped.error) {
            const n = scoped.count ?? 0;
            return { ...base, rows_estimate: n, org_scoped: true, scoped: true, has_data: n > 0 };
        }

        // 42703 => the table exists but has no organization_id (it is scoped by
        // property_id, or it is a global master). Count it unscoped and say so.
        if (scoped.error.code === '42P01' || scoped.error.code === 'PGRST205') {
            return { ...base, present: false };
        }

        const unscoped = await db.from(entry.name).select('*', { head: true, count: 'estimated' });
        if (unscoped.error) {
            return { ...base, present: !isMissingSchema(unscoped.error) };
        }
        const n = unscoped.count ?? 0;
        return { ...base, rows_estimate: n, org_scoped: false, scoped: false, has_data: n > 0 };
    } catch {
        // A probe must never take the endpoint down.
        return base;
    }
}

/**
 * Probe the curated catalog against the live database.
 *
 * Concurrency is capped: this fires one HEAD count per catalogued table and an
 * unbounded Promise.all over ~90 of them would open ~90 sockets at once.
 */
export async function discoverOrgTables(
    db: Db,
    orgId: string,
    opts: { counts?: boolean; onlyWithData?: boolean } = {}
): Promise<DiscoveredTable[]> {
    const withCounts = opts.counts !== false;
    const out: DiscoveredTable[] = [];
    const CHUNK = 12;

    for (let i = 0; i < AGENT_TABLE_CATALOG.length; i += CHUNK) {
        const slice = AGENT_TABLE_CATALOG.slice(i, i + CHUNK);
        const settled = await Promise.all(slice.map((e) => probe(db, e, orgId, withCounts)));
        out.push(...settled);
    }

    const present = out.filter((t) => t.present);
    const filtered = opts.onlyWithData ? present.filter((t) => t.has_data) : present;

    // Tables the org actually uses float to the top; then by domain, then name.
    return filtered.sort((a, b) => {
        if (a.has_data !== b.has_data) return a.has_data ? -1 : 1;
        if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
        return (b.rows_estimate ?? 0) - (a.rows_estimate ?? 0);
    });
}

/* ------------------------------------------------------------------------- */
/* 5. Small shared shapes                                                     */
/* ------------------------------------------------------------------------- */

export function orgIdFrom(request: Request, body?: Record<string, unknown>): string | null {
    const fromQuery = new URL(request.url).searchParams.get('orgId');
    const fromBody = typeof body?.organization_id === 'string' ? body.organization_id : null;
    const fromBodyAlt = typeof body?.orgId === 'string' ? body.orgId : null;
    return fromQuery || fromBody || fromBodyAlt || null;
}

/** UUID gate. orgId reaches a WHERE clause, so it is validated before use. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): v is string {
    return !!v && UUID_RE.test(v);
}
