import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { OrgHierarchy, HierarchyPerson } from './OrgHierarchy';

export interface HierarchyReportPerson {
    userId: string;
    name: string;
    departmentId: string | null;
    departmentName: string | null;
    taskRole: string;
    managerUserId: string | null;
    managerName: string | null;
    directReports: number;
    totalReports: number;
    isManagerByHierarchy: boolean;
    labelMismatch: ReturnType<OrgHierarchy['labelMismatch']>;
}

export interface HierarchyReportDepartment {
    departmentId: string;
    departmentName: string;
    memberCount: number;
    hasInternalManager: boolean;
    internalManagers: string[];
    topMembers: string[];
    externalManagers: string[];
}

export interface HierarchyReport {
    summary: {
        activeProfiles: number;
        linkedPeople: number;           // active profiles with a user account (the only ones the Task Manager can use)
        withoutUserAccount: number;
        topOfChain: number;
        managersByHierarchy: number;
        labelMismatches: number;
    };
    issues: ReturnType<OrgHierarchy['issues']>;
    departments: HierarchyReportDepartment[];
    people: HierarchyReportPerson[];
}

function personName(first?: string | null, last?: string | null): string {
    return [first, last].filter(Boolean).join(' ').trim() || 'Unnamed';
}

export class HierarchyService {
    /**
     * READ-ONLY. Loads active employee profiles and builds the hierarchy from reporting_manager_id.
     * Contact details (phone / email) are deliberately NOT selected.
     */
    static async load(): Promise<{ hierarchy: OrgHierarchy; activeProfiles: number; withoutUserAccount: number }> {
        const { data, error } = await supabaseAdmin
            .from('employee_profiles')
            .select('id, user_id, first_name, last_name, department, department_id, task_role, reporting_manager_id, is_active')
            .eq('is_active', true);

        if (error) throw error;

        const rows = data || [];
        const people: HierarchyPerson[] = rows
            .filter(r => r.user_id)
            .map(r => ({
                userId: r.user_id as string,
                profileId: r.id as string,
                name: personName(r.first_name, r.last_name),
                departmentId: (r.department_id as string) || null,
                departmentName: (r.department as string) || null,
                taskRole: (r.task_role as string) || 'employee',
                managerUserId: (r.reporting_manager_id as string) || null,
            }));

        return {
            hierarchy: new OrgHierarchy(people),
            activeProfiles: rows.length,
            withoutUserAccount: rows.length - people.length,
        };
    }

    static buildReport(hierarchy: OrgHierarchy, activeProfiles: number, withoutUserAccount: number): HierarchyReport {
        const people: HierarchyReportPerson[] = hierarchy.people.map(p => {
            const mgr = hierarchy.managerOf(p.userId);
            return {
                userId: p.userId,
                name: p.name,
                departmentId: p.departmentId,
                departmentName: p.departmentName,
                taskRole: p.taskRole,
                managerUserId: mgr ? mgr.userId : null,
                managerName: mgr ? mgr.name : null,
                directReports: hierarchy.directReports(p.userId).length,
                totalReports: hierarchy.allReports(p.userId).length,
                isManagerByHierarchy: hierarchy.isManagerByHierarchy(p.userId),
                labelMismatch: hierarchy.labelMismatch(p.userId),
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        const deptIds = new Map<string, string>();
        for (const p of hierarchy.people) {
            if (p.departmentId) deptIds.set(p.departmentId, p.departmentName || 'Unknown');
        }

        const departments: HierarchyReportDepartment[] = [...deptIds.entries()]
            .map(([id, name]) => {
                const v = hierarchy.departmentView(id);
                return {
                    departmentId: id,
                    departmentName: name,
                    memberCount: v.members.length,
                    hasInternalManager: v.hasInternalManager,
                    internalManagers: v.internalManagers.map(m => m.name),
                    topMembers: v.topMembers.map(m => m.name),
                    externalManagers: v.externalManagers.map(m => m.name),
                };
            })
            .sort((a, b) => a.departmentName.localeCompare(b.departmentName));

        const issues = hierarchy.issues();

        return {
            summary: {
                activeProfiles,
                linkedPeople: hierarchy.people.length,
                withoutUserAccount,
                topOfChain: issues.filter(i => i.type === 'no_manager').length,
                managersByHierarchy: people.filter(p => p.isManagerByHierarchy).length,
                labelMismatches: people.filter(p => p.labelMismatch).length,
            },
            issues,
            departments,
            people,
        };
    }

    static async getReport(): Promise<HierarchyReport> {
        const { hierarchy, activeProfiles, withoutUserAccount } = await this.load();
        return this.buildReport(hierarchy, activeProfiles, withoutUserAccount);
    }
}
