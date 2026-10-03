/**
 * Storage for Satej. Supabase (service role) in the app; in-memory for the
 * simulation script. Each table keeps a few indexed columns plus the full
 * record as JSON in `data`, exactly as the procurement-agent package did — only
 * the driver changed, from a raw `postgres` connection (DATABASE_URL) to the
 * supabaseAdmin client every other FMS module uses.
 *
 * Schema: supabase/migrations/20260928000001_satej_vendor_discovery.sql.
 * RLS is on with no policies: nothing reads these tables except the service
 * role, and every API route checks the caller's organisation first.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import type { CallRecord, Requirement, RequirementStatus, Vendor } from './types';
import { nowIso } from './util';

export interface Repo {
    /** Throws DuplicateCodeError when the human code is already taken. */
    createRequirement(r: Requirement): Promise<void>;
    getRequirement(id: string): Promise<Requirement | null>;
    getRequirementByCode(code: string): Promise<Requirement | null>;
    getRequirementByBatch(batchId: string): Promise<Requirement | null>;
    saveRequirement(r: Requirement): Promise<void>;
    listRequirements(organizationId: string, limit?: number): Promise<Requirement[]>;
    /** Across every organisation — the worker's view. */
    listByStatus(statuses: RequirementStatus[], limit?: number): Promise<Requirement[]>;
    /** Claims a requirement for processing. False when another worker holds it. */
    tryLock(id: string, seconds: number): Promise<boolean>;
    unlock(id: string): Promise<void>;

    saveVendors(vendors: Vendor[]): Promise<void>;
    listVendors(requirementId: string): Promise<Vendor[]>;
    saveVendor(v: Vendor): Promise<void>;
    /** Delete this requirement's vendors whose status is one of `statuses`. */
    deleteVendors(requirementId: string, statuses: Vendor['status'][]): Promise<void>;
    /** Of `phones`, those this organisation called in the last `days` days. */
    recentlyCalledPhones(organizationId: string, phones: string[], days: number): Promise<Set<string>>;

    saveCall(c: CallRecord): Promise<void>;
    getCallByExecution(executionId: string): Promise<CallRecord | null>;
    listCalls(requirementId: string): Promise<CallRecord[]>;
}

export class DuplicateCodeError extends Error {}

// ---------------- In-memory (simulation only) ----------------

export class MemoryRepo implements Repo {
    reqs = new Map<string, Requirement>();
    locks = new Map<string, number>();
    vendors = new Map<string, Vendor>();
    calls = new Map<string, CallRecord>();

    private clone<T>(x: T): T {
        return JSON.parse(JSON.stringify(x));
    }
    async createRequirement(r: Requirement) {
        for (const x of this.reqs.values()) if (x.code === r.code) throw new DuplicateCodeError(r.code);
        this.reqs.set(r.id, this.clone(r));
    }
    async getRequirement(id: string) {
        const r = this.reqs.get(id);
        return r ? this.clone(r) : null;
    }
    async getRequirementByCode(code: string) {
        for (const r of this.reqs.values()) if (r.code.toUpperCase() === code.toUpperCase()) return this.clone(r);
        return null;
    }
    async getRequirementByBatch(batchId: string) {
        for (const r of this.reqs.values()) if (r.bolnaBatchId === batchId) return this.clone(r);
        return null;
    }
    async saveRequirement(r: Requirement) {
        r.updatedAt = nowIso();
        this.reqs.set(r.id, this.clone(r));
    }
    async listRequirements(organizationId: string, limit = 100) {
        return [...this.reqs.values()]
            .filter((r) => r.organizationId === organizationId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit)
            .map((r) => this.clone(r));
    }
    async listByStatus(statuses: RequirementStatus[], limit = 200) {
        return [...this.reqs.values()].filter((r) => statuses.includes(r.status)).slice(0, limit).map((r) => this.clone(r));
    }
    async tryLock(id: string, seconds: number) {
        if ((this.locks.get(id) ?? 0) > Date.now()) return false;
        this.locks.set(id, Date.now() + seconds * 1000);
        return true;
    }
    async unlock(id: string) {
        this.locks.delete(id);
    }
    async saveVendors(vs: Vendor[]) {
        for (const v of vs) this.vendors.set(v.id, this.clone(v));
    }
    async listVendors(requirementId: string) {
        return [...this.vendors.values()].filter((v) => v.requirementId === requirementId).map((v) => this.clone(v));
    }
    async saveVendor(v: Vendor) {
        this.vendors.set(v.id, this.clone(v));
    }
    async deleteVendors(requirementId: string, statuses: Vendor['status'][]) {
        for (const [id, v] of this.vendors) if (v.requirementId === requirementId && statuses.includes(v.status)) this.vendors.delete(id);
    }
    async recentlyCalledPhones(organizationId: string, phones: string[], days: number) {
        const cutoff = Date.now() - days * 86400_000;
        const set = new Set<string>();
        for (const c of this.calls.values()) {
            if (c.organizationId === organizationId && phones.includes(c.toNumber) && new Date(c.createdAt).getTime() >= cutoff) {
                set.add(c.toNumber);
            }
        }
        return set;
    }
    async saveCall(c: CallRecord) {
        this.calls.set(c.executionId, this.clone(c));
    }
    async getCallByExecution(executionId: string) {
        const c = this.calls.get(executionId);
        return c ? this.clone(c) : null;
    }
    async listCalls(requirementId: string) {
        return [...this.calls.values()].filter((c) => c.requirementId === requirementId).map((c) => this.clone(c));
    }
}

// ---------------- Supabase ----------------

const REQS = 'satej_requirements';
const VENDORS = 'satej_vendors';
const CALLS = 'satej_calls';

export const SATEJ_MIGRATION = '20260928000001_satej_vendor_discovery.sql';

/** A read that failed is not "no rows". Every query goes through this. */
function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T | null {
    if (res.error && isMissingSchemaError(res.error)) {
        throw new Error(`Satej's tables are not in this database yet. Apply supabase/migrations/${SATEJ_MIGRATION}.`);
    }
    if (res.error) throw new Error(`Satej ${what}: ${res.error.message}`);
    return res.data;
}

type DataRow<T> = { data: T };

class SupabaseRepo implements Repo {
    async createRequirement(r: Requirement) {
        const { error } = await supabaseAdmin.from(REQS).insert({
            id: r.id,
            organization_id: r.organizationId,
            code: r.code,
            status: r.status,
            batch_id: r.bolnaBatchId ?? null,
            data: r,
        });
        if (error?.code === '23505' && /code/.test(error.message)) throw new DuplicateCodeError(r.code);
        must({ data: null, error }, 'create requirement');
    }
    async getRequirement(id: string) {
        const row = must(await supabaseAdmin.from(REQS).select('data').eq('id', id).maybeSingle(), 'read requirement') as DataRow<Requirement> | null;
        return row?.data ?? null;
    }
    async getRequirementByCode(code: string) {
        const row = must(
            await supabaseAdmin.from(REQS).select('data').eq('code', code.toUpperCase()).maybeSingle(),
            'read requirement by code',
        ) as DataRow<Requirement> | null;
        return row?.data ?? null;
    }
    async getRequirementByBatch(batchId: string) {
        const row = must(
            await supabaseAdmin.from(REQS).select('data').eq('batch_id', batchId).maybeSingle(),
            'read requirement by batch',
        ) as DataRow<Requirement> | null;
        return row?.data ?? null;
    }
    async saveRequirement(r: Requirement) {
        r.updatedAt = nowIso();
        must(
            await supabaseAdmin
                .from(REQS)
                .update({ status: r.status, batch_id: r.bolnaBatchId ?? null, data: r, updated_at: r.updatedAt })
                .eq('id', r.id),
            'save requirement',
        );
    }
    async listRequirements(organizationId: string, limit = 100) {
        const rows = must(
            await supabaseAdmin
                .from(REQS)
                .select('data')
                .eq('organization_id', organizationId)
                .order('created_at', { ascending: false })
                .limit(limit),
            'list requirements',
        ) as DataRow<Requirement>[] | null;
        return (rows ?? []).map((x) => x.data);
    }
    async listByStatus(statuses: RequirementStatus[], limit = 200) {
        const rows = must(
            await supabaseAdmin.from(REQS).select('data').in('status', statuses).order('updated_at').limit(limit),
            'list by status',
        ) as DataRow<Requirement>[] | null;
        return (rows ?? []).map((x) => x.data);
    }
    async tryLock(id: string, seconds: number) {
        const now = new Date();
        const rows = must(
            await supabaseAdmin
                .from(REQS)
                .update({ locked_until: new Date(now.getTime() + seconds * 1000).toISOString() })
                .eq('id', id)
                .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
                .select('id'),
            'lock requirement',
        ) as { id: string }[] | null;
        return (rows ?? []).length > 0;
    }
    async unlock(id: string) {
        must(await supabaseAdmin.from(REQS).update({ locked_until: null }).eq('id', id), 'unlock requirement');
    }
    async saveVendors(vs: Vendor[]) {
        if (!vs.length) return;
        must(
            await supabaseAdmin.from(VENDORS).upsert(
                vs.map((v) => ({ id: v.id, organization_id: v.organizationId, requirement_id: v.requirementId, phone: v.phone, data: v })),
            ),
            'save vendors',
        );
    }
    async listVendors(requirementId: string) {
        const rows = must(
            await supabaseAdmin.from(VENDORS).select('data').eq('requirement_id', requirementId).order('created_at').limit(500),
            'list vendors',
        ) as DataRow<Vendor>[] | null;
        return (rows ?? []).map((x) => x.data);
    }
    async saveVendor(v: Vendor) {
        await this.saveVendors([v]);
    }
    async deleteVendors(requirementId: string, statuses: Vendor['status'][]) {
        must(
            await supabaseAdmin.from(VENDORS).delete().eq('requirement_id', requirementId).in('data->>status', statuses),
            'delete vendors',
        );
    }
    async recentlyCalledPhones(organizationId: string, phones: string[], days: number) {
        if (!phones.length) return new Set<string>();
        const rows = must(
            await supabaseAdmin
                .from(CALLS)
                .select('to_number')
                .eq('organization_id', organizationId)
                .in('to_number', phones)
                .gt('created_at', new Date(Date.now() - days * 86400_000).toISOString())
                .limit(1000),
            'recent calls',
        ) as { to_number: string }[] | null;
        return new Set((rows ?? []).map((x) => x.to_number));
    }
    async saveCall(c: CallRecord) {
        must(
            await supabaseAdmin.from(CALLS).upsert(
                {
                    id: c.id,
                    organization_id: c.organizationId,
                    requirement_id: c.requirementId,
                    vendor_id: c.vendorId,
                    execution_id: c.executionId,
                    to_number: c.toNumber,
                    status: c.status,
                    data: c,
                    updated_at: nowIso(),
                },
                { onConflict: 'execution_id' },
            ),
            'save call',
        );
    }
    async getCallByExecution(executionId: string) {
        const row = must(
            await supabaseAdmin.from(CALLS).select('data').eq('execution_id', executionId).maybeSingle(),
            'read call',
        ) as DataRow<CallRecord> | null;
        return row?.data ?? null;
    }
    async listCalls(requirementId: string) {
        const rows = must(
            await supabaseAdmin.from(CALLS).select('data').eq('requirement_id', requirementId).order('created_at').limit(1000),
            'list calls',
        ) as DataRow<CallRecord>[] | null;
        return (rows ?? []).map((x) => x.data);
    }
}

// ---------------- Factory ----------------

const g = globalThis as unknown as { __satejRepo?: Repo };

export function getRepo(): Repo {
    if (!g.__satejRepo) g.__satejRepo = new SupabaseRepo();
    return g.__satejRepo;
}

/** For the simulation script only. */
export function setRepo(r: Repo) {
    g.__satejRepo = r;
}
