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

export function HRTicketsContent({ orgId }: { orgId: string }) {
    const { user, membership } = useAuth();
    const searchParams = useSearchParams();

    const [activeTab, setActiveTab] = useState<'tickets' | 'tree' | 'directory' | 'reconciliation' | 'config' | 'analytics'>('tickets');
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

    // Searchable Property Dropdown state
    const [isPropertyDropdownOpen, setIsPropertyDropdownOpen] = useState(false);
    const [propertySearchQuery, setPropertySearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    const userRole = (user?.user_metadata?.role || membership?.org_role || membership?.properties?.[0]?.role || 'employee').toLowerCase();
    const isHrAdmin = ['hr', 'hr_head', 'org_super_admin', 'director'].includes(userRole);
    const isManager = ['manager', 'reporting_manager', 'soft_service_manager', 'soft_service_supervisor', 'property_admin', 'building_admin', 'mst_manager', 'supervisor'].includes(userRole);

    useEffect(() => {
        if (!isHrAdmin && (viewMode === 'kanban' || viewMode === 'properties')) {
            setViewMode('table');
        }
    }, [isHrAdmin, viewMode]);

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

    /**
     * Robust recursive reportees finder for a manager object.
     * Matches reportees by manager's user_id, profile id, employee_code, full_name, or email.
     */
    const getReporteesForManager = (
        mgrObj: { userId?: string; id?: string; code?: string; name?: string; email?: string },
        allEmps: any[],
        visited = new Set<string>()
    ): any[] => {
        if (!mgrObj) return [];

        const mgrUserId = mgrObj.userId || mgrObj.id || '';
        const mgrCode = (mgrObj.code || '').toLowerCase().trim();
        const mgrName = (mgrObj.name || '').toLowerCase().trim();
        const mgrEmail = (mgrObj.email || '').toLowerCase().trim();

        const visitKey = mgrUserId || mgrCode || mgrName || mgrEmail;
        if (!visitKey || visited.has(visitKey)) return [];
        const nextVisited = new Set(visited);
        nextVisited.add(visitKey);

        const direct = allEmps.filter(e => {
            const eUid = e.user_id || e.id;
            if (mgrUserId && eUid === mgrUserId) return false;

            const rId = e.reporting_manager_id || '';
            const rCode = (e.reporting_manager_code || '').toLowerCase().trim();
            const rName = (e.reporting_manager_name || '').toLowerCase().trim();

            const matchUserId = Boolean(mgrUserId && rId && (rId === mgrUserId || (rCode && rCode === mgrUserId)));
            const matchCode = Boolean(mgrCode && ((rCode && rCode === mgrCode) || (rId && rId === mgrCode)));
            const matchName = Boolean(mgrName && mgrName.length > 1 && (
                (rName && rName.length > 1 && (rName === mgrName || rName.includes(mgrName) || mgrName.includes(rName))) ||
                (rCode && rCode.length > 1 && (rCode === mgrName || (rCode.length > 2 && (rCode.includes(mgrName) || mgrName.includes(rCode)))))
            ));
            const matchEmail = Boolean(mgrEmail && ((rCode && rCode === mgrEmail) || (rName && rName === mgrEmail)));

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
        const tabParam = searchParams.get('tab');
        const actionParam = searchParams.get('action');
        const propertyParam = searchParams.get('propertyId');
        const filterParam = searchParams.get('filter');

        if (tabParam && ['tickets', 'tree', 'directory', 'reconciliation', 'config', 'analytics'].includes(tabParam)) {
            setActiveTab(tabParam as any);
        }
        if (actionParam === 'create') {
            setIsCreateOpen(true);
        }
        if (filterParam && ['all', 'my_raised', 'assigned_to_me', 'department'].includes(filterParam)) {
            setScopeFilter(filterParam as any);
        } else if (isHrAdmin) {
            setScopeFilter('all');
        } else {
            setScopeFilter('assigned_to_me');
        }
        setSelectedPropertyId(propertyParam || 'all');
    }, [searchParams, isHrAdmin, isManager]);

    useEffect(() => {
        fetchProperties();
    }, [orgId]);

    useEffect(() => {
        fetchTickets();
    }, [orgId, user?.id, userRole, selectedPropertyId]);

    // Real-time automatic background data refresh (every 10s & on window focus)
    useEffect(() => {
        const interval = setInterval(() => {
            fetchTickets(true);
        }, 10000);

        const handleFocus = () => fetchTickets(true);
        window.addEventListener('focus', handleFocus);

        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
        };
    }, [orgId, user?.id, selectedPropertyId]);

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
        if (!isBackground && tickets.length === 0) setLoading(true);
        try {
            const url = new URL('/api/hr/tickets', window.location.origin);
            url.searchParams.append('orgId', orgId);
            if (user?.id) url.searchParams.append('userId', user.id);
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
            } else {
                // Surface scoping/filter failures instead of silently keeping a stale list
                console.error('Error fetching tickets:', data.error || `HTTP ${res.status}`);
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

        if (uid && (tAssignedId === uid || t.assigned_to_user_id === uid)) return true;
        if (pId && (tAssignedId === pId || tAssignedId.includes(pId))) return true;
        if (uEmail && (tAssignedEmail === uEmail || tAssignedId.toLowerCase() === uEmail)) return true;
        if (pEmail && (tAssignedEmail === pEmail || tAssignedId.toLowerCase() === pEmail)) return true;
        if (pCode && (tAssignedCode === pCode || tAssignedId.toLowerCase() === pCode)) return true;

        return false;
    }, []);

    const isDirectlyAssignedToMe = React.useCallback((t: any) => {
        return isTicketAssignedToUser(t, user?.id, user?.email, userEmpProfile);
    }, [user, userEmpProfile, isTicketAssignedToUser]);

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
        overdueCount
    } = useMemo(() => {
        const total = tickets.length;
        const assignedToYou = tickets.filter(t => isDirectlyAssignedToMe(t)).length;
        const assignedPending = tickets.filter(t => isDirectlyAssignedToMe(t) && !['resolved', 'closed'].includes(t.status)).length;

        const grievances = tickets.filter(t => isGrievance(t)).length;
        const pendingGrievances = tickets.filter(t => isGrievance(t) && !['resolved', 'closed'].includes(t.status)).length;
        const queries = tickets.filter(t => isHRQuery(t)).length;
        const confidential = tickets.filter(t => isConfidential(t)).length;
        const overdue = tickets.filter(t => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status)).length;

        return {
            totalCount: total,
            assignedToYouCount: assignedToYou,
            assignedPendingCount: assignedPending,
            openGrievancesCount: grievances,
            pendingGrievancesCount: pendingGrievances,
            hrQueriesCount: queries,
            confidentialCount: confidential,
            overdueCount: overdue
        };
    }, [tickets, isDirectlyAssignedToMe, isGrievance, isHRQuery, isConfidential]);

    // Filter tickets based on UI search, scope, type, and status filters
    const filteredTickets = tickets.filter(t => {
        if (scopeFilter === 'my_raised' && t.raised_by_user_id !== user?.id && t.raised_by?.email !== user?.email) return false;
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
                const isReporteeAssigned = Array.from(reporteeUserIds).some(rid => {
                    const profileObj = employeesList.find(e => (e.user_id || e.id) === rid);
                    return isTicketAssignedToUser(t, rid, profileObj?.email, profileObj);
                });
                if (!isReporteeAssigned && !reporteeUserIds.has(t.assigned_to_user_id)) return false;
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

        // Status Filter from KPI Cards / Dropdown
        if (statusFilter === 'overdue') {
            const isOverdue = Boolean(t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status));
            if (!isOverdue) return false;
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

        const empOpts = employeesList.map(emp => {
            const uid = emp.user_id || emp.id;
            const empTickets = tickets.filter(t => isTicketAssignedToUser(t, uid, emp.email, emp));
            const empPendingTickets = empTickets.filter(t => !['resolved', 'closed'].includes(t.status));
            const empPendingAssignees = Array.from(
                new Set(empPendingTickets.map(t => getTicketAssigneeName(t)).filter(Boolean))
            );
            const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name || emp.email;

            return {
                id: uid,
                label: empName,
                subLabel: `${emp.designation || 'Staff'} • ${emp.department || 'Operations'}`,
                code: emp.employee_code,
                pendingCount: empPendingTickets.length,
                pendingAssignees: empPendingAssignees,
                totalCount: empTickets.length
            };
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
                            {activeTab === 'tree' ? 'Organization Reporting Tree & Workload Inspector' : isHrAdmin ? 'HR Helpdesk & Grievances' : isManager ? 'Team Grievance Requests' : 'My Requests & Grievances'}
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        onClick={() => setIsCreateOpen(true)}
                        className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-2xl text-xs font-bold shadow-md shadow-[#587e85]/20 transition-all active:scale-95"
                    >
                        <Plus className="w-4 h-4" />
                        Raise HR Request / Grievance
                    </button>
                </div>
            </div>

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

            {/* TAB 2: HR ADMIN KPI STAT CARDS (Shown ONLY to HR Admins on tickets tab) */}
            {activeTab === 'tickets' && isHrAdmin && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                    <div
                        onClick={() => { setActiveTab('tickets'); setScopeFilter('assigned_to_me'); setTicketTypeFilter('all'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border-2 border-amber-400 dark:border-amber-600 shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">Assigned To You</span>
                            <div className="p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 rounded-lg">
                                <ShieldCheck className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-2">{assignedToYouCount}</p>
                        <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                            {assignedPendingCount > 0 ? `${assignedPendingCount} pending action` : '0 pending action'}
                        </p>
                    </div>

                    <div
                        onClick={() => { setActiveTab('tickets'); setScopeFilter('all'); setTicketTypeFilter('all'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-[#587e85] transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Requests</span>
                            <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg">
                                <Ticket className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-2">{totalCount}</p>
                        <p className="text-[10px] font-medium text-slate-400 mt-0.5">Across selected properties</p>
                    </div>

                    <div
                        onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('grievance'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-amber-400 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">Grievances</span>
                            <div className="p-1.5 bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 rounded-lg">
                                <ShieldCheck className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-2">{openGrievancesCount}</p>
                        <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                            {pendingGrievancesCount > 0 ? `${pendingGrievancesCount} pending action` : 'All resolved'}
                        </p>
                    </div>

                    <div
                        onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('hr_query'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-blue-400 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">HR Queries</span>
                            <div className="p-1.5 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-lg">
                                <HelpCircle className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-2">{hrQueriesCount}</p>
                        <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mt-0.5">Direct HR Support</p>
                    </div>

                    <div
                        onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('confidential'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-purple-400 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">Confidential</span>
                            <div className="p-1.5 bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 rounded-lg">
                                <Lock className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-2">{confidentialCount}</p>
                        <p className="text-[10px] font-medium text-purple-600 dark:text-purple-400 mt-0.5">Director / Masked</p>
                    </div>

                    <div
                        onClick={() => { setActiveTab('tickets'); setStatusFilter('overdue'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900/60 shadow-sm hover:border-rose-500 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">Overdue TAT</span>
                            <div className="p-1.5 bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 rounded-lg">
                                <AlertTriangle className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400 mt-2">{overdueCount}</p>
                        <p className="text-[10px] font-medium text-rose-500 mt-0.5">Requires Escalation</p>
                    </div>
                </div>
            )}

            {/* MAIN TICKETS TAB */}
            {activeTab === 'tickets' && (
                <div className="space-y-4">
                    {/* Non-HR Scope Filter Pills & Assignee Inspector Dropdown */}
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
                            {isHrAdmin && (
                                <button
                                    type="button"
                                    onClick={() => { setScopeFilter('all'); setSelectedAssigneeFilter('all'); }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                        scopeFilter === 'all' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Ticket className="w-3.5 h-3.5" />
                                    <span>All Viewable ({tickets.length})</span>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => setScopeFilter('my_team_assigned')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                    scopeFilter === 'my_team_assigned' || scopeFilter === 'department' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <Users className="w-3.5 h-3.5" />
                                <span>Team & Reportees ({tickets.filter(t => Array.from(reporteeUserIds).some(rid => { const p = employeesList.find(e => (e.user_id || e.id) === rid); return isTicketAssignedToUser(t, rid, p?.email, p); })).length})</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setScopeFilter('assigned_to_me')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                    scopeFilter === 'assigned_to_me' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>Assigned Directly to Me ({tickets.filter(t => isDirectlyAssignedToMe(t)).length})</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setScopeFilter('my_raised')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                    scopeFilter === 'my_raised' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <User className="w-3.5 h-3.5" />
                                <span>My Raised ({tickets.filter(t => t.raised_by_user_id === user?.id || t.raised_by?.email === user?.email).length})</span>
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

                            {/* HR Head / Admin Global Assignee Inspection Dropdown */}
                            {isHrAdmin && (
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

                    {/* Toolbar Filters: Search, Request Type, Status & View Mode */}
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="flex-1 min-w-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                            <div className="relative flex-1">
                                <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search by ticket #, employee, subject..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#587e85]"
                                />
                            </div>

                            <select
                                value={ticketTypeFilter}
                                onChange={(e) => setTicketTypeFilter(e.target.value)}
                                className="px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-[#587e85]"
                            >
                                <option value="all">All Request Types</option>
                                <option value="grievance">Grievances</option>
                                <option value="hr_query">HR Queries</option>
                                <option value="confidential">Confidential / Masked</option>
                            </select>

                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-[#587e85]"
                            >
                                <option value="all">All Statuses</option>
                                <option value="new">New</option>
                                <option value="assigned">Assigned</option>
                                <option value="in_progress">In Progress</option>
                                <option value="pending_acknowledgement">Pending Acknowledgement</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                                <option value="overdue">Overdue TAT</option>
                            </select>
                        </div>

                        {/* View Mode Switcher */}
                        {isHrAdmin && (
                            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 shrink-0">
                                <button
                                    onClick={() => setViewMode('table')}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                                        viewMode === 'table' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <FileText className="w-3.5 h-3.5" />
                                    <span>Table View</span>
                                </button>
                                <button
                                    onClick={() => setViewMode('kanban')}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                                        viewMode === 'kanban' ? 'bg-[#587e85] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Kanban className="w-3.5 h-3.5" />
                                    <span>Kanban Board</span>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Content Section: Table / Kanban */}
                    {loading ? (
                        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                            <div className="w-8 h-8 border-3 border-[#587e85] border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-xs font-bold text-slate-500 mt-3">Loading tickets data...</p>
                        </div>
                    ) : viewMode === 'kanban' ? (
                        <HRKanbanBoard
                            tickets={filteredTickets}
                            onSelectTicket={(id) => setSelectedTicketId(id)}
                            onUpdateStatus={handleUpdateStatus}
                        />
                    ) : (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                                            <th className="p-4">Request ID</th>
                                            <th className="p-4">Submitted By</th>
                                            <th className="p-4">Category</th>
                                            <th className="p-4">Subject</th>
                                            <th className="p-4">Current Level & Owner</th>
                                            <th className="p-4">Expected Resolution</th>
                                            <th className="p-4">Status</th>
                                            <th className="p-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                        {filteredTickets.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="p-12 text-center text-slate-400 font-medium">
                                                    No HR requests or grievances found matching your filter criteria.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredTickets.map((t) => (
                                                <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                    <td className="p-4 font-black text-[#587e85]">
                                                        #{t.ticket_number}
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-900 dark:text-white">
                                                            {t.is_anonymous ? 'Anonymous Employee' : t.employee_snapshot?.name || t.raised_by?.full_name || 'Employee'}
                                                        </div>
                                                        <div className="text-[11px] text-slate-400">
                                                            {t.employee_snapshot?.department || 'Operations'} ({t.employee_snapshot?.location || 'Site'})
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                            {t.category?.category_name || t.category_name || 'Grievance'}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 font-bold text-slate-800 dark:text-slate-200 max-w-xs truncate">
                                                        {t.subject}
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                                                            Level {t.current_level}
                                                        </div>
                                                        <div className="text-[11px] font-medium text-slate-500">
                                                            {t.assigned_to?.full_name || t.assigned_to_user_id || 'Manager / HR'}
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <SLALiveTimer slaDueAt={t.sla_due_at} status={t.status} />
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`px-2.5 py-1 rounded-full text-[10.5px] font-black uppercase tracking-wider ${
                                                            t.status === 'closed'
                                                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                                                : t.status === 'pending_acknowledgement' || t.status === 'resolved'
                                                                ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                                                : t.status === 'in_progress'
                                                                ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200'
                                                        }`}>
                                                            {t.status === 'pending_acknowledgement' ? 'PENDING ACKNOWLEDGEMENT' : t.status.replace(/_/g, ' ')}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <button
                                                            onClick={() => setSelectedTicketId(t.id)}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95"
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
                onClose={() => setSelectedTicketId(null)}
                onRefresh={() => fetchTickets(true)}
                currentUserId={user?.id || ''}
                currentUserRole={userRole}
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

    const formatAssigneesText = (names?: string[]) => {
        if (!names || names.length === 0) return '';
        if (names.length <= 2) return names.join(', ');
        return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
    };

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
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1">
                            <Clock className="w-3 h-3 shrink-0 text-amber-600" />
                            <span>
                                {selectedOption.pendingCount} pending
                                {selectedOption.pendingAssignees && selectedOption.pendingAssignees.length > 0 && (
                                    <span className="font-bold ml-1">
                                        ({formatAssigneesText(selectedOption.pendingAssignees)})
                                    </span>
                                )}
                            </span>
                        </span>
                    )}
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#587e85]' : ''}`} />
                </div>
            </button>

            {isOpen && (
                <div className={`absolute ${alignClass} mt-2 w-80 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150`}>
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
                                                {opt.pendingAssignees && opt.pendingAssignees.length > 0 && (
                                                    <p className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400 truncate mt-0.5 flex items-center gap-1">
                                                        <Clock className="w-3 h-3 shrink-0 text-amber-500" />
                                                        <span>Pending with: {formatAssigneesText(opt.pendingAssignees)}</span>
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

