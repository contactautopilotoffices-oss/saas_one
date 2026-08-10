import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { ZohoService } from './zohoService';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import type { ActorChannel, MsmeCategory, VendorZohoSyncResult } from '@/backend/lib/accounts/trackerTypes';

/**
 * Zoho Books contacts -> vendor_profiles. The compliance data was never missing; it was
 * simply never fetched.
 *
 * TWO PHASES, AND THE SPLIT IS THE WHOLE DESIGN
 *
 *   Phase 1 syncVendorList()      4 paginated calls for the org's ~767 vendors. Carries
 *                                 GSTIN, PAN, GST treatment, state code, vendor code, email
 *                                 and phone. Cheap enough to run daily.
 *
 *   Phase 2 enrichVendorDetails() ONE call per vendor for what the list omits — Udyam,
 *                                 MSME class, billing address, bank accounts, TDS. 767
 *                                 sequential calls against a ~100/min rate limit is roughly
 *                                 eight throttled minutes, which does not fit in one
 *                                 request and must never be attempted as one. So it is
 *                                 throttled, capped, oldest-first and RESUMABLE: every run
 *                                 assumes it will be interrupted, and reports what is left.
 *
 * WHAT THIS SYNC IS NOT ALLOWED TO DO
 *   1. Promote compliance_status. A GSTIN coming back from Zoho is not evidence that a
 *      human looked at a certificate, and 'verified' in this table means exactly that.
 *      The one flag it may set is udyam_verified, because Zoho itself validated that
 *      number against the registry (is_valid_udyam_no).
 *   2. Overwrite a filled field with a Zoho blank. An empty gst_no is absence of data,
 *      not a correction.
 *   3. Rewrite bank details or notes that a person already entered. Those are FILL_ONLY:
 *      a payment instruction somebody verified must not be silently replaced by a sync.
 *      A disagreement is reported on the vendor timeline instead of being applied.
 *   4. Invent anything. No placeholders, no "N/A", no derived GSTINs. Missing is NULL.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Zoho's contacts list caps at 200/page; 767 vendors = 4 pages. */
const LIST_PAGE_SIZE = 200;
/** 25 pages = 5,000 vendors. A guard against an infinite has_more_page loop, not a target. */
const MAX_LIST_PAGES = 25;
/** Politeness gap between the 4 list pages. The list endpoint is nowhere near the limit. */
const LIST_PAGE_DELAY_MS = 250;

/**
 * Gap between per-vendor detail calls. Zoho Books allows roughly 100 requests/minute, so
 * 600ms (~100/min) sits at the line and the retry path below absorbs the rest. Slower than
 * necessary beats a 429 storm that costs the whole run.
 */
const DETAIL_DELAY_MS = 600;
/** Cron default. 25 x 600ms = 15s of Zoho time — a batch that always finishes. */
export const DEFAULT_DETAIL_LIMIT = 25;
/** Ceiling for a hand-triggered run: 300 x 600ms = 3 minutes, inside maxDuration = 300. */
export const MAX_DETAIL_LIMIT = 300;
/** Stop and report rather than be killed mid-write by the platform's function timeout. */
const RUN_TIME_BUDGET_MS = 240_000;
/** A vendor enriched more recently than this is not re-fetched while others wait. */
const REFRESH_AFTER_DAYS = 30;

/** Consecutive 429s after which the run stops and hands the rest to the next batch. */
const MAX_CONSECUTIVE_RATE_LIMITS = 3;
/** Per-call retries for a 429 or a transient network failure. */
const MAX_ATTEMPTS = 3;

const DB_PAGE = 1000;
const UPSERT_CHUNK = 200;
/** A first sync legitimately changes hundreds of vendors; 767 timeline rows is noise. */
const MAX_ACTIVITY_LOGS = 100;

const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';

// ---------------------------------------------------------------------------
// Small typed helpers over Zoho's loosely-typed JSON
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
    if (v === null || v === undefined || typeof v === 'object') return null;
    const s = String(v).trim();
    return s === '' ? null : s;
}

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Zoho sends booleans as true/false but occasionally as "true"/"false" strings. */
function bool(v: unknown): boolean | null {
    if (v === true || v === false) return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
}

function obj(v: unknown): Json | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function arr(v: unknown): Json[] {
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Json[]) : [];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/**
 * Zoho's msme_type already uses this table's vocabulary (micro / small / medium), so there
 * is nothing to translate. The care is entirely in the null case: a missing msme_type means
 * NOBODY FILLED IT IN, which is not the same claim as 'not_registered'. Only an explicit
 * Zoho statement earns that value.
 */
const MSME_DIRECT = new Set<string>(['micro', 'small', 'medium']);
const MSME_NOT_REGISTERED = new Set<string>(['not_registered', 'not registered', 'unregistered', 'none', 'no']);
/** Vocabulary Zoho returned that this mapping does not know — surfaced once, never guessed at. */
const unmappedMsme = new Set<string>();

function mapMsme(raw: unknown): MsmeCategory | null {
    const s = str(raw)?.toLowerCase();
    if (!s) return null;
    if (MSME_DIRECT.has(s)) return s as MsmeCategory;
    if (MSME_NOT_REGISTERED.has(s)) return 'not_registered';
    if (!unmappedMsme.has(s)) {
        unmappedMsme.add(s);
        console.warn(`[zoho vendor sync] unknown msme_type "${s}" — left NULL rather than guessed`);
    }
    return null;
}

/** Zoho's cf_vendor_code, wherever this org's Books setup happens to expose it. */
function vendorCode(c: Json): string | null {
    const direct = str(c.cf_vendor_code);
    if (direct) return direct;
    for (const f of arr(c.custom_fields)) {
        if (str(f.api_name) === 'cf_vendor_code' || str(f.label)?.toLowerCase() === 'vendor code') {
            const v = str(f.value);
            if (v) return v;
        }
    }
    return null;
}

/** One address line out of Zoho's six-part billing address. Empty parts are dropped. */
function billingAddress(c: Json): string | null {
    const a = obj(c.billing_address);
    if (!a) return null;
    const parts = [str(a.address), str(a.street2), str(a.city), str(a.state), str(a.zip), str(a.country)]
        .filter((p): p is string => !!p);
    return parts.length ? parts.join(', ') : null;
}

/**
 * The primary bank account. Zoho's key names differ across Books editions, so each field is
 * looked up under every spelling seen rather than assuming one.
 *
 * In this org's data the IFSC arrives as `routing_number` ("HDFC0000258") and the holder as
 * `beneficiary_name`; `is_primary` is false even on a vendor's only account, which is why
 * the fallback to accounts[0] matters rather than being defensive padding.
 */
function bankAccount(c: Json): { name: string | null; number: string | null; ifsc: string | null } {
    const accounts = arr(c.bank_accounts).length ? arr(c.bank_accounts) : arr(c.contact_bank_accounts);
    if (!accounts.length) return { name: null, number: null, ifsc: null };
    const primary = accounts.find((a) => bool(a.is_primary) === true) || accounts[0];
    return {
        name: str(primary.beneficiary_name) || str(primary.account_holder_name) || str(primary.bank_name),
        number: str(primary.account_number) || str(primary.bank_account_number),
        ifsc: str(primary.ifsc) || str(primary.ifsc_code) || str(primary.routing_number),
    };
}

/** The vendor's contact PERSON (Zoho first/last name), not the company. */
function contactPerson(c: Json): string | null {
    const name = [str(c.first_name), str(c.last_name)].filter((p): p is string => !!p).join(' ').trim();
    return name === '' ? null : name;
}

/** Zoho timestamps come through as ISO-ish strings; anything unparseable is dropped. */
function timestamp(v: unknown): string | null {
    const s = str(v);
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * PHASE 1 mapping — everything the list endpoint already carries.
 *
 * legal_name takes company_name here; phase 2 replaces it with Zoho's real `legal_name`
 * (the GST-certificate name) when the detail call brings one. company_name is the better
 * of the two guesses available at list time, not a substitute for the certificate name.
 */
function mapListContact(c: Json): Json {
    return {
        vendor_name: str(c.contact_name) || str(c.company_name) || str(c.vendor_name),
        legal_name: str(c.company_name),
        gstin: str(c.gst_no),
        pan: str(c.pan_no),
        gst_treatment: str(c.gst_treatment),
        // place_of_contact, NOT billing_address.state_code: the latter is empty on every
        // vendor in this org, while place_of_contact is populated on all 807.
        state_code: str(c.place_of_contact),
        vendor_code: vendorCode(c),
        contact_name: contactPerson(c),
        contact_email: str(c.email),
        contact_phone: str(c.phone) || str(c.mobile),
    };
}

/** PHASE 2 mapping — what only the per-contact detail call knows. */
function mapDetailContact(c: Json): Json {
    const bank = bankAccount(c);
    const udyam = str(c.udyam_reg_no);
    const validated = bool(c.is_valid_udyam_no);
    return {
        ...mapListContact(c),
        // The certificate name wins over company_name once we actually have it — though in
        // this org both legal_name and trader_name are blank on every vendor sampled, so
        // company_name is what will land. The order is what matters if that ever changes.
        legal_name: str(c.legal_name) || str(c.trader_name) || str(c.company_name),
        udyam_number: udyam,
        msme_category: mapMsme(c.msme_type),
        // Scoped deliberately: without a number there is nothing for Zoho to have validated,
        // so `true` on a blank Udyam field would be an unearned green tick.
        //
        // Expect false, not true. Every sampled vendor holding a Udyam number came back
        // is_valid_udyam_no=false with an empty udyam_validated_time — this org has not run
        // Zoho's registry check. false therefore means "not verified", NOT "invalid": the
        // API gives no way to tell a rejection from a check that never happened.
        udyam_verified: udyam ? validated : null,
        // Only stamped on a real validation, so a false flag never carries a timestamp that
        // would make it look like somebody checked and failed it.
        udyam_verified_at: udyam && validated ? timestamp(c.udyam_validated_time) : null,
        tds_percentage: num(c.tds_tax_percentage),
        address: billingAddress(c),
        bank_account_name: bank.name,
        bank_account_number: bank.number,
        bank_ifsc: bank.ifsc,
        notes: str(c.notes),
    };
}

/**
 * Columns a person owns. Zoho may FILL them when they are empty but never REWRITE them:
 * bank details move money, and notes are somebody's working memory.
 */
const FILL_ONLY = new Set(['bank_account_name', 'bank_account_number', 'bank_ifsc', 'notes']);

/** Changes worth a timeline entry. A phone number churning is not org news; a GSTIN is. */
const MATERIAL_FIELDS = ['gstin', 'pan', 'udyam_number', 'msme_category', 'legal_name', 'gst_treatment', 'udyam_verified'];

// ---------------------------------------------------------------------------
// Schema probe — this file must work either side of 20260806000001
// ---------------------------------------------------------------------------

const ZOHO_COLUMNS = [
    'legal_name', 'gst_treatment', 'state_code', 'vendor_code',
    'udyam_verified', 'udyam_verified_at', 'tds_percentage', 'zoho_synced_at', 'zoho_raw',
] as const;

const BASE_COLUMNS = [
    'id', 'zoho_vendor_id', 'vendor_name', 'gstin', 'pan', 'udyam_number', 'msme_category',
    'bank_account_name', 'bank_account_number', 'bank_ifsc',
    'contact_name', 'contact_email', 'contact_phone', 'address', 'notes', 'updated_at',
] as const;

export class MissingVendorTableError extends Error {
    constructor() {
        super('Vendor compliance requires a pending database migration (20260805000001).');
        this.name = 'MissingVendorTableError';
    }
}

let columnCache: { at: number; present: boolean } | null = null;
const COLUMN_CACHE_TTL_MS = 5 * 60_000;

/**
 * Are 20260806000001's columns there yet?
 *
 * Migrations in this repo are written by the agent and applied by a human, so this code
 * ships BEFORE its schema does. Rather than 42703 on every run in between, the sync
 * degrades to the base columns and says so — a degraded sync that lands 767 GSTINs is worth
 * more than a clean failure. Cached briefly so the answer flips without a redeploy.
 */
export async function zohoColumnsPresent(): Promise<boolean> {
    if (columnCache && Date.now() - columnCache.at < COLUMN_CACHE_TTL_MS) return columnCache.present;

    // limit(0), not limit(1): PostgREST validates the select list before it executes, so a
    // missing column still comes back 42703 — while no org's data is read to answer a
    // question about the SCHEMA. The cache is process-wide and org-agnostic, and a probe
    // that quietly returned another tenant's row would be a cross-org read for nothing.
    const { error } = await supabaseAdmin
        .from('vendor_profiles').select(ZOHO_COLUMNS.join(', ')).limit(0);

    if (error) {
        if (error.code === UNDEFINED_TABLE) throw new MissingVendorTableError();
        if (error.code === UNDEFINED_COLUMN) {
            columnCache = { at: Date.now(), present: false };
            return false;
        }
        throw new Error(error.message);
    }
    columnCache = { at: Date.now(), present: true };
    return true;
}

function stripUnavailable(row: Json, columnsPresent: boolean): Json {
    if (columnsPresent) return row;
    const out: Json = {};
    for (const [k, v] of Object.entries(row)) {
        if (!(ZOHO_COLUMNS as readonly string[]).includes(k)) out[k] = v;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Zoho HTTP with rate-limit handling
// ---------------------------------------------------------------------------

interface ZohoOk { ok: true; body: Json }
interface ZohoFail { ok: false; status: number; message: string; rateLimited: boolean }
type ZohoResponse = ZohoOk | ZohoFail;

/** Zoho's own code for "too many requests", which it sometimes serves with a 400. */
const ZOHO_RATE_LIMIT_CODE = 1301;

async function zohoGet(url: string, token: string): Promise<ZohoResponse> {
    let lastMessage = 'request failed';
    let lastStatus = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
            const text = await res.text();
            let body: Json = {};
            try { body = JSON.parse(text) as Json; } catch { body = { message: text.slice(0, 200) }; }

            const rateLimited = res.status === 429 || num(body.code) === ZOHO_RATE_LIMIT_CODE;
            if (res.ok && num(body.code) === 0) return { ok: true, body };

            lastStatus = res.status;
            lastMessage = str(body.message) || `HTTP ${res.status}`;

            if (rateLimited && attempt < MAX_ATTEMPTS) {
                // Honour Retry-After when Zoho sends one; otherwise back off 2s, 4s.
                const retryAfter = num(res.headers.get('retry-after'));
                await sleep(retryAfter ? retryAfter * 1000 : 2000 * attempt);
                continue;
            }
            if (rateLimited) return { ok: false, status: res.status, message: lastMessage, rateLimited: true };
            // 4xx that is not a rate limit (a deleted contact, a bad id) will not improve
            // on retry — returning immediately keeps the throttle budget for real work.
            if (res.status < 500) return { ok: false, status: res.status, message: lastMessage, rateLimited: false };
        } catch (e) {
            lastMessage = e instanceof Error ? e.message : 'network error';
        }
        if (attempt < MAX_ATTEMPTS) await sleep(1000 * attempt);
    }
    return { ok: false, status: lastStatus, message: lastMessage, rateLimited: false };
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

interface OrgZohoConfig { zohoOrgId: string }

async function resolveConfig(orgId: string): Promise<OrgZohoConfig | string> {
    const { data: cfg, error } = await supabaseAdmin
        .from('accounts_zoho_config')
        .select('zoho_organization_id, is_active')
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error) return `Failed to read the Zoho configuration: ${error.message}`;
    if (!cfg?.zoho_organization_id || cfg.is_active === false) {
        return 'Zoho Books is not configured for this organization';
    }
    return { zohoOrgId: String(cfg.zoho_organization_id) };
}

function emptyResult(phase: 'list' | 'detail', orgId: string): VendorZohoSyncResult {
    return {
        phase,
        organization_id: orgId,
        zoho_organization_id: null,
        fetched: 0, created: 0, updated: 0, skipped: 0, remaining: 0, failed: 0,
        degraded: false,
        duration_ms: 0,
    };
}

type ExistingProfile = Json & { id: string; zoho_vendor_id: string | null };

async function loadProfiles(orgId: string, columnsPresent: boolean): Promise<Map<string, ExistingProfile>> {
    // zoho_raw is deliberately NOT selected: 767 untouched Zoho payloads is megabytes of
    // JSON pulled across the wire to answer a question no comparison here asks.
    const cols = [...BASE_COLUMNS, ...(columnsPresent ? ZOHO_COLUMNS.filter((c) => c !== 'zoho_raw') : [])];
    const byZohoId = new Map<string, ExistingProfile>();

    for (let from = 0; ; from += DB_PAGE) {
        const { data, error } = await supabaseAdmin
            .from('vendor_profiles')
            .select(cols.join(', '))
            .eq('organization_id', orgId)
            .not('zoho_vendor_id', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + DB_PAGE - 1);
        if (error) {
            if (error.code === UNDEFINED_TABLE) throw new MissingVendorTableError();
            throw new Error(error.message);
        }
        const rows = (data || []) as unknown as ExistingProfile[];
        for (const r of rows) if (r.zoho_vendor_id) byZohoId.set(String(r.zoho_vendor_id), r);
        if (rows.length < DB_PAGE) break;
    }
    return byZohoId;
}

function sameValue(a: unknown, b: unknown): boolean {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (typeof b === 'number' || typeof a === 'number') return num(a) === num(b);
    if (typeof b === 'boolean' || typeof a === 'boolean') return bool(a) === bool(b);
    return String(a).trim() === String(b).trim();
}

/**
 * The one rule that keeps this sync trustworthy: Zoho fills gaps, it does not erase people.
 * Returns only the keys that actually change, so an unchanged vendor is not rewritten and
 * updated_at keeps meaning "somebody or something changed this".
 */
function diffAgainstExisting(existing: ExistingProfile, incoming: Json): Json {
    const patch: Json = {};
    for (const [k, v] of Object.entries(incoming)) {
        if (v === null || v === undefined) continue;            // a Zoho blank is not a correction
        const current = existing[k];
        const currentFilled = current !== null && current !== undefined && String(current).trim() !== '';
        if (FILL_ONLY.has(k) && currentFilled) continue;        // human-owned: fill, never rewrite
        if (sameValue(current, v)) continue;
        patch[k] = v;
    }
    return patch;
}

interface PendingUpdate { id: string; zohoId: string; patch: Json; existing: ExistingProfile }

/**
 * Batch the per-vendor patches by their SHAPE. PostgREST needs every object in one upsert
 * to carry the same keys, and a vendor that only gained a phone number has a different
 * shape from one that gained a GSTIN — so rows are grouped by key signature and each group
 * goes up as its own chunked upsert. The alternative, one HTTP round trip per vendor, is
 * 767 of them on the first pass over an already-backfilled roster.
 */
async function upsertPatches(orgId: string, updates: PendingUpdate[], stamp: string): Promise<{ written: number; failed: number }> {
    const groups = new Map<string, PendingUpdate[]>();
    for (const u of updates) {
        const sig = Object.keys(u.patch).sort().join('|');
        const g = groups.get(sig);
        if (g) g.push(u); else groups.set(sig, [u]);
    }

    let written = 0;
    let failed = 0;
    for (const group of groups.values()) {
        const rows = group.map((u) => ({
            organization_id: orgId,
            zoho_vendor_id: u.zohoId,
            // Carried on every update payload so the ON CONFLICT statement's INSERT arm can
            // still satisfy vendor_name NOT NULL if the row is deleted mid-run. Same value
            // the row already holds, so it is a no-op in the normal path.
            vendor_name: u.patch.vendor_name ?? u.existing.vendor_name,
            ...u.patch,
            updated_at: stamp,
        }));
        for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
            const chunk = rows.slice(i, i + UPSERT_CHUNK);
            const { error } = await supabaseAdmin
                .from('vendor_profiles')
                .upsert(chunk, { onConflict: 'organization_id,zoho_vendor_id' });
            if (error) {
                // One bad chunk must not discard the pages already written. Counted, logged,
                // retried on the next run — the sync is idempotent by construction.
                console.error('[zoho vendor sync] upsert chunk failed:', error.message);
                failed += chunk.length;
            } else {
                written += chunk.length;
            }
        }
    }
    return { written, failed };
}

interface ActivityContext { orgId: string; actorId?: string | null; actorChannel: ActorChannel }

async function logVendorChange(
    ctx: ActivityContext,
    vendorProfileId: string,
    vendorName: string,
    existing: ExistingProfile,
    patch: Json,
    extra?: Json,
): Promise<void> {
    const changed = Object.keys(patch).filter((k) => MATERIAL_FIELDS.includes(k));
    if (!changed.length && !extra) return;

    const before: Json = {};
    const after: Json = {};
    for (const k of changed) { before[k] = existing[k] ?? null; after[k] = patch[k]; }

    await logPoActivity({
        organizationId: ctx.orgId,
        // po_activity_log.po_id is nullable and the table carries vendor_profile_id, so this
        // is a first-class vendor event. No PO is invented to hang it on.
        vendorProfileId,
        action: 'vendor_updated',
        actorId: ctx.actorId ?? null,
        actorChannel: ctx.actorChannel,
        actorName: ctx.actorId ? null : 'Zoho Books sync',
        note: changed.length
            ? `Zoho Books sync updated ${changed.join(', ')} for ${vendorName}`
            : `Zoho Books sync flagged a difference for ${vendorName}`,
        detail: { source: 'zoho_books', vendor_name: vendorName, changed, before, after, ...(extra || {}) },
    });
}

/**
 * Zoho holds different bank details from the ones already recorded. NOT applied — see
 * FILL_ONLY — but silence would be worse: somebody has to decide which account is right.
 */
function bankMismatch(existing: ExistingProfile, incoming: Json): Json | null {
    const zohoNumber = str(incoming.bank_account_number);
    const current = str(existing.bank_account_number);
    if (!zohoNumber || !current || zohoNumber === current) return null;
    return {
        bank_mismatch: true,
        stored_bank_account_last4: current.slice(-4),
        zoho_bank_account_last4: zohoNumber.slice(-4),
    };
}

// ---------------------------------------------------------------------------
// PHASE 1 — the vendor list
// ---------------------------------------------------------------------------

export interface SyncOptions {
    actorId?: string | null;
    actorChannel?: ActorChannel;
}

/**
 * Pull every Zoho vendor contact and upsert on (organization_id, zoho_vendor_id).
 *
 * ~4 HTTP calls regardless of roster size, so it is safe to run daily — and safe to re-run
 * after a failure, because a page that never arrived simply is not written and the next run
 * picks it up.
 */
export async function syncVendorList(orgId: string, options: SyncOptions = {}): Promise<VendorZohoSyncResult> {
    const started = Date.now();
    const result = emptyResult('list', orgId);
    const ctx: ActivityContext = {
        orgId,
        actorId: options.actorId ?? null,
        actorChannel: options.actorChannel ?? 'cron',
    };

    const cfg = await resolveConfig(orgId);
    if (typeof cfg === 'string') return { ...result, error: cfg, duration_ms: Date.now() - started };
    result.zoho_organization_id = cfg.zohoOrgId;

    let columnsPresent: boolean;
    try {
        columnsPresent = await zohoColumnsPresent();
    } catch (e) {
        if (e instanceof MissingVendorTableError) throw e;
        return { ...result, error: e instanceof Error ? e.message : 'schema probe failed', duration_ms: Date.now() - started };
    }
    result.degraded = !columnsPresent;

    let token: string;
    let apiDomain: string;
    try {
        const auth = await ZohoService.getAccessToken();
        token = auth.token;
        apiDomain = auth.apiDomain;
    } catch (e) {
        // A refresh failure is the one error worth surfacing loudly: everything downstream
        // is a no-op, and a silent 0-vendor "success" would read as "Zoho has no vendors".
        return { ...result, error: e instanceof Error ? e.message : 'Zoho token refresh failed', duration_ms: Date.now() - started };
    }

    // --- fetch every page -----------------------------------------------------
    const contacts: Json[] = [];
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const url = `${apiDomain}/books/v3/contacts?organization_id=${cfg.zohoOrgId}`
            + `&contact_type=vendor&per_page=${LIST_PAGE_SIZE}&page=${page}`;
        const res = await zohoGet(url, token);
        if (!res.ok) {
            // Partial pages are kept. Half a roster written is half a roster that no longer
            // needs fetching; throwing here would discard three good pages for one bad one.
            result.stopped_reason = res.rateLimited
                ? `rate limited on page ${page} — remaining pages deferred to the next run`
                : `page ${page} failed: ${res.message}`;
            break;
        }
        const batch = arr(res.body.contacts);
        contacts.push(...batch);
        const ctxPage = obj(res.body.page_context);
        if (!bool(ctxPage?.has_more_page)) break;
        if (page === MAX_LIST_PAGES) result.stopped_reason = `page cap (${MAX_LIST_PAGES}) reached`;
        await sleep(LIST_PAGE_DELAY_MS);
    }
    result.fetched = contacts.length;
    if (!contacts.length) return { ...result, duration_ms: Date.now() - started };

    // --- compare with what is already stored ---------------------------------
    let existingByZohoId: Map<string, ExistingProfile>;
    try {
        existingByZohoId = await loadProfiles(orgId, columnsPresent);
    } catch (e) {
        if (e instanceof MissingVendorTableError) throw e;
        return { ...result, error: e instanceof Error ? e.message : 'failed to read vendor profiles', duration_ms: Date.now() - started };
    }

    const stamp = new Date().toISOString();
    const inserts: Json[] = [];
    const updates: PendingUpdate[] = [];
    const seen = new Set<string>();

    for (const c of contacts) {
        const zohoId = str(c.contact_id);
        if (!zohoId) { result.skipped++; continue; }
        // Zoho has been observed returning the same contact twice across page boundaries.
        // Two rows for one key in a single upsert is a Postgres error, not a warning.
        if (seen.has(zohoId)) { result.skipped++; continue; }
        seen.add(zohoId);

        const mapped = stripUnavailable(mapListContact(c), columnsPresent);
        const existing = existingByZohoId.get(zohoId);

        if (!existing) {
            inserts.push({
                organization_id: orgId,
                zoho_vendor_id: zohoId,
                ...mapped,
                // vendor_name is NOT NULL. A contact with no usable name at all still gets a
                // row — it has POs against it — labelled by the id rather than left out.
                vendor_name: mapped.vendor_name ?? `Vendor ${zohoId}`,
                ...(columnsPresent ? { zoho_raw: c } : {}),
                created_at: stamp,
                updated_at: stamp,
            });
            continue;
        }

        const patch = diffAgainstExisting(existing, mapped);
        // The list payload is only worth storing until the richer detail payload replaces it.
        if (columnsPresent && !existing.zoho_synced_at) patch.zoho_raw = c;
        if (!Object.keys(patch).length) { result.skipped++; continue; }
        updates.push({ id: String(existing.id), zohoId, patch, existing });
    }

    // --- write ---------------------------------------------------------------
    for (let i = 0; i < inserts.length; i += UPSERT_CHUNK) {
        const chunk = inserts.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabaseAdmin
            .from('vendor_profiles')
            // ignoreDuplicates:false so a stub created by the backfill between the read above
            // and this write is updated rather than exploding the whole chunk.
            .upsert(chunk, { onConflict: 'organization_id,zoho_vendor_id' });
        if (error) {
            console.error('[zoho vendor sync] insert chunk failed:', error.message);
            result.failed += chunk.length;
        } else {
            result.created += chunk.length;
        }
    }

    const written = await upsertPatches(orgId, updates, stamp);
    result.updated = written.written;
    result.failed += written.failed;

    // --- timeline ------------------------------------------------------------
    let logged = 0;
    let suppressed = 0;
    for (const u of updates) {
        const extra = bankMismatch(u.existing, u.patch);
        const material = Object.keys(u.patch).some((k) => MATERIAL_FIELDS.includes(k));
        if (!material && !extra) continue;
        if (logged >= MAX_ACTIVITY_LOGS) { suppressed++; continue; }
        await logVendorChange(ctx, u.id, String(u.existing.vendor_name ?? u.zohoId), u.existing, u.patch, extra || undefined);
        logged++;
    }
    // Said out loud rather than swallowed: a run that changed 700 vendors and wrote 100
    // timeline entries has not recorded the other 600, and somebody reading the timeline
    // later deserves to know that from the logs.
    if (suppressed) console.info(`[zoho vendor sync] ${logged} timeline entries written, ${suppressed} suppressed by the per-run cap`);

    result.duration_ms = Date.now() - started;
    return result;
}

// ---------------------------------------------------------------------------
// PHASE 2 — per-vendor detail
// ---------------------------------------------------------------------------

export interface EnrichOptions extends SyncOptions {
    /** Vendors to enrich in this run. Defaults to DEFAULT_DETAIL_LIMIT, capped at MAX_DETAIL_LIMIT. */
    limit?: number;
}

/**
 * Fetch the per-contact detail for the vendors that need it most, then stop.
 *
 * This function is built around the assumption that it will NOT finish. 767 vendors at
 * roughly 100 requests/minute is about eight minutes of Zoho time; a serverless request
 * gets a fraction of that. So each run:
 *   - takes the oldest zoho_synced_at first, NULLs before everything (never enriched),
 *   - throttles to DETAIL_DELAY_MS between calls,
 *   - stops early on repeated 429s or when the time budget is spent,
 *   - stamps only the vendors it actually got, so a failure is retried rather than skipped,
 *   - and reports `remaining` so the caller knows whether to schedule another batch.
 */
export async function enrichVendorDetails(orgId: string, options: EnrichOptions = {}): Promise<VendorZohoSyncResult> {
    const started = Date.now();
    const result = emptyResult('detail', orgId);
    const ctx: ActivityContext = {
        orgId,
        actorId: options.actorId ?? null,
        actorChannel: options.actorChannel ?? 'cron',
    };
    const limit = Math.min(MAX_DETAIL_LIMIT, Math.max(1, options.limit ?? DEFAULT_DETAIL_LIMIT));

    const cfg = await resolveConfig(orgId);
    if (typeof cfg === 'string') return { ...result, error: cfg, duration_ms: Date.now() - started };
    result.zoho_organization_id = cfg.zohoOrgId;

    let columnsPresent: boolean;
    try {
        columnsPresent = await zohoColumnsPresent();
    } catch (e) {
        if (e instanceof MissingVendorTableError) throw e;
        return { ...result, error: e instanceof Error ? e.message : 'schema probe failed', duration_ms: Date.now() - started };
    }
    result.degraded = !columnsPresent;

    const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();
    const runStart = new Date().toISOString();

    // --- the work queue -------------------------------------------------------
    // Ordered oldest-first so a run always takes the vendors that have waited longest, and
    // so two runs in a row never fetch the same 25 records.
    //
    // Before 20260806000001 there is no zoho_synced_at to order by, so updated_at stands in:
    // every enriched row is touched (below), which moves it to the back of the queue and
    // keeps the drain resumable on the old schema too.
    const cursor = columnsPresent ? 'zoho_synced_at' : 'updated_at';
    const cols = [...BASE_COLUMNS, ...(columnsPresent ? ZOHO_COLUMNS.filter((c) => c !== 'zoho_raw') : [])];

    let queue: ExistingProfile[];
    try {
        let q = supabaseAdmin
            .from('vendor_profiles')
            .select(cols.join(', '))
            .eq('organization_id', orgId)
            .not('zoho_vendor_id', 'is', null);
        if (columnsPresent) q = q.or(`zoho_synced_at.is.null,zoho_synced_at.lt.${cutoff}`);
        else q = q.lt('updated_at', runStart);
        const { data, error } = await q
            .order(cursor, { ascending: true, nullsFirst: true })
            .order('id', { ascending: true })   // a stable tiebreak, so paging never loops
            .limit(limit);
        if (error) {
            if (error.code === UNDEFINED_TABLE) throw new MissingVendorTableError();
            throw new Error(error.message);
        }
        queue = (data || []) as unknown as ExistingProfile[];
    } catch (e) {
        if (e instanceof MissingVendorTableError) throw e;
        return { ...result, error: e instanceof Error ? e.message : 'failed to read the vendor queue', duration_ms: Date.now() - started };
    }

    if (!queue.length) {
        result.remaining = await countRemaining(orgId, columnsPresent, cutoff, runStart);
        return { ...result, duration_ms: Date.now() - started };
    }

    let token: string;
    let apiDomain: string;
    try {
        const auth = await ZohoService.getAccessToken();
        token = auth.token;
        apiDomain = auth.apiDomain;
    } catch (e) {
        return { ...result, error: e instanceof Error ? e.message : 'Zoho token refresh failed', duration_ms: Date.now() - started };
    }

    // --- drain ----------------------------------------------------------------
    let consecutiveRateLimits = 0;
    let logged = 0;

    for (let i = 0; i < queue.length; i++) {
        if (Date.now() - started > RUN_TIME_BUDGET_MS) {
            result.stopped_reason = 'time budget spent — the rest is deferred to the next batch';
            break;
        }
        const row = queue[i];
        const zohoId = String(row.zoho_vendor_id);

        if (i > 0) await sleep(DETAIL_DELAY_MS);

        const url = `${apiDomain}/books/v3/contacts/${encodeURIComponent(zohoId)}?organization_id=${cfg.zohoOrgId}`;
        const res = await zohoGet(url, token);

        if (!res.ok) {
            result.failed++;
            if (res.rateLimited) {
                consecutiveRateLimits++;
                if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
                    result.stopped_reason = 'Zoho rate limit — stopped early, progress kept, resumes next run';
                    break;
                }
                // Give the bucket a moment to refill before the next vendor.
                await sleep(5000);
            } else {
                consecutiveRateLimits = 0;
                console.warn(`[zoho vendor sync] detail failed for ${zohoId}: ${res.message}`);
            }
            // zoho_synced_at is deliberately NOT stamped: an unfetched vendor must stay at
            // the front of the queue instead of being marked done.
            continue;
        }
        consecutiveRateLimits = 0;

        const contact = obj(res.body.contact);
        if (!contact) { result.failed++; continue; }
        result.fetched++;

        const mapped = stripUnavailable(mapDetailContact(contact), columnsPresent);
        const patch = diffAgainstExisting(row, mapped);
        const extra = bankMismatch(row, mapped);

        const write: Json = { ...patch };
        if (columnsPresent) {
            write.zoho_synced_at = runStart;
            write.zoho_raw = contact;
        }
        // Only a real field change moves updated_at — except on the pre-migration schema,
        // where updated_at IS the cursor and has to advance for the drain to progress.
        if (Object.keys(patch).length || !columnsPresent) write.updated_at = new Date().toISOString();

        const { error } = await supabaseAdmin
            .from('vendor_profiles')
            .update(write)
            .eq('id', row.id)
            .eq('organization_id', orgId);

        if (error) {
            console.error(`[zoho vendor sync] update failed for ${zohoId}: ${error.message}`);
            result.failed++;
            continue;
        }

        if (Object.keys(patch).length) result.updated++; else result.skipped++;

        if (logged < MAX_ACTIVITY_LOGS) {
            const material = Object.keys(patch).some((k) => MATERIAL_FIELDS.includes(k));
            if (material || extra) {
                await logVendorChange(ctx, String(row.id), String(row.vendor_name ?? zohoId), row, patch, extra || undefined);
                logged++;
            }
        }
    }

    result.remaining = await countRemaining(orgId, columnsPresent, cutoff, runStart);
    result.duration_ms = Date.now() - started;
    return result;
}

/** How many vendors still need a detail fetch — the number that decides whether to run again. */
async function countRemaining(orgId: string, columnsPresent: boolean, cutoff: string, runStart: string): Promise<number> {
    let q = supabaseAdmin
        .from('vendor_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .not('zoho_vendor_id', 'is', null);
    q = columnsPresent
        ? q.or(`zoho_synced_at.is.null,zoho_synced_at.lt.${cutoff}`)
        : q.lt('updated_at', runStart);
    const { count, error } = await q;
    if (error) {
        console.error('[zoho vendor sync] remaining count failed:', error.message);
        return 0;
    }
    return count || 0;
}

// ---------------------------------------------------------------------------
// Freshness, for the vendor list screen
// ---------------------------------------------------------------------------

export interface ZohoFreshness {
    available: boolean;
    linked: number;
    neverEnriched: number;
    oldest: string | null;
    newest: string | null;
}

/**
 * Org-wide sync freshness — never page-scoped. "Everything on this page is fresh" while
 * three quarters of the roster has never been fetched is the wrong thing to tell somebody
 * who is about to trust a GSTIN.
 */
export async function getZohoFreshness(orgId: string): Promise<ZohoFreshness> {
    const empty: ZohoFreshness = { available: false, linked: 0, neverEnriched: 0, oldest: null, newest: null };
    let columnsPresent: boolean;
    try {
        columnsPresent = await zohoColumnsPresent();
    } catch {
        return empty;
    }
    if (!columnsPresent) return empty;

    const base = () => supabaseAdmin
        .from('vendor_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .not('zoho_vendor_id', 'is', null);

    const [linkedRes, neverRes, oldestRes, newestRes] = await Promise.all([
        base(),
        base().is('zoho_synced_at', null),
        supabaseAdmin.from('vendor_profiles').select('zoho_synced_at')
            .eq('organization_id', orgId).not('zoho_synced_at', 'is', null)
            .order('zoho_synced_at', { ascending: true }).limit(1).maybeSingle(),
        supabaseAdmin.from('vendor_profiles').select('zoho_synced_at')
            .eq('organization_id', orgId).not('zoho_synced_at', 'is', null)
            .order('zoho_synced_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (linkedRes.error) return empty;
    return {
        available: true,
        linked: linkedRes.count || 0,
        neverEnriched: neverRes.count || 0,
        oldest: (oldestRes.data?.zoho_synced_at as string | undefined) ?? null,
        newest: (newestRes.data?.zoho_synced_at as string | undefined) ?? null,
    };
}
