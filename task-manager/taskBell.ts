import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Owner 2026-10-20 — the dashboard bell (and phone push) for Task Manager events, next to the WhatsApp alert:
 * a task given to you, handed over to you, a task you gave is done, your daily overdue summary, a task you hold was
 * edited / deleted / got a note by someone else, and a superuser's reply to your request.
 *
 * Uses the existing NotificationService (bell row + push to the person's registered devices, respecting the push
 * switch in the notification matrix). Never throws and never blocks: a failed bell must not fail the task change.
 * Clicking opens the person's Task Manager where we know the page (HR, Procurement, the super-admin dashboard).
 */

export type TaskBellKind = 'TASK_ASSIGNED' | 'TASK_HANDOVER' | 'TASK_COMPLETED' | 'TASK_OVERDUE' | 'TASK_CHANGED' | 'TASK_UPDATE' | 'TASK_DEPENDENCY' | 'TASK_REMINDER';

/** Where the Task Manager lives for this person (null = no known page; the bell still shows). */
export function taskManagerLink(orgId: string | null, membershipRole: string | null, departmentName: string | null): string | null {
    if (orgId && membershipRole === 'org_super_admin') return `/${orgId}/dashboard?tab=tasks`;
    const dept = (departmentName || '').toLowerCase();
    if (orgId && (/\bhr\b/.test(dept) || dept.includes('human'))) return `/${orgId}/hr-tickets?tab=tasks`;
    if (dept.includes('procure')) return '/procurement?tab=tasks';
    return null;
}

export async function taskBell(input: { userId: string; kind: TaskBellKind; title: string; message: string; departmentName?: string | null }): Promise<void> {
    try {
        if (!input.userId) return;
        const { data: m } = await supabaseAdmin.from('organization_memberships').select('organization_id, role').eq('user_id', input.userId).limit(1).maybeSingle();
        const orgId = (m?.organization_id as string | undefined) ?? null;
        const link = taskManagerLink(orgId, (m?.role as string | undefined) ?? null, input.departmentName ?? null);
        const { NotificationService } = await import('@/backend/services/NotificationService');
        await NotificationService.send({
            userId: input.userId,
            ...(orgId ? { organizationId: orgId } : {}),
            type: input.kind,
            title: input.title.slice(0, 120),
            message: input.message.replace(/\s+/g, ' ').trim().slice(0, 500),
            ...(link ? { deepLink: link } : {}),
            priority: 'NORMAL',
        });
    } catch (err) {
        console.error('[taskBell] skipped:', err instanceof Error ? err.message : err);
    }
}

/** "A, B and 3 more" — short task lists for a bell line. */
export function shortList(titles: string[], max = 3): string {
    const t = titles.filter(Boolean);
    return t.length <= max ? t.join(', ') : `${t.slice(0, max).join(', ')} and ${t.length - max} more`;
}
