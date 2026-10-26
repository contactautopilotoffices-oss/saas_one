import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { SuperuserReminder, normalizeReminder } from './pingMessage';

/**
 * Step 3 — Task Manager access control.
 *
 * A person may use the Task Manager (WhatsApp commands, digests, being assigned tasks) only when:
 *   1. their DEPARTMENT is switched ON, and
 *   2. their KICKOFF has been recorded as sent (onboarded).
 *
 * Until the SQL migration (20261007000001) has been run, the two tables do not exist ("not provisioned").
 * In that state only the Tech team is unlocked, so nothing changes for the people already using it.
 * If the settings exist but cannot be read, access is DENIED (fail closed).
 */

export const TECH_DEPARTMENT_ID = '94a74961-2dd8-453d-9728-f6f2b9ade99b';

/** Owner 2026-10-19: per-team switches stored as columns of task_manager_department_settings. */
export const TEAM_FEATURES = ['pending_on', 'protect_given', 'assigned_tab'] as const;
export type TeamFeature = typeof TEAM_FEATURES[number];

export type AccessReason = 'ok' | 'no_department' | 'department_off' | 'not_onboarded' | 'settings_unreadable';

export interface AccessDecision {
    allowed: boolean;
    reason: AccessReason;
    message: string;
}

export interface OnboardingRecord {
    userId: string;
    departmentId: string | null;
    kickoffType: 'employee' | 'manager' | null;
    source: 'whatsapp' | 'manual' | 'backfill';
    kickoffSentAt: string;
    recordedBy: string | null;
}

export interface AccessSnapshot {
    provisioned: boolean;   // the two tables exist
    readable: boolean;      // they could be read (false = fail closed)
    departmentEnabled: Map<string, boolean>;
    onboarded: Map<string, OnboardingRecord>;
}

export class AccessNotProvisionedError extends Error {
    constructor() {
        super('Task Manager access tables are not created yet. Run supabase/migrations/20261007000001_task_manager_access_control.sql in the Supabase SQL Editor first.');
        this.name = 'AccessNotProvisionedError';
    }
}

const MESSAGES: Record<AccessReason, string> = {
    ok: 'Task Manager is available.',
    no_department: 'Your profile has no department yet, so the Task Manager is not available to you.',
    department_off: 'The Task Manager is not switched on for your team yet.',
    not_onboarded: 'Your Task Manager kickoff has not been sent yet, so it is not available to you yet.',
    settings_unreadable: 'The Task Manager is temporarily unavailable. Please try again later.',
};

function isMissingTable(err: any): boolean {
    if (!err) return false;
    const code = String(err.code || '');
    const msg = String(err.message || '').toLowerCase();
    return code === '42P01' || code === 'PGRST205' || msg.includes('does not exist') || msg.includes('could not find the table');
}

export class TaskAccessService {
    /**
     * Pure decision function (no I/O). Rules, in order:
     * unreadable settings → no · no department → no · not provisioned → Tech only ·
     * department OFF → no · not onboarded → no · otherwise yes.
     */
    static decide(snapshot: AccessSnapshot, person: { userId?: string | null; departmentId?: string | null }): AccessDecision {
        const deny = (reason: AccessReason): AccessDecision => ({ allowed: false, reason, message: MESSAGES[reason] });

        if (!snapshot.readable) return deny('settings_unreadable');
        if (!person.departmentId) return deny('no_department');

        if (!snapshot.provisioned) {
            return person.departmentId === TECH_DEPARTMENT_ID
                ? { allowed: true, reason: 'ok', message: MESSAGES.ok }
                : deny('department_off');
        }

        if (snapshot.departmentEnabled.get(person.departmentId) !== true) return deny('department_off');
        if (!person.userId || !snapshot.onboarded.has(person.userId)) return deny('not_onboarded');
        return { allowed: true, reason: 'ok', message: MESSAGES.ok };
    }

    /** Reads both tables. A genuine read error is reported as unreadable so callers fail closed. */
    static async getSnapshot(): Promise<AccessSnapshot> {
        const empty = (provisioned: boolean, readable: boolean): AccessSnapshot => ({
            provisioned,
            readable,
            departmentEnabled: new Map(),
            onboarded: new Map(),
        });

        try {
            const [deptRes, onboardRes] = await Promise.all([
                supabaseAdmin.from('task_manager_department_settings').select('department_id, enabled'),
                supabaseAdmin.from('task_manager_onboarding').select('user_id, department_id, kickoff_type, source, kickoff_sent_at, recorded_by'),
            ]);

            if (isMissingTable(deptRes.error) || isMissingTable(onboardRes.error)) return empty(false, true);
            if (deptRes.error || onboardRes.error) {
                console.error('[TaskAccessService] Could not read access settings; denying access:', deptRes.error?.message || onboardRes.error?.message);
                return empty(true, false);
            }

            const snapshot = empty(true, true);
            for (const r of deptRes.data || []) snapshot.departmentEnabled.set(r.department_id, Boolean(r.enabled));
            for (const r of onboardRes.data || []) {
                snapshot.onboarded.set(r.user_id, {
                    userId: r.user_id,
                    departmentId: r.department_id || null,
                    kickoffType: r.kickoff_type || null,
                    source: r.source,
                    kickoffSentAt: r.kickoff_sent_at,
                    recordedBy: r.recorded_by || null,
                });
            }
            return snapshot;
        } catch (err: any) {
            console.error('[TaskAccessService] Unexpected error reading access settings; denying access:', err?.message);
            return empty(true, false);
        }
    }

    static async check(
        person: { userId?: string | null; departmentId?: string | null },
        snapshot?: AccessSnapshot
    ): Promise<AccessDecision> {
        return this.decide(snapshot || await this.getSnapshot(), person);
    }

    /**
     * Departments where the Task Manager is switched ON (same rule as `decide`): not provisioned → Tech only; unreadable
     * settings → none (fail closed). Used to keep team / company progress to active departments only.
     */
    static async activeDepartmentIds(snapshot?: AccessSnapshot): Promise<Set<string>> {
        const snap = snapshot || await this.getSnapshot();
        if (!snap.readable) return new Set();
        if (!snap.provisioned) return new Set([TECH_DEPARTMENT_ID]);
        return new Set([...snap.departmentEnabled].filter(([, on]) => on).map(([id]) => id));
    }

    /** Splits a list of employees into unlocked and locked, using ONE snapshot read. */
    static async partition<T extends { id: string; department_id: string | null }>(
        employees: T[],
        snapshot?: AccessSnapshot
    ): Promise<{ allowed: T[]; locked: Array<{ employee: T; decision: AccessDecision }> }> {
        const snap = snapshot || await this.getSnapshot();
        const allowed: T[] = [];
        const locked: Array<{ employee: T; decision: AccessDecision }> = [];
        for (const employee of employees) {
            const decision = this.decide(snap, { userId: employee.id, departmentId: employee.department_id });
            if (decision.allowed) allowed.push(employee);
            else locked.push({ employee, decision });
        }
        return { allowed, locked };
    }

    // ── Writes (used by the Control Center) ─────────────────────────────────────

    static async setDepartmentEnabled(departmentId: string, enabled: boolean, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({
                department_id: departmentId,
                enabled,
                updated_by: actor || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'department_id' });
        if (error) throw error;

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_department_updated',
            details: { departmentId, departmentName: dept.name, enabled, actor: actor || null },
        });
    }

    static async recordKickoff(params: {
        userId: string;
        departmentId?: string | null;
        kickoffType?: 'employee' | 'manager' | null;
        source: 'whatsapp' | 'manual';
        actor?: string;
    }): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const { error } = await supabaseAdmin
            .from('task_manager_onboarding')
            .upsert({
                user_id: params.userId,
                department_id: params.departmentId || null,
                kickoff_type: params.kickoffType || null,
                source: params.source,
                kickoff_sent_at: new Date().toISOString(),
                recorded_by: params.actor || null,
            }, { onConflict: 'user_id' });
        if (error) throw error;

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_kickoff_recorded',
            details: {
                userId: params.userId,
                departmentId: params.departmentId || null,
                kickoffType: params.kickoffType || null,
                source: params.source,
                actor: params.actor || null,
            },
        });
    }

    /** Used right after a REAL kickoff was delivered. Never throws: a failed record must not break the send flow. */
    static async recordKickoffSafe(params: Parameters<typeof TaskAccessService.recordKickoff>[0]): Promise<void> {
        try {
            await this.recordKickoff(params);
        } catch (err: any) {
            if (err instanceof AccessNotProvisionedError) return;
            console.error('[TaskAccessService] Failed to record kickoff:', err?.message);
        }
    }

    static async removeKickoff(userId: string, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const { error } = await supabaseAdmin.from('task_manager_onboarding').delete().eq('user_id', userId);
        if (error) throw error;

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_kickoff_removed',
            details: { userId, actor: actor || null },
        });
    }

    // ── Step 5: team sharing (peer_assign) ──────────────────────────────────────
    // Read separately from getSnapshot() on purpose: if the peer_assign column does not exist yet
    // (SQL 20261007000002 not run), this simply returns "off" and never affects the lock check.

    /** Departments whose members can see and assign each other's tasks. Any read problem means "none". */
    static async getPeerAssignDepartments(): Promise<{ departments: Set<string>; columnMissing: boolean }> {
        try {
            const { data, error } = await supabaseAdmin
                .from('task_manager_department_settings')
                .select('department_id, peer_assign');
            if (error) return { departments: new Set(), columnMissing: true };
            return {
                departments: new Set((data || []).filter(r => r.peer_assign === true).map(r => r.department_id as string)),
                columnMissing: false,
            };
        } catch {
            return { departments: new Set(), columnMissing: true };
        }
    }

    static async isPeerAssignEnabled(departmentId: string | null | undefined): Promise<boolean> {
        if (!departmentId) return false;
        return (await this.getPeerAssignDepartments()).departments.has(departmentId);
    }

    static async setPeerAssign(departmentId: string, enabled: boolean, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, peer_assign: enabled, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) {
            throw new Error('Could not save team sharing. Run supabase/migrations/20261007000002_task_manager_team_sharing.sql in the Supabase SQL Editor first.');
        }

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_team_sharing_updated',
            details: { departmentId, departmentName: dept.name, peerAssign: enabled, actor: actor || null },
        });
    }

    // ── Owner 2026-10-19: "assign to anyone in team" (team_assign) ───────────────
    // Members may GIVE tasks to anyone in their department; seeing tasks still follows the reporting chain.
    // Same tolerance as team sharing: a missing column (SQL 20261019000001 not run) simply reads as "off".

    /** Departments whose members can give tasks to anyone in the department. Any read problem means "none". */
    static async getTeamAssignDepartments(): Promise<{ departments: Set<string>; columnMissing: boolean }> {
        try {
            const { data, error } = await supabaseAdmin
                .from('task_manager_department_settings')
                .select('department_id, team_assign');
            if (error) return { departments: new Set(), columnMissing: true };
            return {
                departments: new Set((data || []).filter(r => r.team_assign === true).map(r => r.department_id as string)),
                columnMissing: false,
            };
        } catch {
            return { departments: new Set(), columnMissing: true };
        }
    }

    static async isTeamAssignEnabled(departmentId: string | null | undefined): Promise<boolean> {
        if (!departmentId) return false;
        return (await this.getTeamAssignDepartments()).departments.has(departmentId);
    }

    static async setTeamAssign(departmentId: string, enabled: boolean, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, team_assign: enabled, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) {
            throw new Error('Could not save "Assign to anyone in team". Run supabase/migrations/20261019000001_task_manager_team_controls.sql in the Supabase SQL Editor first.');
        }

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_team_assign_updated',
            details: { departmentId, departmentName: dept.name, teamAssign: enabled, actor: actor || null },
        });
    }

    // ── Owner 2026-10-19: three more per-team switches (same SQL file as team_assign; all OFF by default) ────
    //   pending_on     the "Pending on…" button (tell a colleague one of my tasks waits on them)
    //   protect_given  a task someone else gave you cannot be deleted / renamed by you
    //   assigned_tab   the "Assigned by me" tab
    // FAIL-CLOSED: a missing column or any read problem means OFF for everyone.

    static async getTeamFeatures(): Promise<{ pendingOn: Set<string>; protectGiven: Set<string>; assignedTab: Set<string>; columnMissing: boolean }> {
        const none = () => ({ pendingOn: new Set<string>(), protectGiven: new Set<string>(), assignedTab: new Set<string>() });
        try {
            const { data, error } = await supabaseAdmin
                .from('task_manager_department_settings')
                .select('department_id, pending_on, protect_given, assigned_tab');
            if (error) return { ...none(), columnMissing: true };
            const rows = data || [];
            const on = (key: 'pending_on' | 'protect_given' | 'assigned_tab') =>
                new Set(rows.filter(r => (r as Record<string, unknown>)[key] === true).map(r => r.department_id as string));
            return { pendingOn: on('pending_on'), protectGiven: on('protect_given'), assignedTab: on('assigned_tab'), columnMissing: false };
        } catch {
            return { ...none(), columnMissing: true };
        }
    }

    /** One department's switches (all false when the department is unknown or the settings cannot be read). */
    static async teamFeaturesFor(departmentId: string | null | undefined): Promise<{ pendingOn: boolean; protectGiven: boolean; assignedTab: boolean }> {
        if (!departmentId) return { pendingOn: false, protectGiven: false, assignedTab: false };
        const f = await this.getTeamFeatures();
        return { pendingOn: f.pendingOn.has(departmentId), protectGiven: f.protectGiven.has(departmentId), assignedTab: f.assignedTab.has(departmentId) };
    }

    static async setTeamFeature(departmentId: string, feature: TeamFeature, enabled: boolean, actor?: string): Promise<void> {
        if (!TEAM_FEATURES.includes(feature)) throw new Error('Unknown setting');
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, [feature]: enabled, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) {
            throw new Error('Could not save that setting. Run supabase/migrations/20261019000001_task_manager_team_controls.sql in the Supabase SQL Editor first.');
        }

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_team_feature_updated',
            details: { departmentId, departmentName: dept.name, feature, enabled, actor: actor || null },
        });
    }

    // ── Reporting manager role ───────────────────────────────────────────────────

    /**
     * Makes a person a reporting manager, or returns them to a normal employee. Same database change and the same audit
     * events (manager_role_assigned / manager_role_removed) as the old "Manager Role Assignment" card it replaces.
     * A superuser is never silently downgraded: remove the superuser role first.
     */
    static async setReportingManager(userId: string, enabled: boolean, actor?: string): Promise<void> {
        const { data: rows, error } = await supabaseAdmin
            .from('employee_profiles')
            .select('id, task_role, first_name, last_name, department')
            .eq('user_id', userId)
            .eq('is_active', true);
        if (error) throw error;
        if (!rows || rows.length === 0) throw new Error('Active employee with a user account not found');

        const previousRole = rows[0].task_role as string;
        if (previousRole === 'superuser') throw new Error('This person is a superuser. Remove the superuser role first.');
        if (enabled && previousRole === 'reporting_manager') return;
        if (!enabled && previousRole !== 'reporting_manager') return;

        const { error: upErr } = await supabaseAdmin
            .from('employee_profiles')
            .update({ task_role: enabled ? 'reporting_manager' : 'employee', updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('is_active', true);
        if (upErr) throw upErr;

        await TaskDatabaseService.logAudit({
            event_type: enabled ? 'manager_role_assigned' : 'manager_role_removed',
            actor_id: null,
            target_employee_id: userId,
            details: enabled
                ? { role: 'reporting_manager', department: rows[0].department ?? null, profileId: rows[0].id, actor: actor || null }
                : { previousRole: 'reporting_manager', newRole: 'employee', department: rows[0].department ?? null, profileId: rows[0].id, actor: actor || null },
        });
    }

    // ── Superuser role ───────────────────────────────────────────────────────────

    /**
     * Makes a person a Task Manager superuser, or returns them to a normal employee.
     * The last remaining superuser can never be removed. Every change is recorded with the previous role.
     */
    static async setSuperuser(userId: string, enabled: boolean, actor?: string): Promise<void> {
        const { data: rows, error } = await supabaseAdmin
            .from('employee_profiles')
            .select('id, task_role, first_name, last_name')
            .eq('user_id', userId)
            .eq('is_active', true);
        if (error) throw error;
        if (!rows || rows.length === 0) throw new Error('Active employee with a user account not found');

        const previousRole = rows[0].task_role as string;
        const name = [rows[0].first_name, rows[0].last_name].filter(Boolean).join(' ').trim();
        if (enabled && previousRole === 'superuser') return;
        if (!enabled && previousRole !== 'superuser') return;

        if (!enabled) {
            const { data: others, error: othersErr } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .eq('task_role', 'superuser')
                .eq('is_active', true)
                .neq('user_id', userId);
            if (othersErr) throw othersErr;
            if (!others || others.length === 0) {
                throw new Error('At least one superuser must remain. Make someone else a superuser first.');
            }
        }

        const { error: upErr } = await supabaseAdmin
            .from('employee_profiles')
            .update({ task_role: enabled ? 'superuser' : 'employee', updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('is_active', true);
        if (upErr) throw upErr;

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_superuser_updated',
            details: { userId, name, superuser: enabled, previousRole, actor: actor || null },
        });
    }

    // ── Step 6: delegated notification management (notifications_delegated) ────
    // Same tolerance as team sharing: if the column does not exist yet, nobody is delegated.

    static async getDelegatedDepartments(): Promise<{ departments: Set<string>; columnMissing: boolean }> {
        try {
            const { data, error } = await supabaseAdmin
                .from('task_manager_department_settings')
                .select('department_id, notifications_delegated');
            if (error) return { departments: new Set(), columnMissing: true };
            return {
                departments: new Set((data || []).filter(r => r.notifications_delegated === true).map(r => r.department_id as string)),
                columnMissing: false,
            };
        } catch {
            return { departments: new Set(), columnMissing: true };
        }
    }

    static async isNotificationsDelegated(departmentId: string | null | undefined): Promise<boolean> {
        if (!departmentId) return false;
        return (await this.getDelegatedDepartments()).departments.has(departmentId);
    }

    static async setNotificationsDelegated(departmentId: string, enabled: boolean, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, notifications_delegated: enabled, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) {
            throw new Error('Could not save this setting. Run supabase/migrations/20261007000003_task_manager_notification_delegation.sql in the Supabase SQL Editor first.');
        }

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_notifications_delegation_updated',
            details: { departmentId, departmentName: dept.name, notificationsDelegated: enabled, actor: actor || null },
        });
    }

    // ── Task Import: a department's people may send a task list on WhatsApp (task_import_enabled) ────
    // Same tolerance as the two switches above, and FAIL-CLOSED: if the column does not exist yet or cannot
    // be read, no department has Task Import.

    static async getTaskImportDepartments(): Promise<{ departments: Set<string>; columnMissing: boolean }> {
        try {
            const { data, error } = await supabaseAdmin
                .from('task_manager_department_settings')
                .select('department_id, task_import_enabled');
            if (error) return { departments: new Set(), columnMissing: true };
            return {
                departments: new Set((data || []).filter(r => r.task_import_enabled === true).map(r => r.department_id as string)),
                columnMissing: false,
            };
        } catch {
            return { departments: new Set(), columnMissing: true };
        }
    }

    static async isTaskImportEnabled(departmentId: string | null | undefined): Promise<boolean> {
        if (!departmentId) return false;
        return (await this.getTaskImportDepartments()).departments.has(departmentId);
    }

    static async setTaskImportEnabled(departmentId: string, enabled: boolean, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, task_import_enabled: enabled, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) {
            throw new Error('Could not save this setting. Run supabase/migrations/20261007000004_task_manager_task_import.sql in the Supabase SQL Editor first.');
        }

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_task_import_updated',
            details: { departmentId, departmentName: dept.name, taskImportEnabled: enabled, actor: actor || null },
        });
    }

    // ── Smart chat: a department's people may talk to the Task Manager in plain language (smart_chat_enabled) ────
    // Same tolerance and FAIL-CLOSED behaviour as Task Import: a missing column or a read problem means nobody has it.

    static async getSmartChatDepartments(): Promise<{ departments: Set<string>; columnMissing: boolean }> {
        try {
            const { data, error } = await supabaseAdmin
                .from('task_manager_department_settings')
                .select('department_id, smart_chat_enabled');
            if (error) return { departments: new Set(), columnMissing: true };
            return {
                departments: new Set((data || []).filter(r => r.smart_chat_enabled === true).map(r => r.department_id as string)),
                columnMissing: false,
            };
        } catch {
            return { departments: new Set(), columnMissing: true };
        }
    }

    static async isSmartChatEnabled(departmentId: string | null | undefined): Promise<boolean> {
        if (!departmentId) return false;
        return (await this.getSmartChatDepartments()).departments.has(departmentId);
    }

    static async setSmartChatEnabled(departmentId: string, enabled: boolean, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, smart_chat_enabled: enabled, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) {
            throw new Error('Could not save this setting. Run supabase/migrations/20261007000005_task_manager_smart_chat.sql in the Supabase SQL Editor first.');
        }

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_smart_chat_updated',
            details: { departmentId, departmentName: dept.name, smartChatEnabled: enabled, actor: actor || null },
        });
    }

    // ── Working with a superuser: a department may give tasks to a superuser and remind them (superuser_collab_enabled) ────
    // Same tolerance and FAIL-CLOSED behaviour as the other switches. Also carries the team's one shared reminder schedule.

    static async getSuperuserCollab(): Promise<{ departments: Set<string>; reminders: Map<string, SuperuserReminder>; columnMissing: boolean }> {
        try {
            const { data, error } = await supabaseAdmin
                .from('task_manager_department_settings')
                .select('department_id, superuser_collab_enabled, superuser_reminder');
            if (error) return { departments: new Set(), reminders: new Map(), columnMissing: true };
            const rows = data || [];
            return {
                departments: new Set(rows.filter(r => r.superuser_collab_enabled === true).map(r => r.department_id as string)),
                reminders: new Map(rows.filter(r => r.superuser_reminder).map(r => [r.department_id as string, normalizeReminder(r.superuser_reminder)] as [string, SuperuserReminder])),
                columnMissing: false,
            };
        } catch {
            return { departments: new Set(), reminders: new Map(), columnMissing: true };
        }
    }

    static async isSuperuserCollabEnabled(departmentId: string | null | undefined): Promise<boolean> {
        if (!departmentId) return false;
        return (await this.getSuperuserCollab()).departments.has(departmentId);
    }

    static async setSuperuserCollabEnabled(departmentId: string, enabled: boolean, actor?: string): Promise<void> {
        const snapshot = await this.getSnapshot();
        if (!snapshot.provisioned) throw new AccessNotProvisionedError();

        const dept = await TaskDatabaseService.getDepartmentById(departmentId);
        if (!dept) throw new Error('Department not found');

        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, superuser_collab_enabled: enabled, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) {
            throw new Error('Could not save this setting. Run supabase/migrations/20261007000006_task_manager_superuser_pings.sql in the Supabase SQL Editor first.');
        }

        await TaskDatabaseService.logAudit({
            event_type: 'task_access_superuser_collab_updated',
            details: { departmentId, departmentName: dept.name, superuserCollabEnabled: enabled, actor: actor || null },
        });
    }

    /** Saves the team's shared reminder schedule (used by the Tasks tab and by the scheduler to remember the last run). */
    static async saveSuperuserReminder(departmentId: string, reminder: SuperuserReminder, actor?: string): Promise<void> {
        const { error } = await supabaseAdmin
            .from('task_manager_department_settings')
            .upsert({ department_id: departmentId, superuser_reminder: reminder, updated_by: actor || null, updated_at: new Date().toISOString() },
                { onConflict: 'department_id' });
        if (error) throw new Error('Could not save the reminder schedule. Run supabase/migrations/20261007000006_task_manager_superuser_pings.sql in the Supabase SQL Editor first.');
    }

    // ── Overview for the Control Center ─────────────────────────────────────────

    static async getOverview(): Promise<{
        provisioned: boolean;
        readable: boolean;
        teamSharingColumnMissing: boolean;
        teamAssignColumnMissing: boolean;
        teamFeaturesColumnMissing: boolean;
        notificationsColumnMissing: boolean;
        taskImportColumnMissing: boolean;
        smartChatColumnMissing: boolean;
        superuserCollabColumnMissing: boolean;
        departments: Array<{
            departmentId: string;
            name: string;
            enabled: boolean;
            peerAssign: boolean;
            teamAssign: boolean;
            pendingOn: boolean;
            protectGiven: boolean;
            assignedTab: boolean;
            notificationsDelegated: boolean;
            taskImportEnabled: boolean;
            smartChatEnabled: boolean;
            superuserCollabEnabled: boolean;
            memberCount: number;
            onboardedCount: number;
            members: Array<{
                userId: string;
                name: string;
                taskRole: string;
                onboarded: boolean;
                source: string | null;
                kickoffSentAt: string | null;
            }>;
        }>;
    }> {
        const snapshot = await this.getSnapshot();
        const departments = await TaskDatabaseService.getDepartments();
        const peer = await this.getPeerAssignDepartments();
        const teamAssign = await this.getTeamAssignDepartments();
        const features = await this.getTeamFeatures();
        const delegated = await this.getDelegatedDepartments();
        const imports = await this.getTaskImportDepartments();
        const smartChat = await this.getSmartChatDepartments();
        const collab = await this.getSuperuserCollab();

        const { data: profiles, error } = await supabaseAdmin
            .from('employee_profiles')
            .select('user_id, first_name, last_name, department_id, task_role')
            .eq('is_active', true)
            .not('user_id', 'is', null);
        if (error) throw error;

        const seen = new Set<string>();
        const people = (profiles || []).filter(p => {
            if (seen.has(p.user_id)) return false;
            seen.add(p.user_id);
            return true;
        });

        return {
            provisioned: snapshot.provisioned,
            readable: snapshot.readable,
            teamSharingColumnMissing: peer.columnMissing,
            teamAssignColumnMissing: teamAssign.columnMissing,
            teamFeaturesColumnMissing: features.columnMissing,
            notificationsColumnMissing: delegated.columnMissing,
            taskImportColumnMissing: imports.columnMissing,
            smartChatColumnMissing: smartChat.columnMissing,
            superuserCollabColumnMissing: collab.columnMissing,
            departments: departments.map(d => {
                const members = people
                    .filter(p => p.department_id === d.id)
                    .map(p => {
                        const record = snapshot.onboarded.get(p.user_id);
                        const assumedTech = !snapshot.provisioned && d.id === TECH_DEPARTMENT_ID;
                        return {
                            userId: p.user_id as string,
                            name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Unnamed',
                            taskRole: (p.task_role as string) || 'employee',
                            onboarded: Boolean(record) || assumedTech,
                            source: record?.source || (assumedTech ? 'backfill' : null),
                            kickoffSentAt: record?.kickoffSentAt || null,
                        };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name));

                const enabled = snapshot.provisioned
                    ? snapshot.departmentEnabled.get(d.id) === true
                    : d.id === TECH_DEPARTMENT_ID;

                return {
                    departmentId: d.id,
                    name: d.name,
                    enabled,
                    peerAssign: peer.departments.has(d.id),
                    teamAssign: teamAssign.departments.has(d.id),
                    pendingOn: features.pendingOn.has(d.id),
                    protectGiven: features.protectGiven.has(d.id),
                    assignedTab: features.assignedTab.has(d.id),
                    notificationsDelegated: delegated.departments.has(d.id),
                    taskImportEnabled: imports.departments.has(d.id),
                    smartChatEnabled: smartChat.departments.has(d.id),
                    superuserCollabEnabled: collab.departments.has(d.id),
                    memberCount: members.length,
                    onboardedCount: members.filter(m => m.onboarded).length,
                    members,
                };
            }).filter(d => d.memberCount > 0 || d.enabled),
        };
    }
}
