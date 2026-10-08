/**
 * Step 2 — Organisation hierarchy built ONLY from `employee_profiles.reporting_manager_id`.
 *
 * `reporting_manager_id` stores the manager's USER id (users.id), so everything here is keyed by userId.
 * This file is pure (no database, no network) so the rules can be tested offline.
 * It is read-only logic: nothing here changes any data or any permission yet.
 */

export interface HierarchyPerson {
    userId: string;
    profileId: string;
    name: string;
    departmentId: string | null;
    departmentName: string | null;
    taskRole: string;               // the OLD label, kept only for comparison on screen
    managerUserId: string | null;   // reporting_manager_id
}

export type HierarchyIssueType =
    | 'no_manager'        // top of a chain (not an error: e.g. founders)
    | 'manager_missing'   // manager id points to someone who is not an active, linked employee
    | 'self_manager'
    | 'cycle';

export interface HierarchyIssue {
    type: HierarchyIssueType;
    userId: string;
    name: string;
    detail?: string;
}

export type LabelMismatch =
    | 'manager_by_hierarchy_but_label_employee'   // has people reporting to them, label says "employee"
    | 'label_manager_but_no_reports'              // label says "reporting_manager", nobody reports to them
    | null;

export interface DepartmentView {
    departmentId: string;
    members: HierarchyPerson[];
    /** Members whose manager is outside the department (or who have no manager): the top of the department. */
    topMembers: HierarchyPerson[];
    /** The people ABOVE the department's top members (e.g. Procurement → the founder). */
    externalManagers: HierarchyPerson[];
    /** Members who manage at least one other member of the same department. */
    internalManagers: HierarchyPerson[];
    hasInternalManager: boolean;
}

export class OrgHierarchy {
    private readonly byUser = new Map<string, HierarchyPerson>();
    private readonly children = new Map<string, HierarchyPerson[]>();

    constructor(people: HierarchyPerson[]) {
        for (const p of people) {
            if (p.userId && !this.byUser.has(p.userId)) this.byUser.set(p.userId, p);
        }
        for (const p of this.byUser.values()) {
            if (!p.managerUserId || p.managerUserId === p.userId) continue;
            if (!this.byUser.has(p.managerUserId)) continue;
            const list = this.children.get(p.managerUserId) || [];
            list.push(p);
            this.children.set(p.managerUserId, list);
        }
    }

    get people(): HierarchyPerson[] {
        return [...this.byUser.values()];
    }

    getPerson(userId: string): HierarchyPerson | null {
        return this.byUser.get(userId) || null;
    }

    /** The person this user reports to (null if none, or if that manager is not an active linked employee). */
    managerOf(userId: string): HierarchyPerson | null {
        const p = this.byUser.get(userId);
        if (!p || !p.managerUserId || p.managerUserId === userId) return null;
        return this.byUser.get(p.managerUserId) || null;
    }

    directReports(userId: string): HierarchyPerson[] {
        return this.children.get(userId) || [];
    }

    /** Everyone below this user: direct AND indirect reports. Loop-safe. */
    allReports(userId: string): HierarchyPerson[] {
        const result: HierarchyPerson[] = [];
        const seen = new Set<string>([userId]);
        const queue = [...this.directReports(userId)];
        while (queue.length > 0) {
            const next = queue.shift()!;
            if (seen.has(next.userId)) continue;
            seen.add(next.userId);
            result.push(next);
            queue.push(...this.directReports(next.userId));
        }
        return result;
    }

    /** manager → manager's manager → … (nearest first). Loop-safe. */
    chainUp(userId: string): HierarchyPerson[] {
        const chain: HierarchyPerson[] = [];
        const seen = new Set<string>([userId]);
        let cur = this.managerOf(userId);
        while (cur && !seen.has(cur.userId)) {
            chain.push(cur);
            seen.add(cur.userId);
            cur = this.managerOf(cur.userId);
        }
        return chain;
    }

    /** True when `managerUserId` is anywhere above `targetUserId` in the chain. */
    isAbove(managerUserId: string, targetUserId: string): boolean {
        if (managerUserId === targetUserId) return false;
        return this.chainUp(targetUserId).some(p => p.userId === managerUserId);
    }

    /**
     * Assignment rule (preview only — not enforced anywhere yet):
     * you may assign to anyone strictly BELOW you in the chain, direct or indirect.
     */
    canAssign(actorUserId: string, targetUserId: string): boolean {
        return this.isAbove(actorUserId, targetUserId);
    }

    /** A "manager" by hierarchy is simply someone who has at least one direct report. */
    isManagerByHierarchy(userId: string): boolean {
        return this.directReports(userId).length > 0;
    }

    labelMismatch(userId: string): LabelMismatch {
        const p = this.byUser.get(userId);
        if (!p || p.taskRole === 'superuser') return null;
        const manages = this.isManagerByHierarchy(userId);
        if (manages && p.taskRole === 'employee') return 'manager_by_hierarchy_but_label_employee';
        if (!manages && p.taskRole === 'reporting_manager') return 'label_manager_but_no_reports';
        return null;
    }

    departmentView(departmentId: string): DepartmentView {
        const members = this.people.filter(p => p.departmentId === departmentId);
        const memberIds = new Set(members.map(m => m.userId));

        const topMembers = members.filter(m => {
            const mgr = this.managerOf(m.userId);
            return !mgr || !memberIds.has(mgr.userId);
        });

        const externalMap = new Map<string, HierarchyPerson>();
        for (const t of topMembers) {
            const mgr = this.managerOf(t.userId);
            if (mgr && !memberIds.has(mgr.userId)) externalMap.set(mgr.userId, mgr);
        }

        const internalManagers = members.filter(m =>
            this.directReports(m.userId).some(r => memberIds.has(r.userId))
        );

        return {
            departmentId,
            members,
            topMembers,
            externalManagers: [...externalMap.values()],
            internalManagers,
            hasInternalManager: internalManagers.length > 0,
        };
    }

    /** Data-quality findings. `no_manager` is informational (a chain has to start somewhere). */
    issues(): HierarchyIssue[] {
        const out: HierarchyIssue[] = [];
        const inCycle = new Set<string>();

        for (const p of this.byUser.values()) {
            if (p.managerUserId && p.managerUserId === p.userId) {
                out.push({ type: 'self_manager', userId: p.userId, name: p.name, detail: 'Listed as their own manager' });
                continue;
            }
            if (!p.managerUserId) {
                out.push({ type: 'no_manager', userId: p.userId, name: p.name });
                continue;
            }
            if (!this.byUser.has(p.managerUserId)) {
                out.push({
                    type: 'manager_missing',
                    userId: p.userId,
                    name: p.name,
                    detail: 'Manager is not an active employee with a linked user account',
                });
                continue;
            }

            // Walk upward; if we meet someone twice, everyone on that loop is in a cycle.
            const path: string[] = [p.userId];
            const seen = new Set<string>(path);
            let cur = this.byUser.get(p.managerUserId);
            while (cur) {
                if (seen.has(cur.userId)) {
                    const loopStart = path.indexOf(cur.userId);
                    path.slice(loopStart).forEach(id => inCycle.add(id));
                    break;
                }
                seen.add(cur.userId);
                path.push(cur.userId);
                cur = cur.managerUserId ? this.byUser.get(cur.managerUserId) : undefined;
            }
        }

        for (const id of inCycle) {
            const p = this.byUser.get(id)!;
            out.push({ type: 'cycle', userId: id, name: p.name, detail: 'Part of a reporting loop' });
        }
        return out;
    }
}
