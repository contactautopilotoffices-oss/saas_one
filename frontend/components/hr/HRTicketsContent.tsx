'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    Ticket, Users, Settings, Kanban, Plus, UserCheck, ShieldCheck,
    FileText, CheckCircle2, AlertTriangle, HelpCircle, Lock, Building2,
    Search, ArrowUpRight, Clock, User, ChevronRight, ChevronDown, GitFork,
    Mail, Phone, ExternalLink, RefreshCw, Layers, CheckCircle
} from 'lucide-react';

import TicketCreateModal from '@/frontend/components/hr/TicketCreateModal';
import HRTicketDetailModal from '@/frontend/components/hr/HRTicketDetailModal';
import HRKanbanBoard from '@/frontend/components/hr/HRKanbanBoard';
import HREmployeeDirectory from '@/frontend/components/hr/HREmployeeDirectory';
import HRReconciliationDashboard from '@/frontend/components/hr/HRReconciliationDashboard';
import HRAdminConfigPanel from '@/frontend/components/hr/HRAdminConfigPanel';
import HRAnalyticsDashboard from '@/frontend/components/hr/HRAnalyticsDashboard';
import SLALiveTimer from '@/frontend/components/hr/SLALiveTimer';
import HROrgChartTree from '@/frontend/components/hr/HROrgChartTree';
import EmployeeQuickProfileModal, { EmployeeProfileModalData } from '@/frontend/components/hr/EmployeeQuickProfileModal';
import HRNotesTrackerTab from '@/frontend/components/hr/HRNotesTrackerTab';

export function HRTicketsContent({ orgId }: { orgId: string }) {
    const { user, membership } = useAuth();
    const searchParams = useSearchParams();

    const [activeTab, setActiveTab] = useState<'tickets' | 'notes' | 'tree' | 'directory' | 'reconciliation' | 'config' | 'analytics'>('tickets');
    const [viewMode, setViewMode] = useState<'kanban' | 'table' | 'properties'>('table');

    const [tickets, setTickets] = useState<any[]>([]);
    const [properties, setProperties] = useState<any[]>([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
    const [scopeFilter, setScopeFilter] = useState<'all' | 'my_raised' | 'assigned_to_me' | 'department' | 'my_team_assigned'>('all');
    const [departmentSubView, setDepartmentSubView] = useState<'tree' | 'table'>('tree');
    const [selectedDepartmentUserId, setSelectedDepartmentUserId] = useState<string>('all');
    const [selectedAssigneeFilter, setSelectedAssigneeFilter] = useState<string>('all');
    const [ticketTypeFilter, setTicketTypeFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [employeesList, setEmployeesList] = useState<any[]>([]);

    // Tree View State
    const [treeViewMode, setTreeViewMode] = useState<'chart' | 'list'>('chart');
    const [selectedTreeNodeUser, setSelectedTreeNodeUser] = useState<any | null>(null);
    const [treeSearchQuery, setTreeSearchQuery] = useState<string>('');
    const [expandedTreeNodes, setExpandedTreeNodes] = useState<Record<string, boolean>>({});

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [profileModalData, setProfileModalData] = useState<EmployeeProfileModalData | null>(null);

    // Searchable Property Dropdown state
    const [isPropertyDropdownOpen, setIsPropertyDropdownOpen] = useState(false);
    const [propertySearchQuery, setPropertySearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    const userRole = (user?.user_metadata?.role || membership?.org_role || membership?.properties?.[0]?.role || 'employee').toLowerCase();
    const isOrgSuperAdmin = ['org_super_admin', 'master_admin', 'super_admin', 'ops_super_admin'].includes(userRole);
    const isHrRole = ['hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(userRole);
    const isPropertyAdmin = userRole === 'property_admin';
    const isOpsSuperAdmin = userRole === 'ops_super_admin';
    const isScopedRole = !isOrgSuperAdmin && !isHrRole;
    const canViewOrgWide = isOrgSuperAdmin || isHrRole;
    const isHrAdmin = canViewOrgWide;
    const isManager = ['manager', 'reporting_manager', 'soft_service_manager', 'soft_service_supervisor', 'property_admin', 'building_admin', 'mst_manager', 'supervisor', 'ops_super_admin', 'org_admin'].includes(userRole);

    useEffect(() => {
        if (!canViewOrgWide && (viewMode === 'kanban' || viewMode === 'properties')) {
            setViewMode('table');
        }
    }, [canViewOrgWide, viewMode]);

    useEffect(() => {
        fetchEmployeesList();
    }, [orgId]);

    const fetchEmployeesList = async () => {
        try {
            const res = await fetch(`/api/hr/admin/employees?orgId=${orgId}`);
            const data = await res.json();
            if (data.success && data.data) {
                setEmployeesList(data.data || []);
            } else {
                const fallbackRes = await fetch(`/api/hr/admin/escalation-config?orgId=${orgId}`);
                const fallbackData = await fallbackRes.json();
                if (fallbackData.success && fallbackData.data?.employees) {
                    setEmployeesList(fallbackData.data.employees || []);
                }
            }
        } catch (e) {
            console.error('Error fetching employees list:', e);
        }
    };

    // Helper to normalize manager name variations
    const normalizeManagerName = (str: string): string => {
        if (!str) return '';
        let s = str.trim().toLowerCase();
        if (s.includes('shailesh') && (s.includes('kashyap') || s === 'shailesh k')) return 'shailesh kumar kashyap';
        if (s.includes('chavan meena') || s.includes('meena chavan')) return 'meena chavan';
        if (s.includes('rajesh') && s.includes('kadam')) return 'rajesh kadam';
        if (s.includes('mehul') && s.includes('kapadia')) return 'mehul kapadia';
        if (s.includes('shrihari') || s.includes('gardas')) return 'shrihari gardas';
        if (s.includes('roohi') && (s.includes('idirishi') || s.includes('idrishi'))) return 'roohi idirishi';
        if (s.includes('siddhalingappa')) return 'siddhalingappa nagond';
        if (s.includes('suraj') && (s.includes('nandavadekar') || s.includes('nandavadkar'))) return 'suraj nandavadekar';
        if (s.includes('altamash')) return 'altamash chaugule';
        if (s.includes('abhiram')) return 'abhiram k';
        if (s.includes('kiran') && (s.includes('kumar') || s === 'kiran')) return 'kiran kumar';
        return s;
    };

    /**
     * Robust recursive reportees finder for a manager object.
     * Matches reportees by manager's user_id, profile id, employee_code, full_name, or email with name normalization.
     */
    const getReporteesForManager = (
        mgrObj: { userId?: string; id?: string; code?: string; name?: string; email?: string },
        allEmps: any[],
        visited = new Set<string>()
    ): any[] => {
        if (!mgrObj) return [];

        const mgrUserId = mgrObj.userId || mgrObj.id || '';
        const mgrCode = (mgrObj.code || '').toLowerCase().trim();
        const mgrName = (mgrObj.name || '').trim();
        const mgrEmail = (mgrObj.email || '').toLowerCase().trim();
        const normMgrName = normalizeManagerName(mgrName);

        const visitKey = mgrUserId || mgrCode || normMgrName || mgrEmail;
        if (!visitKey || visited.has(visitKey)) return [];
        const nextVisited = new Set(visited);
        nextVisited.add(visitKey);

        const direct = allEmps.filter(e => {
            const eUid = e.user_id || e.id;
            if (mgrUserId && eUid === mgrUserId) return false;

            const rId = e.reporting_manager_id || '';
            const rCode = (e.reporting_manager_code || '').trim();
            const rName = (e.reporting_manager_name || '').trim();
            const rStr = (rName || rCode).trim();
            const normRStr = normalizeManagerName(rStr);

            const matchUserId = Boolean(mgrUserId && rId && (rId === mgrUserId || (rCode && rCode === mgrUserId)));
            const matchCode = Boolean(mgrCode && ((rCode.toLowerCase() && rCode.toLowerCase() === mgrCode) || (rId && rId === mgrCode)));
            const matchName = Boolean(
                (normMgrName && normRStr && normRStr === normMgrName) ||
                (mgrName && rStr && rStr.toLowerCase() === mgrName.toLowerCase())
            );
            const matchEmail = Boolean(mgrEmail && ((rCode.toLowerCase() === mgrEmail) || (rName.toLowerCase() === mgrEmail)));

            return Boolean(matchUserId || matchCode || matchName || matchEmail);
        });

        // Exclude self to avoid infinite loops if data is self-referential
        const validDirect = direct.filter(r => (r.user_id || r.id) !== mgrUserId);
        let all: any[] = [...validDirect];

        for (const rep of validDirect) {
            const repUid = rep.user_id || rep.id;
            const repKey = repUid || (rep.employee_code || '').toLowerCase().trim() || rep.email;
            if (repKey && nextVisited.has(repKey)) continue;

            const repName = `${rep.first_name || ''} ${rep.last_name || ''}`.trim() || rep.full_name || rep.name || rep.email;
            const subReportees = getReporteesForManager({
                userId: rep.user_id || rep.id,
                id: rep.id,
                code: rep.employee_code,
                name: repName,
                email: rep.email
            }, allEmps, nextVisited);

            for (const sub of subReportees) {
                if (!all.some(item => (item.id === sub.id || (item.user_id && item.user_id === sub.user_id)))) {
                    all.push(sub);
                }
            }
        }

        return all;
    };

    // My direct and nested sub-reportees for current logged-in manager
    const myDepartmentReportees = useMemo(() => {
        if (!user) return [];
        const userFullName = (user.user_metadata?.full_name || user.email || '').trim();
        const userEmpProfile = employeesList.find(e => e.user_id === user.id || (e.email && e.email.toLowerCase() === user.email?.toLowerCase()));

        return getReporteesForManager({
            userId: user.id,
            id: userEmpProfile?.id,
            code: userEmpProfile?.employee_code,
            name: userFullName || `${userEmpProfile?.first_name || ''} ${userEmpProfile?.last_name || ''}`.trim(),
            email: user.email || userEmpProfile?.email
        }, employeesList);
    }, [user, employeesList]);

    const reporteeUserIds = useMemo(() => {
        return new Set(myDepartmentReportees.map(r => r.user_id || r.id).filter(Boolean));
    }, [myDepartmentReportees]);

    // Handle URL search params on mount
    useEffect(() => {
        const tabParam = searchParams.get('subtab') || searchParams.get('tab');
        const actionParam = searchParams.get('action');
        const propertyParam = searchParams.get('propertyId');
        const filterParam = searchParams.get('filter');
        const ticketIdParam = searchParams.get('ticketId');

        if (tabParam && ['tickets', 'notes', 'tree', 'directory', 'reconciliation', 'config', 'analytics'].includes(tabParam)) {
            setActiveTab(tabParam as any);
        }
        if (actionParam === 'create') {
            setIsCreateOpen(true);
        }
        if (ticketIdParam) {
            setSelectedTicketId(ticketIdParam);
        }
        if (filterParam && ['all', 'my_raised', 'assigned_to_me', 'department', 'my_team_assigned'].includes(filterParam)) {
            setScopeFilter(filterParam as any);
        } else {
            setScopeFilter('all');
        }
        setSelectedPropertyId(propertyParam || 'all');
    }, [searchParams, canViewOrgWide, isManager]);

    const handleNavigationTabSwitch = React.useCallback((newTab: 'tickets' | 'notes' | 'tree' | 'directory' | 'reconciliation' | 'config' | 'analytics') => {
        setActiveTab(newTab);
        if (typeof window !== 'undefined') {
            const currentPath = window.location.pathname;
            const params = new URLSearchParams(window.location.search);
            if (currentPath.includes('/hr-tickets')) {
                params.set('tab', newTab);
                window.history.replaceState(null, '', `${currentPath}?${params.toString()}`);
            } else {
                // We are inside /dashboard?tab=grievance or other dashboard host
                // NEVER change pathname so the Super Admin Console sidebar remains 100% stable
                params.set('subtab', newTab);
                window.history.replaceState(null, '', `${currentPath}?${params.toString()}`);
            }
        }
    }, []);

    useEffect(() => {
        fetchProperties();
    }, [orgId]);

    useEffect(() => {
        if (!user?.id) return;
        fetchTickets();
    }, [orgId, user?.id, userRole, selectedPropertyId]);

    // Real-time automatic background data refresh (every 10s & on window focus)
    useEffect(() => {
        if (!user?.id) return;
        const interval = setInterval(() => {
            fetchTickets(true);
        }, 10000);

        const handleFocus = () => fetchTickets(true);
        window.addEventListener('focus', handleFocus);

        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
        };
    }, [orgId, user?.id, userRole, selectedPropertyId]);

    const fetchProperties = async () => {
        try {
            let res = await fetch(`/api/properties?organizationId=${orgId}`);
            let text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            let propsList: any[] = [];

            if (Array.isArray(data)) {
                propsList = data;
            } else if (Array.isArray(data?.data)) {
                propsList = data.data;
            } else if (Array.isArray(data?.properties)) {
                propsList = data.properties;
            }

            if (propsList.length === 0) {
                const adminRes = await fetch(`/api/admin/organizations/${orgId}/properties`);
                if (adminRes.ok) {
                    const adminText = await adminRes.text();
                    let adminData: any = {};
                    try { adminData = adminText ? JSON.parse(adminText) : {}; } catch {}
                    if (Array.isArray(adminData)) {
                        propsList = adminData;
                    } else if (Array.isArray(adminData?.properties)) {
                        propsList = adminData.properties;
                    }
                }
            }

            setProperties(propsList);
        } catch (err) {
            console.error('Error fetching properties:', err);
        }
    };

    const fetchTickets = async (isBackground = false) => {
        if (!user?.id) {
            setLoading(false);
            return;
        }
        if (!isBackground && tickets.length === 0) setLoading(true);
        try {
            const url = new URL('/api/hr/tickets', window.location.origin);
            url.searchParams.append('orgId', orgId);
            url.searchParams.append('userId', user.id);
            url.searchParams.append('role', userRole);
            if (selectedPropertyId !== 'all') {
                url.searchParams.append('propertyId', selectedPropertyId);
            }

            const res = await fetch(url.toString());
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setTickets(data.data || []);
            }
        } catch (err) {
            console.error('Error fetching tickets:', err);
        } finally {
            if (!isBackground) setLoading(false);
        }
    };

    const handleUpdateStatus = async (ticketId: string, newStatus: string) => {
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    actor_user_id: user?.id
                })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                fetchTickets(true);
            }
        } catch (err) {
            console.error('Error updating status:', err);
        }
    };

    const [selectedReporteeId, setSelectedReporteeId] = useState<string>('all');

    const userEmpProfile = useMemo(() => {
        if (!user) return null;
        return employeesList.find(e => 
            e.user_id === user.id || 
            (e.email && e.email.toLowerCase() === user.email?.toLowerCase())
        );
    }, [user, employeesList]);

    const isTicketAssignedToUser = React.useCallback((t: any, targetUserId?: string, targetEmail?: string, empProfile?: any) => {
        if (!t) return false;
        const uid = targetUserId || '';
        const uEmail = (targetEmail || '').toLowerCase().trim();
        const pId = empProfile?.id || '';
        const pCode = (empProfile?.employee_code || '').toLowerCase().trim();
        const pEmail = (empProfile?.email || '').toLowerCase().trim();

        const tAssignedId = (t.assigned_to_user_id || '').trim();
        const tAssignedEmail = (t.assigned_to_email || t.assigned_to?.email || t.assigned_to_user_email || '').toLowerCase().trim();
        const tAssignedCode = (t.assigned_to_code || t.assigned_to?.employee_code || '').toLowerCase().trim();

        if (uid) {
            if (tAssignedId === uid || t.assigned_to_user_id === uid) return true;
            if (t.manager_user_id === uid || t.employee_snapshot?.manager_user_id === uid) return true;
            if (Array.isArray(t.assigned_history) && t.assigned_history.includes(uid)) return true;
            if (Array.isArray(t.employee_snapshot?.assigned_history) && t.employee_snapshot.assigned_history.includes(uid)) return true;
        }
        if (pId) {
            if (tAssignedId === pId || tAssignedId.includes(pId)) return true;
            if (Array.isArray(t.assigned_history) && t.assigned_history.includes(pId)) return true;
            if (Array.isArray(t.employee_snapshot?.assigned_history) && t.employee_snapshot.assigned_history.includes(pId)) return true;
        }
        if (uEmail && (tAssignedEmail === uEmail || tAssignedId.toLowerCase() === uEmail)) return true;
        if (pEmail && (tAssignedEmail === pEmail || tAssignedId.toLowerCase() === pEmail)) return true;
        if (pCode && (tAssignedCode === pCode || tAssignedId.toLowerCase() === pCode)) return true;

        return false;
    }, []);

    const isDirectlyAssignedToMe = React.useCallback((t: any) => {
        return isTicketAssignedToUser(t, user?.id, user?.email, userEmpProfile);
    }, [user, userEmpProfile, isTicketAssignedToUser]);

    // Checks if the logged-in user is the CURRENT active assignee of this ticket (excludes past escalated levels)
    const isCurrentlyAssignedToMe = React.useCallback((t: any) => {
        if (!t || !user) return false;
        const uid = user.id;
        const uEmail = (user.email || '').toLowerCase().trim();
        const pId = userEmpProfile?.id || '';
        const pCode = (userEmpProfile?.employee_code || '').toLowerCase().trim();
        const pEmail = (userEmpProfile?.email || '').toLowerCase().trim();

        const tAssignedId = (t.assigned_to_user_id || '').trim();
        const tAssignedEmail = (t.assigned_to_email || t.assigned_to?.email || t.assigned_to_user_email || '').toLowerCase().trim();
        const tAssignedCode = (t.assigned_to_code || t.assigned_to?.employee_code || '').toLowerCase().trim();

        if (uid && tAssignedId === uid) return true;
        if (pId && (tAssignedId === pId || tAssignedId.includes(pId))) return true;
        if (uEmail && (tAssignedEmail === uEmail || tAssignedId.toLowerCase() === uEmail)) return true;
        if (pEmail && (tAssignedEmail === pEmail || tAssignedId.toLowerCase() === pEmail)) return true;
        if (pCode && (tAssignedCode === pCode || tAssignedId.toLowerCase() === pCode)) return true;

        return false;
    }, [user, userEmpProfile]);

    const isGrievance = React.useCallback((t: any) => {
        if (!t) return false;
        if (t.ticket_type === 'grievance') return true;
        if (t.ticket_type === 'hr_query' || t.ticket_type === 'confidential' || t.ticket_type === 'confidential_feedback' || t.ticket_type === 'anonymous_feedback' || t.is_confidential) return false;
        const cat = (t.category?.category_name || t.category_name || '').toLowerCase();
        if (cat.includes('query') || cat.includes('question')) return false;
        return true;
    }, []);

    const isHRQuery = React.useCallback((t: any) => {
        if (!t) return false;
        if (t.ticket_type === 'hr_query' || t.ticket_type === 'query') return true;
        const cat = (t.category?.category_name || t.category_name || '').toLowerCase();
        return cat.includes('query') || cat.includes('question');
    }, []);

    const isConfidential = React.useCallback((t: any) => {
        if (!t) return false;
        return t.ticket_type === 'confidential' || t.ticket_type === 'confidential_feedback' || t.ticket_type === 'anonymous_feedback' || Boolean(t.is_confidential) || Boolean(t.is_anonymous);
    }, []);

    const {
        totalCount,
        assignedToYouCount,
        assignedPendingCount,
        openGrievancesCount,
        pendingGrievancesCount,
        hrQueriesCount,
        confidentialCount,
        overdueCount,
        myRaisedCount,
        teamTicketsCount
    } = useMemo(() => {
        const total = tickets.length;
        const assignedToYou = tickets.filter(t => isDirectlyAssignedToMe(t)).length;
        const assignedPending = tickets.filter(t => isCurrentlyAssignedToMe(t) && !['resolved', 'closed'].includes(t.status)).length;

        const grievances = tickets.filter(t => isGrievance(t)).length;
        const pendingGrievances = tickets.filter(t => isGrievance(t) && !['resolved', 'closed'].includes(t.status)).length;
        const queries = tickets.filter(t => isHRQuery(t)).length;
        const confidential = tickets.filter(t => isConfidential(t)).length;
        const overdue = tickets.filter(t => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status)).length;

        const myRaised = tickets.filter(t => 
            t.raised_by_user_id === user?.id || 
            t.raised_by?.email === user?.email ||
            (userEmpProfile && (t.raised_by_user_id === userEmpProfile.id || (userEmpProfile.employee_code && t.employee_snapshot?.code === userEmpProfile.employee_code)))
        ).length;

        const teamTickets = tickets.filter(t => 
            !t.is_anonymous && !t.is_confidential && t.ticket_type !== 'confidential_feedback' && t.ticket_type !== 'confidential' && (
                Array.from(reporteeUserIds).some(rid => {
                    const profileObj = employeesList.find(e => (e.user_id || e.id) === rid || e.employee_code === rid);
                    return isTicketAssignedToUser(t, rid, profileObj?.email, profileObj) ||
                           t.raised_by_user_id === rid ||
                           (profileObj?.user_id && t.raised_by_user_id === profileObj.user_id) ||
                           (profileObj?.email && t.raised_by?.email?.toLowerCase() === profileObj.email.toLowerCase()) ||
                           (profileObj?.employee_code && t.employee_snapshot?.code === profileObj.employee_code);
                }) ||
                reporteeUserIds.has(t.assigned_to_user_id) || 
                reporteeUserIds.has(t.raised_by_user_id)
            )
        ).length;

        return {
            totalCount: total,
            assignedToYouCount: assignedToYou,
            assignedPendingCount: assignedPending,
            openGrievancesCount: grievances,
            pendingGrievancesCount: pendingGrievances,
            hrQueriesCount: queries,
            confidentialCount: confidential,
            overdueCount: overdue,
            myRaisedCount: myRaised,
            teamTicketsCount: teamTickets
        };
    }, [tickets, isDirectlyAssignedToMe, isCurrentlyAssignedToMe, isGrievance, isHRQuery, isConfidential, user, userEmpProfile, reporteeUserIds, employeesList, isTicketAssignedToUser]);

    // Filter tickets based on UI search, scope, type, and status filters
    const filteredTickets = tickets.filter(t => {
        if (scopeFilter === 'my_raised') {
            const isMyRaised = t.raised_by_user_id === user?.id || 
                               t.raised_by?.email === user?.email ||
                               (userEmpProfile && (t.raised_by_user_id === userEmpProfile.id || (userEmpProfile.employee_code && t.employee_snapshot?.code === userEmpProfile.employee_code)));
            if (!isMyRaised) return false;
        }
        if (scopeFilter === 'assigned_to_me' && !isDirectlyAssignedToMe(t)) return false;
        if (scopeFilter === 'department' || scopeFilter === 'my_team_assigned') {
            if (selectedReporteeId !== 'all') {
                const selRep = employeesList.find(e => (e.user_id || e.id) === selectedReporteeId);
                const selName = selRep ? `${selRep.first_name || ''} ${selRep.last_name || ''}`.trim() || selRep.full_name || selRep.name || selRep.email : '';
                const subReps = selRep ? getReporteesForManager({
                    userId: selRep.user_id || selRep.id,
                    id: selRep.id,
                    code: selRep.employee_code,
                    name: selName,
                    email: selRep.email
                }, employeesList) : [];

                const targetUserIds = new Set([selectedReporteeId, ...subReps.map(s => s.user_id || s.id).filter(Boolean)]);
                const isTargetAssigned = Array.from(targetUserIds).some(tu => {
                    const profileObj = employeesList.find(e => (e.user_id || e.id) === tu);
                    return isTicketAssignedToUser(t, tu, profileObj?.email, profileObj);
                });

                if (!isTargetAssigned && !targetUserIds.has(t.assigned_to_user_id)) {
                    return false;
                }
            } else if (selectedDepartmentUserId !== 'all') {
                const uid = selectedDepartmentUserId;
                if (!isTicketAssignedToUser(t, uid, '', null)) return false;
            } else {
                const isReporteeInvolved = Array.from(reporteeUserIds).some(rid => {
                    const profileObj = employeesList.find(e => (e.user_id || e.id) === rid || e.employee_code === rid);
                    return isTicketAssignedToUser(t, rid, profileObj?.email, profileObj) ||
                           t.raised_by_user_id === rid ||
                           (profileObj?.user_id && t.raised_by_user_id === profileObj.user_id) ||
                           (profileObj?.email && t.raised_by?.email?.toLowerCase() === profileObj.email.toLowerCase()) ||
                           (profileObj?.employee_code && t.employee_snapshot?.code === profileObj.employee_code);
                });
                if (!isReporteeInvolved && !reporteeUserIds.has(t.assigned_to_user_id) && !reporteeUserIds.has(t.raised_by_user_id)) return false;
            }
        }
        if (scopeFilter === 'all' && selectedAssigneeFilter !== 'all') {
            const assigneeEmp = employeesList.find(e => (e.user_id || e.id) === selectedAssigneeFilter);
            if (!isTicketAssignedToUser(t, selectedAssigneeFilter, assigneeEmp?.email, assigneeEmp)) return false;
        }

        // Ticket Type Filter from KPI Cards / Dropdown
        if (ticketTypeFilter === 'grievance') {
            if (!isGrievance(t)) return false;
        } else if (ticketTypeFilter === 'hr_query') {
            if (!isHRQuery(t)) return false;
        } else if (ticketTypeFilter === 'confidential') {
            if (!isConfidential(t)) return false;
        } else if (ticketTypeFilter !== 'all' && t.ticket_type !== ticketTypeFilter) {
            return false;
        }

        // Status Filter from KPI Cards / Dropdown / Scope Pills
        if (statusFilter === 'overdue') {
            const isOverdue = Boolean(t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status));
            if (!isOverdue) return false;
        } else if (statusFilter === 'pending') {
            if (['resolved', 'closed'].includes(t.status)) return false;
        } else if (statusFilter !== 'all' && t.status !== statusFilter) {
            return false;
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const subjectMatch = (t.subject || '').toLowerCase().includes(q);
            const numMatch = (t.ticket_number || '').toLowerCase().includes(q);
            const nameMatch = (t.employee_snapshot?.name || '').toLowerCase().includes(q);
            if (!subjectMatch && !numMatch && !nameMatch) return false;
        }
        return true;
    });

    const filteredPropertiesList = properties.filter(p =>
        (p.name || '').toLowerCase().includes(propertySearchQuery.toLowerCase())
    );

    const getTicketAssigneeName = React.useCallback((t: any) => {
        if (!t) return '';
        if (t.assigned_to?.full_name) return t.assigned_to.full_name;
        if (t.assigned_to?.name) return t.assigned_to.name;
        
        const uid = t.assigned_to_user_id || t.assigned_to_id;
        if (uid) {
            const emp = employeesList.find(e => (e.user_id || e.id) === uid || e.employee_code === uid);
            if (emp) {
                const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name;
                if (name) return name;
            }
        }
        
        if (t.assigned_to_email) {
            const empByEmail = employeesList.find(e => e.email?.toLowerCase() === t.assigned_to_email?.toLowerCase());
            if (empByEmail) {
                const name = `${empByEmail.first_name || ''} ${empByEmail.last_name || ''}`.trim() || empByEmail.full_name || empByEmail.name;
                if (name) return name;
            }
            return t.assigned_to_email;
        }

        if (t.assigned_to_name) return t.assigned_to_name;
        
        return 'Manager / HR';
    }, [employeesList]);

    const getInitials = (name: string) => {
        if (!name) return 'U';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.slice(0, 2).toUpperCase();
    };

    const openSubmitterProfile = (t: any) => {
        if (t.is_anonymous) {
            setProfileModalData({
                isOpen: true,
                type: 'submitter',
                ticket: t,
                employee: {
                    is_anonymous: true,
                    name: 'Anonymous Employee',
                    employee_code: 'Hidden',
                    department: 'Confidential',
                    location: 'Hidden',
                    designation: 'Masked Identity',
                    email: 'anonymous@hidden.local',
                    phone: 'Hidden',
                    manager_name: 'Hidden'
                }
            });
            return;
        }
        const emp = employeesList.find(e => 
            (e.user_id && e.user_id === t.raised_by_user_id) || 
            (e.id && e.id === t.raised_by_user_id) || 
            (e.email && e.email.toLowerCase() === t.raised_by?.email?.toLowerCase()) ||
            (e.employee_code && e.employee_code === t.employee_snapshot?.code)
        );
        const sName = t.employee_snapshot?.name || (emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name : t.raised_by?.full_name || 'Employee');
        setProfileModalData({
            isOpen: true,
            type: 'submitter',
            ticket: t,
            employee: {
                is_anonymous: false,
                name: sName,
                employee_code: emp?.employee_code || t.employee_snapshot?.code || 'N/A',
                department: emp?.department || t.employee_snapshot?.department || 'Operations',
                location: emp?.property_name || emp?.location || t.employee_snapshot?.location || 'Site',
                designation: emp?.designation || t.employee_snapshot?.designation || 'Staff',
                email: t.raised_by?.email || emp?.email || 'N/A',
                phone: t.raised_by?.phone || emp?.phone || 'N/A',
                manager_name: emp?.reporting_manager_name || t.employee_snapshot?.manager_name || 'N/A',
                photo_url: emp?.user_photo_url || emp?.photo_url || emp?.avatar_url || t.raised_by?.raw_user_meta_data?.user_photo_url || t.raised_by?.raw_user_meta_data?.avatar_url || null
            }
        });
    };

    const openHandlerProfile = (t: any) => {
        const handlerUserId = t.assigned_to_user_id || t.assigned_to_id;
        const emp = employeesList.find(e => 
            (handlerUserId && (e.user_id === handlerUserId || e.id === handlerUserId)) ||
            (t.assigned_to?.email && e.email?.toLowerCase() === t.assigned_to.email.toLowerCase())
        );
        const handlerName = t.current_level_owner || t.assigned_to_details?.full_name || t.assigned_to?.full_name || (emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name : 'Manager / HR');

        setProfileModalData({
            isOpen: true,
            type: 'handler',
            ticket: t,
            employee: {
                name: handlerName,
                employee_code: emp?.employee_code || t.assigned_to_details?.code || 'N/A',
                level: t.current_level,
                level_status: t.status === 'escalated' ? 'Escalated Active' : 'Active Owner',
                department: t.assigned_to_details?.department || emp?.department || 'HR & Operations',
                location: t.assigned_to_details?.location || emp?.property_name || emp?.location || 'Head Office',
                app_role: t.assigned_to_details?.app_role || emp?.role || 'hr_head',
                designation: t.assigned_to_details?.employee_role || emp?.designation || 'Designated Authority',
                email: t.assigned_to_details?.email || t.assigned_to?.email || emp?.email || 'N/A',
                phone: t.assigned_to_details?.phone || t.assigned_to?.phone || emp?.phone || 'N/A',
                photo_url: t.assigned_to_details?.photo_url || emp?.user_photo_url || emp?.photo_url || emp?.avatar_url || t.assigned_to?.raw_user_meta_data?.user_photo_url || null
            }
        });
    };

    // Memoized Dropdown Options for Searchable Interactive Select Dropdowns
    const reporteeDropdownOptions = useMemo(() => {
        const teamTickets = tickets.filter(t => 
            Array.from(reporteeUserIds).some(rid => { 
                const p = employeesList.find(e => (e.user_id || e.id) === rid); 
                return isTicketAssignedToUser(t, rid, p?.email, p); 
            })
        );
        const teamPendingTickets = teamTickets.filter(t => !['resolved', 'closed'].includes(t.status));
        const teamPendingAssignees = Array.from(
            new Set(teamPendingTickets.map(t => getTicketAssigneeName(t)).filter(Boolean))
        );

        const allOpt = {
            id: 'all',
            label: `All Team & Sub-Tree`,
            subLabel: `${myDepartmentReportees.length} Direct & Indirect Reportees`,
            pendingCount: teamPendingTickets.length,
            pendingAssignees: teamPendingAssignees,
            totalCount: teamTickets.length
        };

        const repOpts = myDepartmentReportees.map(rep => {
            const rUid = rep.user_id || rep.id;
            const rName = `${rep.first_name || ''} ${rep.last_name || ''}`.trim() || rep.full_name || rep.name || rep.email;
            const subReps = getReporteesForManager({
                userId: rep.user_id || rep.id,
                id: rep.id,
                code: rep.employee_code,
                name: rName,
                email: rep.email
            }, employeesList);

            const subUserIds = new Set([rUid, ...subReps.map(s => s.user_id || s.id).filter(Boolean)]);
            const repBranchTickets = tickets.filter(t => 
                Array.from(subUserIds).some(suid => {
                    const profileObj = employeesList.find(e => (e.user_id || e.id) === suid);
                    return isTicketAssignedToUser(t, suid, profileObj?.email, profileObj);
                })
            );
            const repPendingTickets = repBranchTickets.filter(t => !['resolved', 'closed'].includes(t.status));
            const repPendingAssignees = Array.from(
                new Set(repPendingTickets.map(t => getTicketAssigneeName(t)).filter(Boolean))
            );

            return {
                id: rUid,
                label: rName,
                subLabel: `${rep.designation || 'Staff'} • ${subReps.length > 0 ? `${subReps.length} Sub-reportees` : 'Direct Reportee'}`,
                code: rep.employee_code,
                pendingCount: repPendingTickets.length,
                pendingAssignees: repPendingAssignees,
                totalCount: repBranchTickets.length
            };
        });

        return [allOpt, ...repOpts];
    }, [myDepartmentReportees, tickets, isDirectlyAssignedToMe, user, reporteeUserIds, employeesList, isTicketAssignedToUser, getTicketAssigneeName]);

    const assigneeDropdownOptions = useMemo(() => {
        const allPendingTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
        const allPendingAssignees = Array.from(
            new Set(allPendingTickets.map(t => getTicketAssigneeName(t)).filter(Boolean))
        );

        const allOpt = {
            id: 'all',
            label: 'All Assignees',
            subLabel: 'Entire organization tickets',
            pendingCount: allPendingTickets.length,
            pendingAssignees: allPendingAssignees,
            totalCount: tickets.length
        };

        // Dynamically collect all potential assignees from tickets as well as employeesList
        const assigneeMap = new Map<string, { id: string; name: string; email?: string; code?: string; role?: string; department?: string }>();

        // 1. Add employees (for Org Super Admin & HR: whole org; for scoped users: self & team reportees)
        const sourceEmps = canViewOrgWide ? employeesList : [userEmpProfile, ...myDepartmentReportees].filter(Boolean);
        sourceEmps.forEach((emp: any) => {
            const uid = emp.user_id || emp.id;
            if (!uid) return;
            const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name || emp.email;
            assigneeMap.set(uid, {
                id: uid,
                name,
                email: emp.email,
                code: emp.employee_code,
                role: emp.designation || 'Staff',
                department: emp.department || 'Operations'
            });
        });

        // 2. Dynamically add any assignee referenced in tickets
        tickets.forEach(t => {
            const uid = t.assigned_to_user_id || t.assigned_to_id;
            if (uid && !assigneeMap.has(uid)) {
                const name = getTicketAssigneeName(t);
                assigneeMap.set(uid, {
                    id: uid,
                    name,
                    email: t.assigned_to?.email,
                    role: t.assigned_to_details?.app_role || t.assigned_to_details?.employee_role || 'Assignee',
                    department: t.assigned_to_details?.department || 'Operations'
                });
            }
        });

        const empOpts = Array.from(assigneeMap.values()).map(emp => {
            const uid = emp.id;
            const empTickets = tickets.filter(t => isTicketAssignedToUser(t, uid, emp.email, emp));
            const empPendingTickets = empTickets.filter(t => !['resolved', 'closed'].includes(t.status));
            const empPendingAssignees = Array.from(
                new Set(empPendingTickets.map(t => getTicketAssigneeName(t)).filter(Boolean))
            );

            return {
                id: uid,
                label: emp.name,
                subLabel: `${emp.role || 'Staff'} • ${emp.department || 'Operations'}`,
                code: emp.code,
                pendingCount: empPendingTickets.length,
                pendingAssignees: empPendingAssignees,
                totalCount: empTickets.length
            };
        });

        // Sort dynamically: Assignees with pending actions first (descending), then with any tickets, then rest alphabetically
        empOpts.sort((a, b) => {
            if (b.pendingCount !== a.pendingCount) {
                return b.pendingCount - a.pendingCount;
            }
            if (b.totalCount !== a.totalCount) {
                return b.totalCount - a.totalCount;
            }
            return a.label.localeCompare(b.label);
        });

        return [allOpt, ...empOpts];
    }, [employeesList, tickets, isTicketAssignedToUser, getTicketAssigneeName]);

    // Helper to toggle expand/collapse state in Tree View
    const toggleTreeNodeExpand = (nodeId: string) => {
        setExpandedTreeNodes(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
    };

    /**
     * Recursive Tree Node Renderer for Organization Hierarchy
     */
    const renderTreeNode = (emp: any, depth = 0, ancestors = new Set<string>()) => {
        const empUid = emp.user_id || emp.id;
        const empCode = (emp.employee_code || '').toLowerCase().trim();
        const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name || emp.email;
        const empNameLower = empName.toLowerCase().trim();

        const nodeKey = empUid || empCode || empNameLower;
        if (!nodeKey || ancestors.has(nodeKey)) {
            return null; // Prevent infinite cycle
        }
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(nodeKey);
        
        // Find direct reportees for this node
        const directReps = employeesList.filter(e => {
            const eUid = e.user_id || e.id;
            if (empUid && eUid === empUid) return false;

            const rId = e.reporting_manager_id || '';
            const rCode = (e.reporting_manager_code || '').toLowerCase().trim();
            const rName = (e.reporting_manager_name || '').toLowerCase().trim();
            
            const matchId = Boolean(empUid && rId && (rId === empUid || (rCode && rCode === empUid)));
            const matchCode = Boolean(empCode && ((rCode && rCode === empCode) || (rId && rId === empCode)));
            const matchName = Boolean(empNameLower && empNameLower.length > 1 && (
                (rName && rName.length > 1 && (rName === empNameLower || rName.includes(empNameLower) || empNameLower.includes(rName))) ||
                (rCode && rCode.length > 1 && (rCode === empNameLower || (rCode.length > 2 && (rCode.includes(empNameLower) || empNameLower.includes(rCode)))))
            ));
            
            return Boolean(matchId || matchCode || matchName);
        });

        const hasReportees = directReps.length > 0;
        const isExpanded = expandedTreeNodes[empUid] ?? (depth < 2);

        // Tickets assigned to this employee node
        const empTickets = tickets.filter(t => t.assigned_to_user_id === empUid);
        const empPendingCount = empTickets.filter(t => !['resolved', 'closed'].includes(t.status)).length;
        const empResolvedCount = empTickets.filter(t => ['resolved', 'closed'].includes(t.status)).length;

        // Subtree tickets count
        const allSubtreeReportees = getReporteesForManager({
            userId: emp.user_id || emp.id,
            id: emp.id,
            code: emp.employee_code,
            name: empName,
            email: emp.email
        }, employeesList);

        const subtreeUserIds = new Set([empUid, ...allSubtreeReportees.map(r => r.user_id || r.id).filter(Boolean)]);
        const branchTickets = tickets.filter(t => subtreeUserIds.has(t.assigned_to_user_id));
        const branchPendingCount = branchTickets.filter(t => !['resolved', 'closed'].includes(t.status)).length;

        const isSelected = selectedTreeNodeUser?.id === emp.id || (selectedTreeNodeUser?.user_id && selectedTreeNodeUser.user_id === empUid);

        return (
            <div key={emp.id} className="space-y-2">
                <div 
                    onClick={() => setSelectedTreeNodeUser(emp)}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${
                        isSelected 
                            ? 'bg-[#587e85]/10 border-[#587e85] shadow-sm ring-2 ring-[#587e85]/30' 
                            : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 border-slate-200 dark:border-slate-800'
                    }`}
                    style={{ marginLeft: `${depth * 20}px` }}
                >
                    <div className="flex items-center gap-3">
                        {hasReportees ? (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleTreeNodeExpand(empUid); }}
                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-500 transition-colors"
                            >
                                {isExpanded ? <ChevronDown className="w-4 h-4 text-[#587e85]" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                            </button>
                        ) : (
                            <div className="w-6 h-6 flex items-center justify-center">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                            </div>
                        )}

                        <div className="w-9 h-9 rounded-full bg-[#587e85]/10 text-[#587e85] font-black flex items-center justify-center text-xs shrink-0 border border-[#587e85]/20">
                            {empName.slice(0, 2).toUpperCase()}
                        </div>

                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="text-xs font-black text-slate-900 dark:text-white">
                                    {empName}
                                </h4>
                                {emp.employee_code && (
                                    <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                        {emp.employee_code}
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                                {emp.designation || 'Staff'} • {emp.department || 'General'}
                                {hasReportees && (
                                    <span className="ml-1.5 text-[#587e85] font-bold">
                                        ({directReps.length} Direct Reportees)
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2 sm:mt-0 pl-9 sm:pl-0">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold flex items-center gap-1.5 ${
                            empPendingCount > 0 
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/60' 
                                : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300/60'
                        }`}>
                            <Clock className="w-3 h-3" />
                            {empPendingCount} Pending Action
                        </span>
                        
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {empTickets.length} Assigned
                        </span>

                        <span className="px-2 py-1 bg-[#587e85] text-white rounded-xl text-[10.5px] font-extrabold">
                            {isSelected ? 'Inspecting' : 'View Workload'}
                        </span>
                    </div>
                </div>

                {hasReportees && isExpanded && (
                    <div className="space-y-2">
                        {directReps.map(rep => renderTreeNode(rep, depth + 1, nextAncestors))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="w-full max-w-full space-y-5 pb-12 overflow-x-hidden">
            {/* Header Action Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-1">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                        <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                            {activeTab === 'notes' ? 'HR Notes & Remarks Ledger' : activeTab === 'tree' ? 'Organization Reporting Tree & Workload Inspector' : isHrAdmin ? 'HR Helpdesk & Grievances' : isManager ? 'Team Grievance Requests' : 'My Requests & Grievances'}
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        type="button"
                        onClick={() => setIsCreateOpen(true)}
                        className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold shadow-xs shadow-[#587e85]/20 transition-all active:scale-95 min-h-[40px]"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Raise HR Request / Grievance</span>
                    </button>
                </div>
            </div>

            {/* HR Console Navigation Tabs (Visible for Org Super Admin and HR Team) */}
            {canViewOrgWide && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-slate-200 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={() => handleNavigationTabSwitch('tickets')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                            activeTab === 'tickets'
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Ticket className="w-3.5 h-3.5" />
                        <span>Requests & Grievances</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleNavigationTabSwitch('notes')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                            activeTab === 'notes'
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Notes Tracker</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleNavigationTabSwitch('tree')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                            activeTab === 'tree'
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <GitFork className="w-3.5 h-3.5" />
                        <span>Org Reporting Tree</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleNavigationTabSwitch('directory')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                            activeTab === 'directory'
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Users className="w-3.5 h-3.5" />
                        <span>Employee Directory</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleNavigationTabSwitch('reconciliation')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                            activeTab === 'reconciliation'
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Identity Reconciliation</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleNavigationTabSwitch('config')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                            activeTab === 'config'
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Admin Config</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleNavigationTabSwitch('analytics')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                            activeTab === 'analytics'
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Analytics</span>
                    </button>
                </div>
            )}

            {/* TAB 1: ORGANIZATION REPORTING TREE & WORKLOAD INSPECTOR */}
            {activeTab === 'tree' && (
                <div className="space-y-5">
                    {/* View Mode Toggle Bar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-[#587e85]/10 text-[#587e85] rounded-xl">
                                <GitFork className="w-4 h-4" />
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                    Organization Reporting Tree
                                </h3>
                                <p className="text-[11px] font-medium text-slate-500">
                                    Visual top-down org chart & reportee workload inspector.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                            <button
                                type="button"
                                onClick={() => setTreeViewMode('chart')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                    treeViewMode === 'chart' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <GitFork className="w-3.5 h-3.5" />
                                <span>Visual Org Chart</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setTreeViewMode('list')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                    treeViewMode === 'list' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <Users className="w-3.5 h-3.5" />
                                <span>Hierarchy List & Workload</span>
                            </button>
                        </div>
                    </div>

                    {treeViewMode === 'chart' ? (
                        <HROrgChartTree
                            employees={employeesList}
                            tickets={tickets}
                            onSelectEmployee={(emp) => setSelectedTreeNodeUser(emp)}
                            onSelectTicket={(id) => setSelectedTicketId(id)}
                        />
                    ) : null}

                    {treeViewMode === 'list' ? (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                            {/* Tree Hierarchy Section (Left Column) */}
                            <div className="lg:col-span-7 bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                                    <div>
                                        <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                                            <GitFork className="w-4 h-4 text-[#587e85]" />
                                            Organization Reporting Hierarchy
                                        </h2>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Select any manager or employee node in the tree to inspect their assigned tickets and sub-department workload.
                                        </p>
                                    </div>

                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                                        <input
                                            type="text"
                                            placeholder="Search in tree..."
                                            value={treeSearchQuery}
                                            onChange={(e) => setTreeSearchQuery(e.target.value)}
                                            className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85] w-full sm:w-44"
                                        />
                                    </div>
                                </div>

                                {/* Tree Nodes List */}
                                <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
                                    {(() => {
                                        const filteredEmps = employeesList.filter(e => {
                                            if (!treeSearchQuery.trim()) return true;
                                            const q = treeSearchQuery.toLowerCase();
                                            const name = `${e.first_name || ''} ${e.last_name || ''} ${e.name || ''}`.toLowerCase();
                                            const code = (e.employee_code || '').toLowerCase();
                                            const dept = (e.department || '').toLowerCase();
                                            return name.includes(q) || code.includes(q) || dept.includes(q);
                                        });

                                        const rootManagers = filteredEmps.filter(e => {
                                            if (treeSearchQuery.trim()) return true;
                                            const isDirector = Boolean(
                                                e.is_director_authority ||
                                                e.is_director ||
                                                (e.designation || '').toLowerCase().includes('director') ||
                                                (e.designation || '').toLowerCase().includes('md') ||
                                                (e.designation || '').toLowerCase().includes('ceo') ||
                                                (e.designation || '').toLowerCase().includes('president')
                                            );
                                            const rCode = (e.reporting_manager_code || '').trim();
                                            const rId = (e.reporting_manager_id || '').trim();
                                            const rName = (e.reporting_manager_name || '').trim();
                                            return isDirector || (!rCode && !rId && !rName);
                                        });

                                        const displayRoots = rootManagers.length > 0 ? rootManagers : filteredEmps.slice(0, 15);

                                        if (displayRoots.length === 0) {
                                            return (
                                                <div className="py-12 text-center text-xs text-slate-400 font-medium">
                                                    No employee profiles matching your tree query.
                                                </div>
                                            );
                                        }

                                        return displayRoots.map(rootEmp => renderTreeNode(rootEmp, 0));
                                    })()}
                                </div>
                            </div>

                            {/* Selected Employee Workload & Tickets Inspector (Right Column) */}
                            <div className="lg:col-span-5 bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                                {selectedTreeNodeUser ? (
                                    (() => {
                                        const selUid = selectedTreeNodeUser.user_id || selectedTreeNodeUser.id;
                                        const selName = `${selectedTreeNodeUser.first_name || ''} ${selectedTreeNodeUser.last_name || ''}`.trim() || selectedTreeNodeUser.full_name || selectedTreeNodeUser.name || selectedTreeNodeUser.email;
                                        const assignedTickets = tickets.filter(t => t.assigned_to_user_id === selUid);
                                        const pendingTickets = assignedTickets.filter(t => !['resolved', 'closed'].includes(t.status));
                                        const resolvedTickets = assignedTickets.filter(t => ['resolved', 'closed'].includes(t.status));

                                        return (
                                            <div className="space-y-4">
                                                <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-50 to-indigo-50/30 dark:from-slate-800 dark:to-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-12 h-12 rounded-2xl bg-[#587e85] text-white font-black flex items-center justify-center text-base shadow-sm">
                                                            {selName.slice(0, 2).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-black text-slate-900 dark:text-white">
                                                                {selName}
                                                            </h3>
                                                            <p className="text-xs font-semibold text-slate-500 mt-0.5">
                                                                {selectedTreeNodeUser.designation || 'Employee'} • {selectedTreeNodeUser.department || 'Operations'}
                                                            </p>
                                                            {selectedTreeNodeUser.employee_code && (
                                                                <p className="text-[11px] font-mono font-extrabold text-[#587e85] mt-1">
                                                                    Code: {selectedTreeNodeUser.employee_code}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <button
                                                        onClick={() => setSelectedTreeNodeUser(null)}
                                                        className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                                                    >
                                                        Clear
                                                    </button>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2">
                                                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                                                        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Assigned</p>
                                                        <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{assignedTickets.length}</p>
                                                    </div>
                                                    <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                                                        <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">Pending</p>
                                                        <p className="text-lg font-black text-amber-900 dark:text-amber-200 mt-0.5">{pendingTickets.length}</p>
                                                    </div>
                                                    <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                                                        <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Resolved</p>
                                                        <p className="text-lg font-black text-emerald-900 dark:text-emerald-200 mt-0.5">{resolvedTickets.length}</p>
                                                    </div>
                                                </div>

                                                <div>
                                                    <h4 className="text-xs font-black text-slate-900 dark:text-white mb-2 flex items-center justify-between">
                                                        <span>Assigned Tickets ({assignedTickets.length})</span>
                                                        <span className="text-[11px] font-normal text-slate-500">Click to view detail</span>
                                                    </h4>

                                                    {assignedTickets.length === 0 ? (
                                                        <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 font-medium">
                                                            No tickets directly assigned to {selName}.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                                                            {assignedTickets.map(t => (
                                                                <div 
                                                                    key={t.id}
                                                                    onClick={() => setSelectedTicketId(t.id)}
                                                                    className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-[#587e85] transition-all cursor-pointer shadow-2xs space-y-1.5"
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-xs font-black text-[#587e85]">
                                                                            #{t.ticket_number}
                                                                        </span>
                                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                                            t.status === 'closed'
                                                                                ? 'bg-emerald-100 text-emerald-800'
                                                                                : t.status === 'pending_acknowledgement' || t.status === 'resolved'
                                                                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                                                                : t.status === 'in_progress'
                                                                                ? 'bg-blue-100 text-blue-800'
                                                                                : 'bg-slate-100 text-slate-800'
                                                                        }`}>
                                                                            {t.status === 'pending_acknowledgement' ? 'PENDING ACKNOWLEDGEMENT' : t.status.replace(/_/g, ' ')}
                                                                        </span>
                                                                    </div>

                                                                    <p className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1">
                                                                        {t.subject}
                                                                    </p>

                                                                    <div className="flex items-center justify-between text-[10.5px] font-medium text-slate-500">
                                                                        <span>Level {t.current_level}</span>
                                                                        <span className="text-[#587e85] font-bold flex items-center gap-1">
                                                                            Inspect Details <ArrowUpRight className="w-3 h-3" />
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <div className="py-24 text-center space-y-3">
                                        <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center border border-indigo-100 dark:border-indigo-900">
                                            <Users className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                            No Employee Selected
                                        </h3>
                                        <p className="text-xs text-slate-400 max-w-xs mx-auto font-medium">
                                            Click on any employee node in the left reporting hierarchy tree to inspect their assigned tickets and workload metrics.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : selectedTreeNodeUser ? (
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                            {(() => {
                                const selUid = selectedTreeNodeUser.user_id || selectedTreeNodeUser.id;
                                const selName = `${selectedTreeNodeUser.first_name || ''} ${selectedTreeNodeUser.last_name || ''}`.trim() || selectedTreeNodeUser.full_name || selectedTreeNodeUser.name || selectedTreeNodeUser.email;
                                const assignedTickets = tickets.filter(t => t.assigned_to_user_id === selUid);
                                const pendingTickets = assignedTickets.filter(t => !['resolved', 'closed'].includes(t.status));
                                const resolvedTickets = assignedTickets.filter(t => ['resolved', 'closed'].includes(t.status));

                                return (
                                    <div className="space-y-4">
                                        <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-50 to-indigo-50/30 dark:from-slate-800 dark:to-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-2xl bg-[#587e85] text-white font-black flex items-center justify-center text-base shadow-sm">
                                                    {selName.slice(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                                                        Inspecting Workload for {selName}
                                                    </h3>
                                                    <p className="text-xs font-semibold text-slate-500 mt-0.5">
                                                        {selectedTreeNodeUser.designation || 'Employee'} • {selectedTreeNodeUser.department || 'Operations'}
                                                    </p>
                                                    {selectedTreeNodeUser.employee_code && (
                                                        <p className="text-[11px] font-mono font-extrabold text-[#587e85] mt-1">
                                                            Code: {selectedTreeNodeUser.employee_code}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => setSelectedTreeNodeUser(null)}
                                                className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                                            >
                                                Close Inspector
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Assigned</p>
                                                <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{assignedTickets.length}</p>
                                            </div>
                                            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">Pending</p>
                                                <p className="text-lg font-black text-amber-900 dark:text-amber-200 mt-0.5">{pendingTickets.length}</p>
                                            </div>
                                            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Resolved</p>
                                                <p className="text-lg font-black text-emerald-900 dark:text-emerald-200 mt-0.5">{resolvedTickets.length}</p>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white mb-2 flex items-center justify-between">
                                                <span>Assigned Tickets ({assignedTickets.length})</span>
                                                <span className="text-[11px] font-normal text-slate-500">Click to view detail</span>
                                            </h4>

                                            {assignedTickets.length === 0 ? (
                                                <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 font-medium">
                                                    No tickets directly assigned to {selName}.
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {assignedTickets.map(t => (
                                                        <div 
                                                            key={t.id}
                                                            onClick={() => setSelectedTicketId(t.id)}
                                                            className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-[#587e85] transition-all cursor-pointer shadow-2xs space-y-1.5"
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs font-black text-[#587e85]">
                                                                    #{t.ticket_number}
                                                                </span>
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                                    t.status === 'closed'
                                                                        ? 'bg-emerald-100 text-emerald-800'
                                                                        : t.status === 'pending_acknowledgement' || t.status === 'resolved'
                                                                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                                                        : t.status === 'in_progress'
                                                                        ? 'bg-blue-100 text-blue-800'
                                                                        : 'bg-slate-100 text-slate-800'
                                                                }`}>
                                                                    {t.status === 'pending_acknowledgement' ? 'PENDING ACKNOWLEDGEMENT' : t.status.replace(/_/g, ' ')}
                                                                </span>
                                                            </div>

                                                            <p className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1">
                                                                {t.subject}
                                                            </p>

                                                            <div className="flex items-center justify-between text-[10.5px] font-medium text-slate-500">
                                                                <span>Level {t.current_level}</span>
                                                                <span className="text-[#587e85] font-bold flex items-center gap-1">
                                                                    Inspect Details <ArrowUpRight className="w-3 h-3" />
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    ) : null}
                </div>
            )}

            {/* TAB 2: HR ADMIN, OPS SUPER ADMIN & PROPERTY ADMIN KPI STAT CARDS */}
            {activeTab === 'tickets' && (canViewOrgWide || isManager || isScopedRole) && (() => {
                const isStrictOrgSuperAdmin = ['org_super_admin', 'master_admin', 'super_admin'].includes(userRole);
                const showHrQueries = isStrictOrgSuperAdmin || isHrRole || hrQueriesCount > 0;
                const showConfidential = isStrictOrgSuperAdmin || confidentialCount > 0;
                const totalKpiCards = 4 + (showHrQueries ? 1 : 0) + (showConfidential ? 1 : 0);
                const gridColsClass = totalKpiCards === 6 ? 'lg:grid-cols-6' : totalKpiCards === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4';

                return (
                    <div className={`grid grid-cols-2 sm:grid-cols-3 ${gridColsClass} gap-3 sm:gap-4`}>
                        <div
                            onClick={() => { setActiveTab('tickets'); setScopeFilter('assigned_to_me'); setTicketTypeFilter('all'); setStatusFilter('all'); }}
                            className={`p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all cursor-pointer group shadow-2xs hover:shadow-md ${
                                scopeFilter === 'assigned_to_me'
                                    ? 'border-l-4 border-l-amber-500 border-slate-200 dark:border-slate-800 bg-amber-50/20 dark:bg-amber-950/10'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-amber-400'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Assigned To You</span>
                                <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/60 flex items-center justify-center shrink-0">
                                    <ShieldCheck className="w-4 h-4" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-slate-900 dark:text-white mt-2 tracking-tight">{assignedToYouCount}</p>
                            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                                {assignedPendingCount > 0 ? `${assignedPendingCount} pending action` : '0 pending action'}
                            </p>
                        </div>

                        <div
                            onClick={() => { setActiveTab('tickets'); setScopeFilter('all'); setTicketTypeFilter('all'); setStatusFilter('all'); }}
                            className={`p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all cursor-pointer group shadow-2xs hover:shadow-md ${
                                (scopeFilter === 'all' || (!canViewOrgWide && scopeFilter === 'assigned_to_me')) && ticketTypeFilter === 'all' && statusFilter === 'all'
                                    ? 'border-l-4 border-l-[#587e85] border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-[#587e85]'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Requests</span>
                                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-900/60 flex items-center justify-center shrink-0">
                                    <Ticket className="w-4 h-4" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-slate-900 dark:text-white mt-2 tracking-tight">{totalCount}</p>
                            <p className="text-[11px] font-medium text-slate-400 mt-0.5">{canViewOrgWide ? 'Across organization' : 'Team & Assigned Workload'}</p>
                        </div>

                        <div
                            onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('grievance'); setStatusFilter('all'); }}
                            className={`p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all cursor-pointer group shadow-2xs hover:shadow-md ${
                                ticketTypeFilter === 'grievance'
                                    ? 'border-l-4 border-l-amber-500 border-slate-200 dark:border-slate-800 bg-amber-50/20 dark:bg-amber-950/10'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-amber-400'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Grievances</span>
                                <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/60 flex items-center justify-center shrink-0">
                                    <ShieldCheck className="w-4 h-4" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-slate-900 dark:text-white mt-2 tracking-tight">{openGrievancesCount}</p>
                            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                                {pendingGrievancesCount > 0 ? `${pendingGrievancesCount} pending` : 'All resolved'}
                            </p>
                        </div>

                        {showHrQueries && (
                            <div
                                onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('hr_query'); setStatusFilter('all'); }}
                                className={`p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all cursor-pointer group shadow-2xs hover:shadow-md ${
                                    ticketTypeFilter === 'hr_query'
                                        ? 'border-l-4 border-l-blue-500 border-slate-200 dark:border-slate-800 bg-blue-50/20 dark:bg-blue-950/10'
                                        : 'border-slate-200 dark:border-slate-800 hover:border-blue-400'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">HR Queries</span>
                                    <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/60 flex items-center justify-center shrink-0">
                                        <HelpCircle className="w-4 h-4" />
                                    </div>
                                </div>
                                <p className="text-2xl font-black text-slate-900 dark:text-white mt-2 tracking-tight">{hrQueriesCount}</p>
                                <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400 mt-0.5">Direct HR Support</p>
                            </div>
                        )}

                        {showConfidential && (
                            <div
                                onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('confidential'); setStatusFilter('all'); }}
                                className={`p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all cursor-pointer group shadow-2xs hover:shadow-md ${
                                    ticketTypeFilter === 'confidential'
                                        ? 'border-l-4 border-l-purple-500 border-slate-200 dark:border-slate-800 bg-purple-50/20 dark:bg-purple-950/10'
                                        : 'border-slate-200 dark:border-slate-800 hover:border-purple-400'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        {isStrictOrgSuperAdmin ? 'Confidential & Anon' : 'Confidential'}
                                    </span>
                                    <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-200/60 dark:border-purple-900/60 flex items-center justify-center shrink-0">
                                        <Lock className="w-4 h-4" />
                                    </div>
                                </div>
                                <p className="text-2xl font-black text-slate-900 dark:text-white mt-2 tracking-tight">{confidentialCount}</p>
                                <p className="text-[11px] font-medium text-purple-600 dark:text-purple-400 mt-0.5">
                                    {isStrictOrgSuperAdmin ? 'Director / Anonymous' : 'Assigned to You'}
                                </p>
                            </div>
                        )}

                        <div
                            onClick={() => { setActiveTab('tickets'); setStatusFilter('overdue'); }}
                            className={`p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all cursor-pointer group shadow-2xs hover:shadow-md ${
                                statusFilter === 'overdue'
                                    ? 'border-l-4 border-l-rose-500 border-slate-200 dark:border-slate-800 bg-rose-50/20 dark:bg-rose-950/10'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-rose-400'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Overdue TAT</span>
                                <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/60 flex items-center justify-center shrink-0">
                                    <AlertTriangle className="w-4 h-4" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-2 tracking-tight">{overdueCount}</p>
                            <p className="text-[11px] font-medium text-rose-500 mt-0.5">Requires Escalation</p>
                        </div>
                    </div>
                );
            })()}

            {/* MAIN TICKETS TAB */}
            {activeTab === 'tickets' && (
                <div className="space-y-4">
                    {/* Non-HR Scope Filter Pills & Assignee Inspector Dropdown */}
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl overflow-x-auto no-scrollbar whitespace-nowrap">
                            <button
                                type="button"
                                onClick={() => { setScopeFilter('all'); setSelectedAssigneeFilter('all'); setTicketTypeFilter('all'); setStatusFilter('all'); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                                    scopeFilter === 'all' && ticketTypeFilter === 'all' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <Ticket className="w-3.5 h-3.5" />
                                <span>All ({tickets.length})</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setScopeFilter('my_team_assigned')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                                    scopeFilter === 'my_team_assigned' || scopeFilter === 'department' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <Users className="w-3.5 h-3.5" />
                                <span>Team & Reportees ({teamTicketsCount})</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => { setScopeFilter('assigned_to_me'); setStatusFilter('all'); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                                    scopeFilter === 'assigned_to_me' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>Assigned to Me & Involvements ({tickets.filter(t => isDirectlyAssignedToMe(t)).length})</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => { setScopeFilter('my_raised'); setStatusFilter('all'); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                                    scopeFilter === 'my_raised' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <User className="w-3.5 h-3.5" />
                                <span>My Raised ({myRaisedCount})</span>
                            </button>
                        </div>

                        {/* Dropdowns Container (Right-aligned) */}
                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                            {/* Reportee & Sub-Tree Filter Dropdown */}
                            {(scopeFilter === 'my_team_assigned' || scopeFilter === 'department') && (
                                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
                                        Filter Reportee:
                                    </span>
                                    <SearchableInteractiveDropdown
                                        value={selectedReporteeId}
                                        onChange={(val: string) => setSelectedReporteeId(val)}
                                        options={reporteeDropdownOptions}
                                        placeholder="Search reportee by name, code..."
                                        buttonLabel="Select Reportee..."
                                        icon={Users}
                                        align="right"
                                    />
                                </div>
                            )}

                            {/* HR Head / Org Super Admin Global Assignee Inspection Dropdown - Only on All Viewable scope */}
                            {canViewOrgWide && scopeFilter === 'all' && (
                                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <span className="text-[11px] font-bold text-slate-500 shrink-0">Inspect Assignee:</span>
                                    <SearchableInteractiveDropdown
                                        value={selectedAssigneeFilter}
                                        onChange={(val: string) => {
                                            setSelectedAssigneeFilter(val);
                                            setScopeFilter('all');
                                        }}
                                        options={assigneeDropdownOptions}
                                        placeholder="Search assignee by name, code..."
                                        buttonLabel="All Assignees"
                                        icon={UserCheck}
                                        align="right"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Toolbar Filters: Search, Request Type, Status */}
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                        <div className="flex-1 min-w-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                            <div className="relative flex-1">
                                <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search by ticket #, employee, subject..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85] font-medium"
                                />
                            </div>

                            <select
                                value={ticketTypeFilter}
                                onChange={(e) => setTicketTypeFilter(e.target.value)}
                                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-[#587e85]"
                            >
                                <option value="all">{isPropertyAdmin ? 'All Property Grievances' : 'All Request Types'}</option>
                                <option value="grievance">Grievances</option>
                                {!isPropertyAdmin && <option value="hr_query">HR Queries</option>}
                                {isOrgSuperAdmin && <option value="confidential">Confidential & Anonymous</option>}
                                {(!isOrgSuperAdmin && !isPropertyAdmin && confidentialCount > 0) && <option value="confidential">Confidential (Assigned to You)</option>}
                            </select>

                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-[#587e85]"
                            >
                                <option value="all">All Statuses</option>
                                <option value="pending">⏳ Pending Action Tickets (Active)</option>
                                <option value="new">New</option>
                                <option value="pending_acknowledgement">Pending Acknowledgement</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                                <option value="overdue">Overdue TAT</option>
                            </select>
                        </div>
                    </div>

                    {/* Content Section: Table */}
                    {loading ? (
                        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                            <div className="w-8 h-8 border-3 border-[#587e85] border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-xs font-bold text-slate-500 mt-3">Loading tickets data...</p>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-slate-50/90 dark:bg-slate-800/80 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                            <th className="px-3.5 py-3">Request ID</th>
                                            <th className="px-3.5 py-3">Submitted By</th>
                                            <th className="px-3.5 py-3">Category</th>
                                            <th className="px-3.5 py-3">Subject</th>
                                            <th className="px-3.5 py-3">Current Level & Owner</th>
                                            <th className="px-3.5 py-3">Expected Resolution</th>
                                            <th className="px-3.5 py-3">Status</th>
                                            <th className="px-3.5 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                                        {filteredTickets.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="py-16 px-6 text-center">
                                                    <div className="max-w-md mx-auto flex flex-col items-center justify-center text-center">
                                                        <div className="w-12 h-12 rounded-2xl bg-[#587e85]/10 text-[#587e85] flex items-center justify-center mb-3">
                                                            {scopeFilter === 'my_team_assigned' ? <Users className="w-6 h-6" /> : <Ticket className="w-6 h-6" />}
                                                        </div>
                                                        <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                                                            {scopeFilter === 'my_team_assigned'
                                                                ? (myDepartmentReportees.length === 0 ? "No Direct Reportees Mapped" : "No Active Tickets in Team Hierarchy")
                                                                : "No Tickets Found"}
                                                        </h3>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                                                            {scopeFilter === 'my_team_assigned'
                                                                ? (myDepartmentReportees.length === 0
                                                                    ? "You currently have no reporting team members assigned to you in the organization directory."
                                                                    : "All tickets across your team and reporting tree are currently resolved or clear.")
                                                                : "No HR requests or grievances matched your current filter criteria."}
                                                        </p>
                                                        {scopeFilter === 'my_team_assigned' && myDepartmentReportees.length === 0 ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleNavigationTabSwitch('tree')}
                                                                className="mt-3.5 px-3.5 py-1.5 rounded-xl bg-[#587e85] text-white text-xs font-bold hover:bg-[#47686e] transition-all shadow-xs flex items-center gap-1.5"
                                                            >
                                                                <GitFork className="w-3.5 h-3.5" />
                                                                <span>View Org Reporting Tree</span>
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setScopeFilter(canViewOrgWide ? 'all' : 'assigned_to_me');
                                                                    setSelectedAssigneeFilter('all');
                                                                    setSelectedReporteeId('all');
                                                                    setTicketTypeFilter('all');
                                                                    setStatusFilter('all');
                                                                    setSearchQuery('');
                                                                }}
                                                                className="mt-3.5 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 transition-all shadow-2xs"
                                                            >
                                                                {canViewOrgWide ? 'Reset Filters to All Viewable' : 'Reset Filters to Assigned'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredTickets.map((t) => (
                                                <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                    <td className="px-3.5 py-3.5 font-mono font-bold text-[#587e85]">
                                                        #{t.ticket_number}
                                                    </td>
                                                    {/* Column 2: SUBMITTED BY with Circular Profile Avatar & Click Trigger */}
                                                    {(() => {
                                                        const isAnon = Boolean(t.is_anonymous);
                                                        const emp = !isAnon ? employeesList.find(e => 
                                                            (e.user_id && e.user_id === t.raised_by_user_id) || 
                                                            (e.id && e.id === t.raised_by_user_id) || 
                                                            (e.email && e.email.toLowerCase() === t.raised_by?.email?.toLowerCase()) ||
                                                            (e.employee_code && e.employee_code === t.employee_snapshot?.code)
                                                        ) : null;
                                                        const sName = isAnon ? 'Anonymous Employee' : (t.employee_snapshot?.name || (emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name : t.raised_by?.full_name || 'Employee'));
                                                        const sPhoto = !isAnon ? (t.raised_by?.user_photo_url || t.raised_by?.raw_user_meta_data?.user_photo_url || t.raised_by?.raw_user_meta_data?.avatar_url || emp?.user_photo_url || emp?.photo_url || emp?.avatar_url || emp?.user?.user_photo_url || emp?.user?.raw_user_meta_data?.user_photo_url || null) : null;

                                                        return (
                                                            <td className="px-3.5 py-3">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openSubmitterProfile(t);
                                                                    }}
                                                                    className="group text-left flex items-center gap-2.5 p-1 -ml-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all max-w-[210px]"
                                                                    title="Click to view employee information"
                                                                >
                                                                    <div className="relative shrink-0">
                                                                        {isAnon ? (
                                                                            <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 flex items-center justify-center shadow-2xs">
                                                                                <Lock className="w-3.5 h-3.5" />
                                                                            </div>
                                                                        ) : sPhoto ? (
                                                                            <>
                                                                                <div className="w-8 h-8 rounded-full p-[1.5px] bg-gradient-to-tr from-teal-500 via-[#587e85] to-emerald-400 shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                                                                                    <img
                                                                                        src={sPhoto}
                                                                                        alt=""
                                                                                        referrerPolicy="no-referrer"
                                                                                        onError={(e) => {
                                                                                            e.currentTarget.parentElement?.classList.add('!hidden');
                                                                                            const fallbackEl = e.currentTarget.parentElement?.nextElementSibling as HTMLElement;
                                                                                            if (fallbackEl) fallbackEl.classList.remove('!hidden');
                                                                                        }}
                                                                                        className="w-full h-full rounded-full object-cover bg-white dark:bg-slate-800"
                                                                                    />
                                                                                </div>
                                                                                <div className="!hidden w-8 h-8 rounded-full bg-[#587e85]/10 dark:bg-[#587e85]/20 border border-[#587e85]/30 text-[#587e85] dark:text-[#7ba9b1] flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                                                                                    {getInitials(sName)}
                                                                                </div>
                                                                            </>
                                                                        ) : (
                                                                            <div className="w-8 h-8 rounded-full bg-[#587e85]/10 dark:bg-[#587e85]/20 border border-[#587e85]/30 text-[#587e85] dark:text-[#7ba9b1] flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                                                                                {getInitials(sName)}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="font-bold text-slate-900 dark:text-white truncate group-hover:text-[#587e85] transition-colors flex items-center gap-1">
                                                                            <span className="truncate">{sName}</span>
                                                                            <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">ℹ️</span>
                                                                        </div>
                                                                        <div className="text-[11px] text-slate-400 font-medium truncate">
                                                                            {t.employee_snapshot?.department || 'Operations'} ({t.employee_snapshot?.location || 'Site'})
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                            </td>
                                                        );
                                                    })()}

                                                    <td className="px-3.5 py-3.5">
                                                        <span className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap">
                                                            {t.category?.category_name || t.category_name || 'Grievance'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3.5 py-3.5 font-semibold text-slate-800 dark:text-slate-200 max-w-xs truncate">
                                                        {t.subject}
                                                    </td>

                                                    {/* Column 5: CURRENT LEVEL & OWNER with Circular Profile Avatar & Click Trigger */}
                                                    {(() => {
                                                        const handlerUserId = t.assigned_to_user_id || t.assigned_to_id;
                                                        const emp = employeesList.find(e => 
                                                            (handlerUserId && (e.user_id === handlerUserId || e.id === handlerUserId)) ||
                                                            (t.assigned_to?.email && e.email?.toLowerCase() === t.assigned_to.email.toLowerCase())
                                                        );
                                                        const hName = t.current_level_owner || t.assigned_to_details?.full_name || t.assigned_to?.full_name || (emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name : 'Manager / HR');
                                                        const hPhoto = t.assigned_to_details?.photo_url || t.assigned_to?.user_photo_url || t.assigned_to?.raw_user_meta_data?.user_photo_url || t.assigned_to?.raw_user_meta_data?.avatar_url || emp?.user_photo_url || emp?.photo_url || emp?.avatar_url || emp?.user?.user_photo_url || emp?.user?.raw_user_meta_data?.user_photo_url || null;

                                                        return (
                                                            <td className="px-3.5 py-3">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">Level {t.current_level}</span>
                                                                    {t.status === 'escalated' && (
                                                                        <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200">
                                                                            Active
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openHandlerProfile(t);
                                                                    }}
                                                                    className="group text-left flex items-center gap-2 mt-1 p-1 -ml-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all max-w-[210px]"
                                                                    title="Click to view assigned handler information"
                                                                >
                                                                    <div className="relative shrink-0">
                                                                        {hPhoto ? (
                                                                            <>
                                                                                <div className="w-7 h-7 rounded-full p-[1.5px] bg-gradient-to-tr from-indigo-500 via-[#587e85] to-teal-400 shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                                                                                    <img
                                                                                        src={hPhoto}
                                                                                        alt=""
                                                                                        referrerPolicy="no-referrer"
                                                                                        onError={(e) => {
                                                                                            e.currentTarget.parentElement?.classList.add('!hidden');
                                                                                            const fallbackEl = e.currentTarget.parentElement?.nextElementSibling as HTMLElement;
                                                                                            if (fallbackEl) fallbackEl.classList.remove('!hidden');
                                                                                        }}
                                                                                        className="w-full h-full rounded-full object-cover bg-white dark:bg-slate-800"
                                                                                    />
                                                                                </div>
                                                                                <div className="!hidden w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-[10px] shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                                                                                    {getInitials(hName)}
                                                                                </div>
                                                                            </>
                                                                        ) : (
                                                                            <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-[10px] shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                                                                                {getInitials(hName)}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 group-hover:text-[#587e85] transition-colors truncate flex items-center gap-1" title={hName}>
                                                                            <span className="truncate">{hName}</span>
                                                                            <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">ℹ️</span>
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                            </td>
                                                        );
                                                    })()}
                                                    <td className="px-3.5 py-3.5">
                                                        <SLALiveTimer slaDueAt={t.sla_due_at} status={t.status} />
                                                    </td>
                                                    <td className="px-3.5 py-3.5">
                                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap border ${
                                                            t.status === 'closed'
                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                                                                : t.status === 'pending_acknowledgement' || t.status === 'resolved'
                                                                ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                                                                : t.status === 'in_progress'
                                                                ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                                                                : t.status === 'escalated'
                                                                ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
                                                                : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800'
                                                        }`}>
                                                            {t.status === 'escalated' && <span className="w-1.5 h-1.5 rounded-full bg-purple-600 dark:bg-purple-400 animate-pulse" />}
                                                            {t.status === 'pending_acknowledgement' ? 'PENDING ACKNOWLEDGEMENT' : t.status === 'escalated' ? `ESCALATED (L${t.current_level})` : t.status.replace(/_/g, ' ')}
                                                        </span>
                                                    </td>
                                                    <td className="px-3.5 py-3.5 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedTicketId(t.id)}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-50 hover:bg-[#587e85] text-slate-700 hover:text-white dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-[#587e85] dark:hover:text-white rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 hover:border-[#587e85] dark:hover:border-[#587e85] shadow-2xs transition-all active:scale-95"
                                                        >
                                                            <span>View Details</span>
                                                            <ArrowUpRight className="w-3.5 h-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: OTHER HR MODULE TABS */}
            {activeTab === 'notes' && (
                <HRNotesTrackerTab
                    orgId={orgId}
                    currentUserId={user?.id}
                    currentUserRole={userRole}
                    onOpenTicket={(ticketId) => setSelectedTicketId(ticketId)}
                />
            )}
            {activeTab === 'directory' && <HREmployeeDirectory orgId={orgId} />}
            {activeTab === 'reconciliation' && <HRReconciliationDashboard orgId={orgId} />}
            {activeTab === 'config' && <HRAdminConfigPanel orgId={orgId} />}
            {activeTab === 'analytics' && <HRAnalyticsDashboard orgId={orgId} tickets={tickets} />}

            {/* Modals */}
            <TicketCreateModal
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                onSuccess={() => fetchTickets(true)}
                orgId={orgId}
                userId={user?.id || ''}
            />

            <HRTicketDetailModal
                isOpen={Boolean(selectedTicketId)}
                ticketId={selectedTicketId}
                initialTicket={tickets.find(t => t.id === selectedTicketId)}
                onClose={() => setSelectedTicketId(null)}
                onRefresh={() => fetchTickets(true)}
                currentUserId={user?.id || ''}
                currentUserRole={userRole}
            />

            <EmployeeQuickProfileModal
                data={profileModalData}
                onClose={() => setProfileModalData(null)}
                onViewTicketDetails={(ticketId) => setSelectedTicketId(ticketId)}
            />
        </div>
    );
}

interface SearchableDropdownOption {
    id: string;
    label: string;
    subLabel?: string;
    code?: string;
    pendingCount?: number;
    pendingAssignees?: string[];
    totalCount?: number;
}

interface SearchableInteractiveDropdownProps {
    value: string;
    onChange: (value: string) => void;
    options: SearchableDropdownOption[];
    placeholder?: string;
    buttonLabel?: string;
    icon?: React.ComponentType<{ className?: string }>;
    align?: 'left' | 'right';
}

function SearchableInteractiveDropdown({
    value,
    onChange,
    options,
    placeholder = "Search...",
    buttonLabel = "Select option",
    icon: Icon,
    align = 'right'
}: SearchableInteractiveDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Focus search input when dropdown opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const selectedOption = options.find(opt => opt.id === value) || options[0];

    const filteredOptions = useMemo(() => {
        if (!searchQuery.trim()) return options;
        const q = searchQuery.toLowerCase().trim();
        return options.filter(opt =>
            opt.label.toLowerCase().includes(q) ||
            (opt.code && opt.code.toLowerCase().includes(q)) ||
            (opt.subLabel && opt.subLabel.toLowerCase().includes(q)) ||
            (opt.pendingAssignees && opt.pendingAssignees.some(a => a.toLowerCase().includes(q)))
        );
    }, [options, searchQuery]);

    const alignClass = align === 'right' ? 'right-0 left-auto' : 'left-0 right-auto';

    return (
        <div ref={dropdownRef} className="relative inline-block text-left w-full sm:w-auto">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full sm:w-auto flex items-center justify-between gap-2.5 px-3.5 py-2 rounded-xl border text-xs font-bold transition-all shadow-2xs ${
                    isOpen 
                        ? 'border-[#587e85] bg-[#587e85]/5 ring-2 ring-[#587e85]/20 text-[#587e85]' 
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                }`}
            >
                <div className="flex items-center gap-2 truncate max-w-[280px]">
                    {Icon && <Icon className="w-3.5 h-3.5 text-[#587e85] shrink-0" />}
                    <span className="truncate">{selectedOption ? selectedOption.label : buttonLabel}</span>
                    {selectedOption?.code && (
                        <span className="text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shrink-0">
                            {selectedOption.code}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    {selectedOption?.pendingCount !== undefined && selectedOption.pendingCount > 0 && (
                        <span 
                            className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 shrink-0"
                            title={`${selectedOption.pendingCount} pending actions`}
                        >
                            <Clock className="w-3 h-3 shrink-0 text-amber-600" />
                            <span>{selectedOption.pendingCount}</span>
                        </span>
                    )}
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#587e85]' : ''}`} />
                </div>
            </button>

            {isOpen && (
                <div className={`absolute ${alignClass} mt-2 w-80 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150`}>
                    {/* Top of Dropdown: Active Assignees with Pending Actions */}
                    {selectedOption?.pendingAssignees && selectedOption.pendingAssignees.length > 0 && (
                        <div className="p-3 bg-amber-50/90 dark:bg-amber-950/40 border-b border-amber-200/80 dark:border-amber-900/40">
                            <div className="flex items-center justify-between gap-1 text-[11px] font-extrabold text-amber-900 dark:text-amber-300">
                                <span className="flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                    <span>Pending Actions ({selectedOption.pendingCount}):</span>
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {selectedOption.pendingAssignees.map((name, idx) => (
                                    <span
                                        key={idx}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 text-amber-950 dark:text-amber-200 border border-amber-200 dark:border-amber-800 shadow-2xs"
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                        <span>{name}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Search Bar */}
                    <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={placeholder}
                                className="w-full pl-9 pr-8 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#587e85]"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Options List */}
                    <div className="max-h-72 overflow-y-auto p-1.5 space-y-1">
                        {filteredOptions.length === 0 ? (
                            <div className="p-4 text-center text-xs text-slate-400 font-medium">
                                No matching options found
                            </div>
                        ) : (
                            filteredOptions.map((opt) => {
                                const isSelected = opt.id === value;
                                return (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => {
                                            onChange(opt.id);
                                            setIsOpen(false);
                                            setSearchQuery('');
                                        }}
                                        className={`w-full text-left p-2.5 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                                            isSelected
                                                ? 'bg-[#587e85]/10 text-[#587e85] font-bold border border-[#587e85]/30'
                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border ${
                                                isSelected 
                                                    ? 'bg-[#587e85] text-white border-[#587e85]' 
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                            }`}>
                                                {opt.label.slice(0, 2).toUpperCase()}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold truncate">{opt.label}</span>
                                                    {opt.code && (
                                                        <span className="text-[9px] font-extrabold uppercase px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 shrink-0">
                                                            {opt.code}
                                                        </span>
                                                    )}
                                                </div>
                                                {opt.subLabel && (
                                                    <p className="text-[10.5px] font-normal text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                                        {opt.subLabel}
                                                    </p>
                                                )}

                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {opt.pendingCount !== undefined && opt.pendingCount > 0 && (
                                                <span className="px-2 py-0.5 rounded-full text-[9.5px] font-black bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 whitespace-nowrap">
                                                    {opt.pendingCount} pending
                                                </span>
                                            )}
                                            {isSelected && (
                                                <CheckCircle className="w-4 h-4 text-[#587e85] shrink-0" />
                                            )}
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default HRTicketsContent;

