import { TaskDatabaseService } from './TaskDatabaseService';
import { HierarchyService } from './HierarchyService';
import { TaskAccessService } from './TaskAccessService';
import { Employee, EmployeeRole, TaskAssignment } from './types';

export class PermissionDeniedError extends Error {
    public readonly code = 'PERMISSION_DENIED';
    public readonly actorId: string;
    public readonly action: string;

    constructor(action: string, actorId: string, reason?: string) {
        super(reason || `Action '${action}' denied for user ${actorId}`);
        this.name = 'PermissionDeniedError';
        this.actorId = actorId;
        this.action = action;
    }
}

export class PermissionService {
    /**
     * Step 2C: true when `targetId` is anywhere BELOW `actorId` in the reporting chain
     * (employee_profiles.reporting_manager_id), direct or indirect.
     */
    private static async isBelowInChain(actorId: string, targetId: string): Promise<boolean> {
        const { hierarchy } = await HierarchyService.load();
        return hierarchy.canAssign(actorId, targetId);
    }

    /**
     * Step 5 — THE shared rule for "whose tasks may this person see or assign to".
     * Used by the web Tasks tab AND the WhatsApp commands so they can never disagree.
     *   - superuser: everyone
     *   - everyone else: themselves, everyone below them in the reporting chain,
     *     and (only when "team sharing" is ON for their department) their department colleagues.
     */
    static async visibleAndAssignable(actor: Employee, candidates: Employee[]): Promise<Employee[]> {
        if (actor.role === 'superuser') return candidates;
        const { hierarchy } = await HierarchyService.load();
        const below = new Set(hierarchy.allReports(actor.id).map(p => p.userId));
        const sharing = await TaskAccessService.isPeerAssignEnabled(actor.department_id);
        return candidates.filter(e =>
            e.id === actor.id ||
            below.has(e.id) ||
            (sharing && !!actor.department_id && e.department_id === actor.department_id)
        );
    }

    /**
     * Resolves the actor's employee profile and task role.
     */
    static async getActor(actorId: string): Promise<Employee> {
        const actor = await TaskDatabaseService.getEmployeeById(actorId);
        if (!actor) {
            throw new PermissionDeniedError('RESOLVE_ACTOR', actorId, `Actor with ID ${actorId} not found or inactive`);
        }
        return actor;
    }

    /**
     * Validates if the actor is permitted to read an assigned task.
     * - Anyone: Own tasks
     * - Managers: tasks of everyone below them in the reporting chain
     * - Superuser: Any task
     */
    static async assertCanReadTask(actorId: string, task: TaskAssignment): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        if (task.employee_id === actor.id) return;

        // Anyone below the actor in the reporting chain, or a colleague when team sharing is ON
        const owner = await TaskDatabaseService.getEmployeeById(task.employee_id);
        if (owner && (await this.visibleAndAssignable(actor, [owner])).length === 1) return;

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            targetEmployeeId: task.employee_id,
            taskId: task.id,
            details: { action: 'READ_TASK', reason: 'Not task owner or above them in the reporting chain' }
        });

        throw new PermissionDeniedError('READ_TASK', actorId, 'You do not have permission to view this task.');
    }

    /**
     * Validates if the actor is permitted to complete or update status of a task.
     * - Anyone: Can complete their own task
     * - Managers: Can update tasks of everyone below them in the reporting chain
     * - Superuser: Can update any task
     */
    static async assertCanCompleteTask(actorId: string, task: TaskAssignment): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        if (task.employee_id === actor.id) return;

        // Anyone below the actor in the reporting chain (direct or indirect)
        if (await this.isBelowInChain(actor.id, task.employee_id)) return;

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            targetEmployeeId: task.employee_id,
            taskId: task.id,
            details: { action: 'COMPLETE_TASK', reason: 'Not authorized to complete another user task' }
        });

        throw new PermissionDeniedError('COMPLETE_TASK', actorId, 'You can only complete your own assigned tasks.');
    }

    /**
     * Validates if the actor is permitted to assign a task to a target employee.
     * - Superuser: Can assign to any employee across the entire organization
     * - Everyone else: Can assign only to people BELOW them in the reporting chain
     *   (employee_profiles.reporting_manager_id, direct or indirect). No reports = cannot assign.
     */
    static async assertCanAssignTask(actorId: string, targetEmployeeId: string): Promise<{ actor: Employee; target: Employee }> {
        const actor = await this.getActor(actorId);
        const target = await TaskDatabaseService.getEmployeeById(targetEmployeeId);

        if (!target) {
            throw new Error(`Target employee ${targetEmployeeId} not found or inactive`);
        }

        if (actor.role === 'superuser') {
            return { actor, target };
        }

        // Step 2C + Step 5: yourself, anyone below you in the chain, or a colleague when team sharing is ON.
        if ((await this.visibleAndAssignable(actor, [target])).length === 1) {
            return { actor, target };
        }

        // Working with a superuser: ONLY when the actor's department has that switch ON (Control Center, OFF by default),
        // and ONLY for a superuser target. Nothing else about who may assign to whom is changed.
        if (target.role === 'superuser' && actor.department_id && await TaskAccessService.isSuperuserCollabEnabled(actor.department_id)) {
            return { actor, target };
        }

        // Standard employees cannot assign tasks
        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            targetEmployeeId: target.id,
            details: { action: 'ASSIGN_TASK', reason: 'Target is not below the actor in the reporting chain' }
        });

        throw new PermissionDeniedError('ASSIGN_TASK', actorId, 'You can only assign tasks to people who report to you (directly or indirectly).');
    }

    /**
     * Validates if the actor is permitted to view a specific department's progress.
     * - Employee: Cannot view department progress
     * - Manager: Own department only
     * - Superuser: Any department
     */
    static async assertCanViewDepartment(actorId: string, departmentId: string): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        if (actor.role === 'reporting_manager' && actor.department_id === departmentId) {
            return;
        }

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            details: { action: 'VIEW_DEPARTMENT', requestedDept: departmentId, reason: 'Department access restricted' }
        });

        throw new PermissionDeniedError('VIEW_DEPARTMENT', actorId, 'Access restricted to your own department.');
    }

    /**
     * Validates if the actor can query organization-wide metrics.
     * - Superuser only
     */
    static async assertCanViewOrganisation(actorId: string): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            details: { action: 'VIEW_ORGANISATION', reason: 'Requires superuser role' }
        });

        throw new PermissionDeniedError('VIEW_ORGANISATION', actorId, 'Superuser role required to view organization-wide progress.');
    }

    /**
     * Returns the list of department IDs accessible by this actor.
     * - Superuser: all active department IDs
     * - Manager: [own department_id]
     * - Employee: []
     */
    static async getAccessibleDepartmentIds(actorId: string): Promise<string[]> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') {
            const allDepts = await TaskDatabaseService.getDepartments();
            return allDepts.map(d => d.id);
        }

        if (actor.role === 'reporting_manager' && actor.department_id) {
            return [actor.department_id];
        }

        return [];
    }
}
