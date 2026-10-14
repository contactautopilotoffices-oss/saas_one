import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const q = request.nextUrl.searchParams;
    const requestedOrgId = q.get('org_id') || q.get('organization_id') || null;

    // 1. Fetch user memberships to know which orgs and roles they have
    const [pm, om, profile] = await Promise.all([
        supabaseAdmin.from('property_memberships').select('organization_id,property_id,role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('organization_memberships').select('organization_id,role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
    ]);

    const isMaster = Boolean(profile.data?.is_master_admin);
    const allMemberships = [...(pm.data || []), ...(om.data || [])];
    const userOrgs = isMaster && requestedOrgId
        ? [requestedOrgId]
        : [...new Set(allMemberships.map(m => m.organization_id).filter(Boolean))];

    const targetOrgs = requestedOrgId && (isMaster || userOrgs.includes(requestedOrgId))
        ? [requestedOrgId]
        : userOrgs;

    if (!targetOrgs.length) {
        return NextResponse.json({ actions: [] });
    }

    const actions: any[] = [];

    // Check if user is finance/accounts/super_admin for each org
    const canDisburseOrgMap = new Map<string, boolean>();
    targetOrgs.forEach(orgId => {
        const orgRoles = allMemberships.filter(m => m.organization_id === orgId).map(m => m.role);
        const canDisburse = isMaster || orgRoles.some(r => r === 'accounts' || r === 'org_super_admin' || r === 'ops_super_admin');
        canDisburseOrgMap.set(orgId, canDisburse);
    });

    // 2. Fetch active petty cash requests for target orgs
    const { data: reqs, error } = await supabaseAdmin
        .from('petty_cash_requests')
        .select(`
            id, request_no, organization_id, property_id, requester_id,
            assigned_allocator_id, assigned_approver_id,
            amount_requested, allocated_amount, approved_amount, paid_amount,
            purpose, status, workflow_version, created_at, remarks, approval_remarks,
            property:properties(id, name, code),
            requester:users!petty_cash_requests_requester_id_fkey(id, full_name, email)
        `)
        .in('organization_id', targetOrgs)
        .in('status', ['submitted', 'pending_approval', 'approved', 'settlement_submitted', 'sent_back'])
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('[petty-cash-pending-actions]', error.message);
        return NextResponse.json({ actions: [] });
    }

    if (reqs) {
        for (const r of reqs) {
            const orgId = r.organization_id;
            const propertyName = (r.property as any)?.name || 'Property';
            const requesterName = (r.requester as any)?.full_name || (r.requester as any)?.email || 'Staff';
            const deepLink = `/${orgId}/petty-cash?request_id=${r.id}`;

            // Case A: Allocator action
            if (r.workflow_version === 2 && r.status === 'submitted' && r.assigned_allocator_id === user.id && r.requester_id !== user.id) {
                actions.push({
                    id: `pc-alloc-${r.id}`,
                    source: 'petty_cash',
                    title: `Petty Cash: Allocate #${r.request_no}`,
                    subtitle: `${propertyName} • Requested by ${requesterName}`,
                    description: `Amount: ₹${Number(r.amount_requested).toLocaleString('en-IN')} • Purpose: ${r.purpose}`,
                    badgeLabel: 'Allocation Pending',
                    badgeVariant: 'amber',
                    ticketNumber: r.request_no,
                    created_at: r.created_at,
                    deepLink,
                    actions: [
                        { label: 'Allocate Cash', actionKey: 'allocate', variant: 'primary', isQuickAction: true },
                        { label: 'View', actionKey: 'view', variant: 'outline', isQuickAction: false }
                    ],
                    rawPettyCash: r
                });
            }

            // Case B: Approver action
            if (r.workflow_version === 2 && r.status === 'pending_approval' && r.assigned_approver_id === user.id && r.requester_id !== user.id) {
                actions.push({
                    id: `pc-appr-${r.id}`,
                    source: 'petty_cash',
                    title: `Petty Cash: Approve #${r.request_no}`,
                    subtitle: `${propertyName} • Requested by ${requesterName}`,
                    description: `Sanctioned: ₹${Number(r.allocated_amount || r.amount_requested).toLocaleString('en-IN')} • Purpose: ${r.purpose}`,
                    badgeLabel: 'Approval Pending',
                    badgeVariant: 'purple',
                    ticketNumber: r.request_no,
                    created_at: r.created_at,
                    deepLink,
                    actions: [
                        { label: 'Approve', actionKey: 'approve', variant: 'primary', isQuickAction: true },
                        { label: 'View', actionKey: 'view', variant: 'outline', isQuickAction: false }
                    ],
                    rawPettyCash: r
                });
            }

            // Case C: Disbursal action (Finance)
            if (r.status === 'approved' && canDisburseOrgMap.get(orgId) && r.requester_id !== user.id) {
                actions.push({
                    id: `pc-disb-${r.id}`,
                    source: 'petty_cash',
                    title: `Petty Cash: Disburse #${r.request_no}`,
                    subtitle: `${propertyName} • Custodian: ${requesterName}`,
                    description: `Approved: ₹${Number(r.approved_amount || r.amount_requested).toLocaleString('en-IN')} awaiting payment voucher release.`,
                    badgeLabel: 'Ready to Disburse',
                    badgeVariant: 'blue',
                    ticketNumber: r.request_no,
                    created_at: r.created_at,
                    deepLink,
                    actions: [
                        { label: 'Disburse', actionKey: 'disburse', variant: 'primary', isQuickAction: true },
                        { label: 'View', actionKey: 'view', variant: 'outline', isQuickAction: false }
                    ],
                    rawPettyCash: r
                });
            }

            // Case D: Reconciliation review (Finance)
            if (r.status === 'settlement_submitted' && canDisburseOrgMap.get(orgId) && r.requester_id !== user.id) {
                actions.push({
                    id: `pc-recon-${r.id}`,
                    source: 'petty_cash',
                    title: `Petty Cash: Audit #${r.request_no}`,
                    subtitle: `${propertyName} • Submitted by ${requesterName}`,
                    description: `Reconciliation & bills submitted. Review proofs and close request.`,
                    badgeLabel: 'Audit Pending',
                    badgeVariant: 'rose',
                    ticketNumber: r.request_no,
                    created_at: r.created_at,
                    deepLink,
                    actions: [
                        { label: 'Review & Close', actionKey: 'close', variant: 'primary', isQuickAction: true },
                        { label: 'View', actionKey: 'view', variant: 'outline', isQuickAction: false }
                    ],
                    rawPettyCash: r
                });
            }

            // Case E: Requester revision (Sent Back)
            if (r.status === 'sent_back' && r.requester_id === user.id) {
                actions.push({
                    id: `pc-rev-${r.id}`,
                    source: 'petty_cash',
                    title: `Petty Cash: Revision Needed #${r.request_no}`,
                    subtitle: `${propertyName} • Request Sent Back`,
                    description: `Remark: "${r.approval_remarks || r.remarks || 'Sent back for correction'}"`,
                    badgeLabel: 'Action Required',
                    badgeVariant: 'rose',
                    ticketNumber: r.request_no,
                    created_at: r.created_at,
                    deepLink,
                    actions: [
                        { label: 'Revise & Resubmit', actionKey: 'resubmit', variant: 'primary', isQuickAction: true },
                        { label: 'View', actionKey: 'view', variant: 'outline', isQuickAction: false }
                    ],
                    rawPettyCash: r
                });
            }
        }
    }

    // 3. Check if Requester has any rejected expenses needing bill replacement
    const { data: rejectedExpenses } = await supabaseAdmin
        .from('petty_cash_expenses')
        .select(`
            id, request_id, amount, vendor, expense_date, review_remarks, created_at, organization_id,
            request:petty_cash_requests(request_no, property:properties(name))
        `)
        .in('organization_id', targetOrgs)
        .eq('requester_id', user.id)
        .eq('review_status', 'rejected')
        .limit(20);

    if (rejectedExpenses) {
        for (const e of rejectedExpenses) {
            const orgId = e.organization_id;
            const reqNo = (e.request as any)?.request_no || 'Petty Cash';
            const propName = (e.request as any)?.property?.name || 'Property';
            const deepLink = `/${orgId}/petty-cash?request_id=${e.request_id}`;

            actions.push({
                id: `pc-exp-rej-${e.id}`,
                source: 'petty_cash',
                title: `Petty Cash: Bill Rejected #${reqNo}`,
                subtitle: `${propName} • Expense: ₹${Number(e.amount).toLocaleString('en-IN')}`,
                description: `Reason: "${e.review_remarks || 'Proof rejected by finance audit. Replacement bill required.'}"`,
                badgeLabel: 'Bill Rejected',
                badgeVariant: 'rose',
                ticketNumber: reqNo,
                created_at: e.created_at,
                deepLink,
                actions: [
                    { label: 'Fix Bill', actionKey: 'fix_bill', variant: 'primary', isQuickAction: true },
                    { label: 'View', actionKey: 'view', variant: 'outline', isQuickAction: false }
                ],
                rawPettyCash: e
            });
        }
    }

    return NextResponse.json({ actions });
}
