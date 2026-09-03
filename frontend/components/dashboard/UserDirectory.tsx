'use client';

import React, { useState, useEffect } from 'react';
import {
    Users, Search, Filter, UserPlus, Trash2, RefreshCw,
    Plus, Mail, Phone, Shield, Building2,
    Calendar, MoreVertical, Edit2, X, Check,
    Wrench, Hammer, Briefcase, Sparkles, Star, UserCircle, ChevronDown, Key, QrCode
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import InviteMemberModal from './InviteMemberModal'; // This is actually our AddMemberModal now
import ClientQRGeneratorModal from '../vms/ClientQRGeneratorModal';

interface UserWithMembership {
    id: string;
    full_name: string;
    email: string;
    avatar_url?: string;
    user_photo_url?: string;
    orgRole?: string;
    propertyRole?: string;
    propertyName?: string;
    propertyId?: string;
    organizationId?: string;
    organizationName?: string;
    is_active: boolean;
    joined_at: string;
    phone?: string;
    is_approved?: boolean;
    approval_status?: string;
    approved_by?: string | null;
    approved_at?: string | null;
    rejection_reason?: string | null;
    approverName?: string | null;
}

interface UserDirectoryProps {
    orgId?: string;
    orgName?: string;
    propertyId?: string;
    properties?: { id: string; name: string }[];
    onUserUpdated?: () => void;
}

const UserDirectory = ({ orgId, orgName, propertyId, properties = [], onUserUpdated }: UserDirectoryProps) => {
    const [users, setUsers] = useState<UserWithMembership[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [propertyFilter, setPropertyFilter] = useState('all');
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [editingRole, setEditingRole] = useState<string>('');
    const [editingSkills, setEditingSkills] = useState<string[]>([]);
    const [isUpdating, setIsUpdating] = useState(false);

    const SKILL_OPTIONS: Record<string, { code: string; label: string; icon: any }[]> = {
        mst: [
            { code: 'technical', label: 'Technical', icon: Wrench },
            { code: 'plumbing', label: 'Plumbing', icon: Hammer },
            { code: 'vendor', label: 'Vendor Coordination', icon: Briefcase },
        ],
        staff: [
            { code: 'technical', label: 'Technical', icon: Wrench },
            { code: 'soft_services', label: 'Soft Services', icon: Sparkles },
        ],
    };

    const toggleSkill = (code: string) => {
        setEditingSkills(prev =>
            prev.includes(code)
                ? prev.filter(c => c !== code)
                : [...prev, code]
        );
    };
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [showClientQRModal, setShowClientQRModal] = useState(false);
    const [selectedUserForProfile, setSelectedUserForProfile] = useState<UserWithMembership | null>(null);

    // Super Tenant property management
    const [superTenantUser, setSuperTenantUser] = useState<UserWithMembership | null>(null);
    const [superTenantSelectedProps, setSuperTenantSelectedProps] = useState<string[]>([]);
    const [isAssigningST, setIsAssigningST] = useState(false);
    const [superTenantPropsMap, setSuperTenantPropsMap] = useState<Record<string, Array<{ property_id: string; name: string }>>>({});
    const [expandedPropsUserId, setExpandedPropsUserId] = useState<string | null>(null);

    // Property-admin multi-property management
    const [propAssignUser, setPropAssignUser] = useState<UserWithMembership | null>(null);
    const [propAssignPropsMap, setPropAssignPropsMap] = useState<Record<string, Array<{ property_id: string; name: string; role: string }>>>({});
    const [expandedPropAdminUserId, setExpandedPropAdminUserId] = useState<string | null>(null);
    const [propAssignSelectedPropId, setPropAssignSelectedPropId] = useState<string>('');
    const [propAssignRole, setPropAssignRole] = useState<string>('property_admin');
    const [isAssigningProp, setIsAssigningProp] = useState(false);

    const supabase = createClient();

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    useEffect(() => {
        fetchUsers();
    }, [orgId, propertyId]);

    const fetchUsers = async () => {
        setIsLoading(true);

        try {
            const params = new URLSearchParams();
            if (propertyId) params.set('propertyId', propertyId);
            if (orgId) params.set('orgId', orgId);

            const response = await fetch(`/api/users/list?${params.toString()}`);
            if (!response.ok) {
                const error = await response.json();
                console.error('Failed to fetch users:', error);
                setUsers([]);
                setIsLoading(false);
                return;
            }

            const data = await response.json();
            setUsers(data.users || []);
        } catch (err) {
            console.error('Error fetching users:', err);
            setUsers([]);
        }

        setIsLoading(false);
    };

    const [approvingUserId, setApprovingUserId] = useState<string | null>(null);

    const handleApproveUser = async (userToApprove: UserWithMembership) => {
        setApprovingUserId(userToApprove.id);
        try {
            const res = await fetch('/api/users/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userToApprove.id,
                    action: 'approve',
                    propertyId: userToApprove.propertyId || propertyId,
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to approve user');

            showToast(`User ${userToApprove.full_name} approved! Access unlocked.`);
            
            // Instantly update user in local list
            setUsers(prev => prev.map(u => u.id === userToApprove.id ? {
                ...u,
                is_approved: true,
                approval_status: 'approved',
                is_active: true,
                approved_at: data.approvedAt || new Date().toISOString(),
                approverName: data.approvedBy || 'Administrator'
            } : u));

            if (selectedUserForProfile?.id === userToApprove.id) {
                setSelectedUserForProfile(prev => prev ? {
                    ...prev,
                    is_approved: true,
                    approval_status: 'approved',
                    is_active: true,
                    approved_at: data.approvedAt || new Date().toISOString(),
                    approverName: data.approvedBy || 'Administrator'
                } : null);
            }

            onUserUpdated?.();
        } catch (err: any) {
            showToast(err.message || 'Error approving user', 'error');
        } finally {
            setApprovingUserId(null);
        }
    };

    const handleRejectUser = async (userToReject: UserWithMembership) => {
        const reason = window.prompt(`Enter reason for rejecting ${userToReject.full_name}:`, 'Application requirements not met');
        if (reason === null) return;

        setApprovingUserId(userToReject.id);
        try {
            const res = await fetch('/api/users/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userToReject.id,
                    action: 'reject',
                    reason,
                    propertyId: userToReject.propertyId || propertyId,
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to reject user');

            showToast(`User ${userToReject.full_name} application rejected`, 'success');

            // Instantly update user in local list
            setUsers(prev => prev.map(u => u.id === userToReject.id ? {
                ...u,
                is_approved: false,
                approval_status: 'rejected',
                is_active: false,
                rejection_reason: reason
            } : u));

            if (selectedUserForProfile?.id === userToReject.id) {
                setSelectedUserForProfile(prev => prev ? {
                    ...prev,
                    is_approved: false,
                    approval_status: 'rejected',
                    is_active: false,
                    rejection_reason: reason
                } : null);
            }

            onUserUpdated?.();
        } catch (err: any) {
            showToast(err.message || 'Error rejecting user', 'error');
        } finally {
            setApprovingUserId(null);
        }
    };

    const fetchSuperTenantProperties = async (userId: string) => {
        if (superTenantPropsMap[userId]) return; // already loaded
        try {
            const res = await fetch(`/api/super-tenant?user_id=${userId}`);
            const data = await res.json();
            const props = (data.properties || []).map((r: any) => ({
                property_id: r.property_id,
                name: r.properties?.name || r.property_id,
            }));
            setSuperTenantPropsMap(prev => ({ ...prev, [userId]: props }));
        } catch { /* silent */ }
    };

    const fetchUserPropertyAssignments = async (userId: string, defaultPropId?: string, defaultPropName?: string, defaultRole?: string) => {
        if (propAssignPropsMap[userId]) return; // already loaded
        try {
            const { data } = await supabase
                .from('property_memberships')
                .select('property_id, role, properties(name)')
                .eq('user_id', userId)
                .eq('is_active', true);
            let props = (data || []).map((r: any) => ({
                property_id: r.property_id,
                name: r.properties?.name || r.property_id,
                role: r.role,
            }));
            if (props.length === 0 && defaultPropId) {
                props = [{
                    property_id: defaultPropId,
                    name: defaultPropName || defaultPropId,
                    role: defaultRole || 'tenant',
                }];
            }
            setPropAssignPropsMap(prev => ({ ...prev, [userId]: props }));
        } catch { /* silent */ }
    };

    const handleRemovePropAssignment = async (userId: string, propId: string) => {
        if (!orgId) return;
        try {
            const res = await fetch('/api/users/assign-property', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, propertyId: propId, organizationId: orgId, action: 'remove' }),
            });
            if (!res.ok) { showToast('Failed to remove property', 'error'); return; }
            setPropAssignPropsMap(prev => ({
                ...prev,
                [userId]: (prev[userId] || []).filter(p => p.property_id !== propId),
            }));
            showToast('Property removed');
        } catch { showToast('Failed to remove property', 'error'); }
    };

    const handleAddPropAssignment = async () => {
        if (!propAssignUser || !propAssignSelectedPropId || !orgId) return;
        setIsAssigningProp(true);
        try {
            const res = await fetch('/api/users/assign-property', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: propAssignUser.id,
                    propertyId: propAssignSelectedPropId,
                    role: propAssignRole,
                    organizationId: orgId,
                    action: 'add',
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to assign');
            const propName = properties.find(p => p.id === propAssignSelectedPropId)?.name || propAssignSelectedPropId;
            setPropAssignPropsMap(prev => {
                const existing = prev[propAssignUser.id] || [];
                const idx = existing.findIndex(p => p.property_id === propAssignSelectedPropId);
                if (idx >= 0) {
                    const updated = [...existing];
                    updated[idx] = { ...updated[idx], role: propAssignRole };
                    return { ...prev, [propAssignUser.id]: updated };
                }
                return { ...prev, [propAssignUser.id]: [...existing, { property_id: propAssignSelectedPropId, name: propName, role: propAssignRole }] };
            });
            showToast('Property assigned successfully');
            setPropAssignUser(null);
            setPropAssignSelectedPropId('');
        } catch (err) {
            showToast((err as Error).message, 'error');
        } finally {
            setIsAssigningProp(false);
        }
    };

    const handleRemoveSuperTenantProp = async (userId: string, propId: string) => {
        try {
            const res = await fetch('/api/super-tenant', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, property_id: propId }),
            });
            if (!res.ok) { showToast('Failed to remove property', 'error'); return; }
            setSuperTenantPropsMap(prev => ({
                ...prev,
                [userId]: (prev[userId] || []).filter(p => p.property_id !== propId),
            }));
            showToast('Property removed');
        } catch { showToast('Failed to remove property', 'error'); }
    };

    const handleAssignSuperTenant = async () => {
        if (!superTenantUser || superTenantSelectedProps.length === 0 || !orgId) return;
        setIsAssigningST(true);
        try {
            const res = await fetch('/api/super-tenant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: superTenantUser.id, property_ids: superTenantSelectedProps, organization_id: orgId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to assign');
            // Refresh cached props for this user
            setSuperTenantPropsMap(prev => {
                const existing = prev[superTenantUser.id] || [];
                const newProps = superTenantSelectedProps
                    .filter(pid => !existing.find(p => p.property_id === pid))
                    .map(pid => ({ property_id: pid, name: properties.find(p => p.id === pid)?.name || pid }));
                return { ...prev, [superTenantUser.id]: [...existing, ...newProps] };
            });
            showToast('Properties updated successfully');
            setSuperTenantUser(null);
            setSuperTenantSelectedProps([]);
        } catch (err) {
            showToast((err as Error).message, 'error');
        } finally {
            setIsAssigningST(false);
        }
    };

    const handleResetPassword = async (userId: string, email: string) => {
        if (!confirm(`Send password reset email to ${email}?`)) return;

        try {
            const response = await fetch('/api/users/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            if (response.ok) {
                showToast('Password reset email sent!');
            } else {
                const data = await response.json();
                showToast(data.error || 'Failed to send reset email', 'error');
            }
        } catch (err) {
            showToast('Failed to send reset email', 'error');
        }
    };

    const handleDeleteUser = async (userId: string, userName: string) => {
        if (!confirm(`Are you sure you want to remove ${userName}? This action cannot be undone.`)) return;

        try {
            const response = await fetch('/api/users/remove-membership', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, orgId, propertyId })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to remove user');
            }

            showToast('User removed successfully');
            fetchUsers();
            onUserUpdated?.();
        } catch (err: any) {
            console.error('Error removing user:', err);
            showToast(err.message || 'Failed to remove user', 'error');
        }
    };

    const handleUpdateRole = async (userId: string, newRole: string) => {
        setIsUpdating(true);
        try {
            const user = users.find(u => u.id === userId);
            const currentUserPropertyId = user?.propertyId || propertyId;

            const response = await fetch('/api/users/update-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    newRole,
                    propertyId: currentUserPropertyId,
                    organizationId: orgId,
                    skills: editingSkills
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update role');
            }

            // For cross-level changes (property ↔ org), refetch all users
            const ORG_LEVEL_ROLES = ['org_super_admin'];
            const wasPropertyLevel = !!user?.propertyRole && !user?.orgRole;
            const wasOrgLevel = !!user?.orgRole;
            const isNowOrgLevel = ORG_LEVEL_ROLES.includes(newRole);
            const isNowPropertyLevel = !ORG_LEVEL_ROLES.includes(newRole);
            const isCrossLevelChange = (wasPropertyLevel && isNowOrgLevel) || (wasOrgLevel && isNowPropertyLevel);

            if (isCrossLevelChange) {
                // Full refetch since user moved across tables
                await fetchUsers();
            } else {
                // Sync local state for same-level changes
                setUsers(users.map(u => {
                    if (u.id === userId) {
                        return {
                            ...u,
                            propertyRole: currentUserPropertyId ? newRole : u.propertyRole,
                            orgRole: orgId && !currentUserPropertyId ? newRole : u.orgRole,
                        };
                    }
                    return u;
                }));
            }

            showToast('Role updated successfully');
            setEditingUserId(null);
            setEditingSkills([]);
            onUserUpdated?.();
        } catch (err) {
            console.error('Error updating role:', err);
            showToast('Failed to update role: ' + (err as Error).message, 'error');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleStartEdit = async (user: UserWithMembership) => {
        setEditingUserId(user.id);
        const currentRole = user.propertyRole || user.orgRole || 'staff';
        setEditingRole(currentRole);
        setEditingSkills([]); // Reset skills when starting edit

        if (currentRole === 'mst' || currentRole === 'staff') {
            try {
                const { data } = await supabase
                    .from('mst_skills')
                    .select('skill_code')
                    .eq('user_id', user.id);

                if (data) {
                    setEditingSkills(data.map(s => s.skill_code));
                }
            } catch (err) {
                console.error('Error fetching user skills:', err);
            }
        }
    };

    const roleOptions = propertyId
        ? [
            'property_admin',
            'tenant',
            'staff',
            'mst',
            'security',
            'soft_service_manager',
            'soft_service_supervisor',
            'vendor',
            'procurement',
            'finance'
        ]
        : [
            'org_super_admin',
            'property_admin',
            'tenant',
            'super_tenant',
            'staff',
            'mst',
            'security',
            'soft_service_manager',
            'soft_service_supervisor',
            'procurement',
            'finance',
            'sales',
            'bd_rep',
            'vendor'
        ];

    const formatRole = (role: string) => {
        if (!role) return 'Member';
        if (role === 'tenant') return 'Client / Tenant';
        if (role === 'super_tenant') return 'Super Client (Multi-Property)';
        if (role === 'org_super_admin') return 'Org Super Admin';
        if (role === 'property_admin') return 'Property Admin';
        if (role === 'mst') return 'MST (Technician)';
        if (role === 'soft_service_manager') return 'Soft Service Manager';
        if (role === 'soft_service_supervisor') return 'Soft Service Supervisor';
        if (role === 'procurement' || role === 'procurement_user') return 'Procurement';
        if (role === 'finance' || role === 'accounts') return 'Finance / Accounts';
        if (role === 'sales' || role === 'sales_executive') return 'Sales / CRM';
        if (role === 'bd_rep' || role === 'bd_admin' || role === 'bd_super_admin') return 'Business Development';
        if (role === 'security') return 'Security / Front Desk';
        if (role === 'vendor') return 'Vendor / Contractor';
        return role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    const pendingUsersCount = users.filter(u => 
        (u.is_approved === false || u.approval_status === 'pending') && u.approval_status !== 'rejected'
    ).length;

    const approvedUsersCount = users.filter(u => 
        (u.is_approved === true || u.approval_status === 'approved') && u.approval_status !== 'rejected'
    ).length;

    const filteredUsers = users.filter(u => {
        const matchesSearch = u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email.toLowerCase().includes(searchQuery.toLowerCase());
        const userRole = u.orgRole || u.propertyRole || '';
        const matchesRole = roleFilter === 'all' || userRole === roleFilter;

        const isUserPending = (u.is_approved === false || u.approval_status === 'pending') && u.approval_status !== 'rejected';
        const isUserApproved = (u.is_approved === true || u.approval_status === 'approved') && u.approval_status !== 'rejected';

        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'active' && u.is_active) ||
            (statusFilter === 'inactive' && !u.is_active) ||
            (statusFilter === 'pending' && isUserPending) ||
            (statusFilter === 'approved' && isUserApproved);

        const matchesProperty = propertyFilter === 'all' || u.propertyId === propertyFilter;

        return matchesSearch && matchesRole && matchesStatus && matchesProperty;
    });

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">User Management</h2>
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wider rounded-lg border border-slate-200">
                            {filteredUsers.length} Users
                        </span>
                        {pendingUsersCount > 0 && (
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-lg border border-amber-300 animate-pulse flex items-center gap-1">
                                <span>⏳ {pendingUsersCount} Pending Approval</span>
                            </span>
                        )}
                    </div>
                    <p className="text-slate-500 font-medium text-sm mt-1">Manage user access, roles, approvals, and permissions.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowClientQRModal(true)}
                        className="flex items-center gap-2 px-5 py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-teal-600/20 cursor-pointer"
                    >
                        <QrCode className="w-4 h-4" />
                        Client Onboarding QR
                    </button>
                    {orgId && (
                        <button
                            onClick={() => {
                                const parentTrigger = (onUserUpdated as any)?.__triggerModal;
                                if (parentTrigger) {
                                    parentTrigger();
                                } else {
                                    setShowInviteModal(true);
                                }
                            }}
                            className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white font-black text-sm rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 cursor-pointer"
                        >
                            <UserPlus className="w-4 h-4" />
                            Add Member
                        </button>
                    )}
                </div>
            </div>

            {/* Quick Status Filter Tabs */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
                <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                        statusFilter === 'all'
                            ? 'bg-slate-900 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                    All Users ({users.length})
                </button>
                <button
                    onClick={() => setStatusFilter('pending')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                        statusFilter === 'pending'
                            ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                            : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                    }`}
                >
                    <span>⏳ Pending Approval</span>
                    {pendingUsersCount > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                            statusFilter === 'pending' ? 'bg-white text-amber-800' : 'bg-amber-500 text-white'
                        }`}>
                            {pendingUsersCount}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setStatusFilter('approved')}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                        statusFilter === 'approved'
                            ? 'bg-emerald-700 text-white shadow-md shadow-emerald-700/20'
                            : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                    }`}
                >
                    Approved ({approvedUsersCount})
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[280px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 transition-all"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 text-slate-700 font-bold text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-200 cursor-pointer"
                >
                    <option value="all">All Roles</option>
                    {roleOptions.map(role => (
                        <option key={role} value={role}>{formatRole(role)}</option>
                    ))}
                </select>

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-3 bg-white border border-slate-200 text-slate-700 font-bold text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-200 cursor-pointer"
                >
                    <option value="all">All Statuses</option>
                    <option value="pending">⏳ Pending Approval</option>
                    <option value="approved">✓ Approved</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>

                {properties.length > 0 && (
                    <select
                        value={propertyFilter}
                        onChange={(e) => setPropertyFilter(e.target.value)}
                        className="px-4 py-3 bg-white border border-slate-200 text-slate-700 font-bold text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-200 cursor-pointer"
                    >
                        <option value="all">All Properties</option>
                        {properties.map(prop => (
                            <option key={prop.id} value={prop.id}>{prop.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {/* User Cards */}
            <div className="space-y-4">
                {isLoading ? (
                    <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
                        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-500 font-medium">Loading users...</p>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
                        <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500 font-medium">No users found.</p>
                    </div>
                ) : (
                    filteredUsers.map((user) => (
                        <div
                            key={user.id}
                            onClick={() => setSelectedUserForProfile(user)}
                            className="bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow cursor-pointer group"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                {/* Left Side: User Info + Badges */}
                                <div className="flex items-start gap-4 flex-1">
                                    <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center mt-1 group-hover:scale-105 transition-transform">
                                        {user.user_photo_url || user.avatar_url ? (
                                            <img
                                                src={user.user_photo_url || user.avatar_url}
                                                alt={user.full_name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <UserCircle className="w-8 h-8 text-slate-300" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-lg font-bold text-slate-900 truncate group-hover:text-primary transition-colors">{user.full_name}</h3>
                                        <p className="text-sm text-slate-500 truncate mb-2">{user.email}</p>

                                        {/* Badges & Edit Role - Now below name/email */}
                                        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                            {/* Role Badge */}
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-amber-100">
                                                <Star className="w-3 h-3" />
                                                {formatRole(user.orgRole || user.propertyRole || 'member')}
                                            </span>

                                            {/* Property Badge / Super Tenant Properties */}
                                            {(user.orgRole === 'super_tenant' || user.propertyRole === 'super_tenant') ? (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <button
                                                        onClick={() => {
                                                            if (expandedPropsUserId === user.id) {
                                                                setExpandedPropsUserId(null);
                                                            } else {
                                                                setExpandedPropsUserId(user.id);
                                                                fetchSuperTenantProperties(user.id);
                                                            }
                                                        }}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-secondary/10 text-secondary text-[10px] font-black uppercase tracking-wider rounded-lg border border-secondary/20 hover:bg-secondary/25 transition-smooth"
                                                    >
                                                        <Key className="w-3 h-3" />
                                                        {expandedPropsUserId === user.id ? 'Hide Properties' : `Properties (${(superTenantPropsMap[user.id] || []).length || '...'})`}
                                                    </button>
                                                    {expandedPropsUserId === user.id && (
                                                        <>
                                                            {(superTenantPropsMap[user.id] || []).map(p => (
                                                                <span key={p.property_id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider rounded-lg border border-primary/20">
                                                                    <Building2 className="w-3 h-3" />
                                                                    {p.name}
                                                                    <button
                                                                        onClick={() => handleRemoveSuperTenantProp(user.id, p.property_id)}
                                                                        className="ml-0.5 w-4 h-4 flex items-center justify-center rounded hover:bg-primary/20 transition-smooth text-primary hover:text-error"
                                                                    >
                                                                        <X className="w-2.5 h-2.5" />
                                                                    </button>
                                                                </span>
                                                            ))}
                                                            {superTenantPropsMap[user.id]?.length === 0 && (
                                                                <span className="text-[10px] text-text-tertiary font-medium">No properties assigned</span>
                                                            )}
                                                            <button
                                                                onClick={() => { setSuperTenantUser(user); setSuperTenantSelectedProps([]); }}
                                                                className="inline-flex items-center gap-1 px-2 py-1 bg-surface-elevated text-text-secondary text-[10px] font-black uppercase tracking-wider rounded-lg border border-border hover:bg-muted transition-smooth"
                                                            >
                                                                <Plus className="w-3 h-3" />
                                                                Add
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            ) : orgId && (user.propertyRole || user.propertyName) && user.orgRole !== 'super_tenant' ? (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <button
                                                        onClick={() => {
                                                            if (expandedPropAdminUserId === user.id) {
                                                                setExpandedPropAdminUserId(null);
                                                            } else {
                                                                setExpandedPropAdminUserId(user.id);
                                                                fetchUserPropertyAssignments(user.id, user.propertyId, user.propertyName, user.propertyRole);
                                                            }
                                                        }}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider rounded-lg border border-primary/20 hover:bg-primary/25 transition-smooth"
                                                    >
                                                        <Building2 className="w-3 h-3" />
                                                        {expandedPropAdminUserId === user.id
                                                            ? 'Hide Properties'
                                                            : propAssignPropsMap[user.id]
                                                                ? `Properties (${propAssignPropsMap[user.id].length})`
                                                                : user.propertyName
                                                                    ? user.propertyName
                                                                    : 'Properties'}
                                                    </button>
                                                    {expandedPropAdminUserId === user.id && (
                                                        <>
                                                            {(propAssignPropsMap[user.id] || []).map(p => (
                                                                <span key={p.property_id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider rounded-lg border border-primary/20">
                                                                    <Building2 className="w-3 h-3" />
                                                                    {p.name}
                                                                    <button
                                                                        onClick={() => handleRemovePropAssignment(user.id, p.property_id)}
                                                                        className="ml-0.5 w-4 h-4 flex items-center justify-center rounded hover:bg-primary/20 transition-smooth text-primary hover:text-error"
                                                                    >
                                                                        <X className="w-2.5 h-2.5" />
                                                                    </button>
                                                                </span>
                                                            ))}
                                                            {propAssignPropsMap[user.id]?.length === 0 && (
                                                                <span className="text-[10px] text-text-tertiary font-medium">No active properties</span>
                                                            )}
                                                            <button
                                                                onClick={() => {
                                                                    setPropAssignUser(user);
                                                                    setPropAssignSelectedPropId('');
                                                                    setPropAssignRole(user.propertyRole === 'tenant' ? 'tenant' : (user.propertyRole || 'property_admin'));
                                                                }}
                                                                className="inline-flex items-center gap-1 px-2 py-1 bg-surface-elevated text-text-secondary text-[10px] font-black uppercase tracking-wider rounded-lg border border-border hover:bg-muted transition-smooth"
                                                            >
                                                                <Plus className="w-3 h-3" />
                                                                Add
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            ) : user.propertyName ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider rounded-lg border border-primary/20">
                                                    <Building2 className="w-3 h-3" />
                                                    {user.propertyName}
                                                </span>
                                            ) : null}

                                            {/* Status Badge */}
                                            <span className={`inline-flex items-center px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border ${
                                                user.approval_status === 'rejected'
                                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                    : (user.is_approved || user.approval_status === 'approved')
                                                        ? user.is_active
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                            : 'bg-slate-100 text-slate-600 border-slate-200'
                                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                            }`}>
                                                {user.approval_status === 'rejected'
                                                    ? 'Rejected'
                                                    : (user.is_approved || user.approval_status === 'approved')
                                                        ? user.is_active ? '✓ Approved' : 'Inactive'
                                                        : '⏳ Pending Approval'}
                                            </span>

                                            {/* Quick Inline Approval Actions (only show for users actually pending approval) */}
                                            {((user.is_approved === false || user.approval_status === 'pending') && user.approval_status !== 'rejected') && (
                                                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => handleApproveUser(user)}
                                                        disabled={approvingUserId === user.id}
                                                        title="Approve user registration"
                                                        className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
                                                    >
                                                        <Check className="w-3 h-3" />
                                                        {approvingUserId === user.id ? 'Approving...' : 'Approve'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectUser(user)}
                                                        disabled={approvingUserId === user.id}
                                                        title="Reject user registration"
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[10px] font-black uppercase tracking-wider rounded-lg border border-rose-200 transition-all cursor-pointer disabled:opacity-50"
                                                    >
                                                        <X className="w-3 h-3" />
                                                        Reject
                                                    </button>
                                                </div>
                                            )}

                                            {/* Approver Audit Info Display */}
                                            {user.is_approved && user.approverName && (
                                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                                                    <Check className="w-3 h-3 text-emerald-600" />
                                                    Approved by <strong className="text-slate-800 font-bold">{user.approverName}</strong>
                                                    {user.approved_at && ` on ${new Date(user.approved_at).toLocaleDateString()}`}
                                                </span>
                                            )}

                                            {/* Edit Role Logic */}
                                            {editingUserId === user.id ? (
                                                <div className="flex flex-col gap-3 min-w-[220px] bg-slate-50 p-4 rounded-2xl border border-slate-200 mt-3 relative z-10 animate-in fade-in slide-in-from-top-2 duration-200">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <select
                                                            value={editingRole}
                                                            onChange={(e) => setEditingRole(e.target.value)}
                                                            className="flex-1 px-2 py-1.5 text-[10px] font-black uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200 bg-white"
                                                        >
                                                            {roleOptions.map(role => (
                                                                <option key={role} value={role}>{formatRole(role)}</option>
                                                            ))}
                                                        </select>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => {
                                                                    handleUpdateRole(user.id, editingRole);
                                                                }}
                                                                disabled={isUpdating}
                                                                className="p-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50"
                                                            >
                                                                <Check className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingUserId(null);
                                                                    setEditingSkills([]);
                                                                }}
                                                                className="p-1.5 bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-200 transition-colors"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {(editingRole === 'mst' || editingRole === 'staff') && (
                                                        <div className="space-y-2 pt-2 border-t border-slate-100">
                                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Selected Skills</p>
                                                            <div className="space-y-1">
                                                                {SKILL_OPTIONS[editingRole].map((skill) => {
                                                                    const isSelected = editingSkills.includes(skill.code);
                                                                    return (
                                                                        <button
                                                                            key={skill.code}
                                                                            type="button"
                                                                            onClick={() => toggleSkill(skill.code)}
                                                                            className={`w-full flex items-center justify-between p-1.5 rounded-lg text-[10px] font-bold transition-all ${isSelected
                                                                                ? 'bg-slate-900 text-white'
                                                                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                                                                }`}
                                                                        >
                                                                            <span>{skill.label}</span>
                                                                            {isSelected && <Check className="w-3 h-3 text-emerald-400" />}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => handleStartEdit(user)}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wider rounded-lg border border-slate-200 hover:bg-slate-200 transition-colors"
                                                >
                                                    <Edit2 className="w-3 h-3" />
                                                    Edit Role
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Side: Action Buttons */}
                                <div className="flex items-center gap-2 shrink-0 md:self-center" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => handleResetPassword(user.id, user.email)}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        Reset Password
                                    </button>
                                    <button
                                        onClick={() => handleDeleteUser(user.id, user.full_name)}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-rose-500 text-white font-bold text-xs rounded-xl hover:bg-rose-600 transition-colors shadow-md shadow-rose-100"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Add Member Modal */}
            {orgId && (
                <InviteMemberModal
                    isOpen={showInviteModal}
                    onClose={() => setShowInviteModal(false)}
                    orgId={orgId}
                    orgName={orgName || 'Organization'}
                    properties={properties}
                    onSuccess={() => {
                        fetchUsers();
                        showToast('Member account created successfully!');
                    }}
                />
            )}

            {/* Super Tenant — Add/Change Properties Modal */}
            <AnimatePresence>
                {superTenantUser && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4"
                        onClick={() => setSuperTenantUser(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            className="bg-surface rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-border"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="bg-secondary p-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                        <Key className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-black text-lg">Manage Properties</h3>
                                        <p className="text-white/70 text-sm font-medium">{superTenantUser.full_name}</p>
                                    </div>
                                </div>
                                <button onClick={() => setSuperTenantUser(null)} className="text-white/70 hover:text-white transition-smooth">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-text-secondary font-medium">Select additional properties to assign to this Super Client.</p>
                                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                                    {properties.map(prop => {
                                        const alreadyAssigned = (superTenantPropsMap[superTenantUser.id] || []).some(p => p.property_id === prop.id);
                                        const isSelected = superTenantSelectedProps.includes(prop.id);
                                        return (
                                            <button
                                                key={prop.id}
                                                type="button"
                                                disabled={alreadyAssigned}
                                                onClick={() => setSuperTenantSelectedProps(prev =>
                                                    isSelected ? prev.filter(id => id !== prop.id) : [...prev, prop.id]
                                                )}
                                                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-bold transition-smooth ${alreadyAssigned
                                                    ? 'bg-surface-elevated border-border text-text-tertiary cursor-not-allowed'
                                                    : isSelected
                                                        ? 'bg-primary/10 border-primary text-primary'
                                                        : 'bg-surface-elevated border-border text-text-secondary hover:border-primary hover:bg-primary/10'
                                                    }`}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <Building2 className="w-4 h-4" />
                                                    {prop.name}
                                                </span>
                                                {alreadyAssigned
                                                    ? <span className="text-[10px] text-text-tertiary font-black uppercase">Assigned</span>
                                                    : isSelected && <Check className="w-4 h-4 text-primary" />
                                                }
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => setSuperTenantUser(null)} className="flex-1 px-4 py-3 border border-border text-text-secondary font-bold text-sm rounded-xl hover:bg-surface-elevated transition-smooth">Cancel</button>
                                    <button
                                        onClick={handleAssignSuperTenant}
                                        disabled={superTenantSelectedProps.length === 0 || isAssigningST}
                                        className="flex-1 px-4 py-3 bg-secondary text-white font-black text-sm rounded-xl hover:bg-secondary-dark transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isAssigningST ? 'Saving...' : `Add ${superTenantSelectedProps.length || ''} Propert${superTenantSelectedProps.length === 1 ? 'y' : 'ies'}`}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Property Admin — Assign Property Modal */}
            <AnimatePresence>
                {propAssignUser && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4"
                        onClick={() => setPropAssignUser(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            className="bg-surface rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-border"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="bg-primary p-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                        <Building2 className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-black text-lg">Assign Property</h3>
                                        <p className="text-white/70 text-sm font-medium">{propAssignUser.full_name}</p>
                                    </div>
                                </div>
                                <button onClick={() => setPropAssignUser(null)} className="text-white/70 hover:text-white transition-smooth">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-text-secondary font-medium">Select a property and role to assign to this user.</p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-[10px] font-black text-text-tertiary uppercase tracking-widest mb-1 block">Property</label>
                                        <select
                                            value={propAssignSelectedPropId}
                                            onChange={(e) => setPropAssignSelectedPropId(e.target.value)}
                                            className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-xl text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                        >
                                            <option value="">Select a property...</option>
                                            {properties
                                                .filter(p => !(propAssignPropsMap[propAssignUser.id] || []).some(ap => ap.property_id === p.id))
                                                .map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))
                                            }
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-text-tertiary uppercase tracking-widest mb-1 block">Role</label>
                                        <select
                                            value={propAssignRole}
                                            onChange={(e) => setPropAssignRole(e.target.value)}
                                            className="w-full px-4 py-3 bg-surface-elevated border border-border rounded-xl text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                        >
                                            <option value="property_admin">Property Admin</option>
                                            <option value="tenant">Client / Tenant</option>
                                            <option value="staff">Staff</option>
                                            <option value="mst">MST</option>
                                            <option value="security">Security</option>
                                            <option value="soft_service_manager">Soft Service Manager</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => setPropAssignUser(null)} className="flex-1 px-4 py-3 border border-border text-text-secondary font-bold text-sm rounded-xl hover:bg-surface-elevated transition-smooth">Cancel</button>
                                    <button
                                        onClick={handleAddPropAssignment}
                                        disabled={!propAssignSelectedPropId || isAssigningProp}
                                        className="flex-1 px-4 py-3 bg-primary text-white font-black text-sm rounded-xl hover:opacity-90 transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isAssigningProp ? 'Assigning...' : 'Assign Property'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.9 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100]"
                    >
                        <div className={`px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border ${toast.type === 'success'
                            ? 'bg-emerald-900 border-emerald-500/50 text-emerald-50'
                            : 'bg-rose-900 border-rose-500/50 text-rose-50'
                            }`}>
                            <span className="font-bold text-sm tracking-tight">{toast.message}</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* User Profile Modal */}
            <AnimatePresence>
                {selectedUserForProfile && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4"
                        onClick={() => setSelectedUserForProfile(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="bg-white border border-slate-100 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Card Header with Autopilot Logo */}
                            <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-8 flex flex-col items-center">
                                {/* Autopilot Logo */}
                                <div className="flex items-center justify-center mb-6">
                                    <img
                                        src="/autopilot-logo-new.png"
                                        alt="Autopilot Logo"
                                        className="h-10 w-auto object-contain invert mix-blend-screen"
                                    />
                                </div>

                                {/* User Avatar */}
                                <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center border-4 border-white/20 mb-4 overflow-hidden shadow-xl">
                                    {selectedUserForProfile.user_photo_url || selectedUserForProfile.avatar_url ? (
                                        <img
                                            src={selectedUserForProfile.user_photo_url || selectedUserForProfile.avatar_url}
                                            alt="Profile"
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span className="text-4xl font-black text-white">
                                            {selectedUserForProfile.full_name?.[0]?.toUpperCase() || 'U'}
                                        </span>
                                    )}
                                </div>

                                {/* Role Badge */}
                                <span className="px-4 py-1.5 bg-amber-500 text-slate-900 rounded-full text-xs font-black uppercase tracking-wider shadow-lg">
                                    {formatRole(selectedUserForProfile.orgRole || selectedUserForProfile.propertyRole || 'User')}
                                </span>
                            </div>

                            {/* Card Body with User Info */}
                            <div className="p-8 space-y-6">
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Full Name</span>
                                        <span className="text-sm font-bold text-slate-900">
                                            {selectedUserForProfile.full_name}
                                        </span>
                                    </div>

                                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone</span>
                                        <span className="text-sm font-bold text-slate-900">
                                            {selectedUserForProfile.phone || 'Not Set'}
                                        </span>
                                    </div>

                                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</span>
                                        <span className="text-sm font-medium text-slate-700 truncate max-w-[200px]">
                                            {selectedUserForProfile.email}
                                        </span>
                                    </div>

                                    {selectedUserForProfile.propertyName && (
                                        <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Property</span>
                                            <span className="text-sm font-bold text-slate-900">
                                                {selectedUserForProfile.propertyName}
                                            </span>
                                        </div>
                                    )}

                                    {/* Approval Audit Information */}
                                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Approval Status</span>
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                            selectedUserForProfile.approval_status === 'rejected'
                                                ? 'bg-rose-100 text-rose-800'
                                                : selectedUserForProfile.is_approved
                                                    ? 'bg-emerald-100 text-emerald-800'
                                                    : 'bg-amber-100 text-amber-800'
                                        }`}>
                                            {selectedUserForProfile.approval_status === 'rejected'
                                                ? 'Rejected'
                                                : selectedUserForProfile.is_approved
                                                    ? 'Approved'
                                                    : 'Pending Approval'}
                                        </span>
                                    </div>

                                    {selectedUserForProfile.is_approved && selectedUserForProfile.approverName && (
                                        <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Approved By</span>
                                            <span className="text-sm font-bold text-slate-900">
                                                {selectedUserForProfile.approverName}
                                            </span>
                                        </div>
                                    )}

                                    {selectedUserForProfile.approved_at && (
                                        <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Approved On</span>
                                            <span className="text-xs font-semibold text-slate-700">
                                                {new Date(selectedUserForProfile.approved_at).toLocaleString()}
                                            </span>
                                        </div>
                                    )}

                                    {selectedUserForProfile.rejection_reason && (
                                        <div className="py-2 px-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                                            <strong>Reason:</strong> {selectedUserForProfile.rejection_reason}
                                        </div>
                                    )}

                                    {/* Quick Actions if Pending */}
                                    {((selectedUserForProfile.is_approved === false || selectedUserForProfile.approval_status === 'pending') && selectedUserForProfile.approval_status !== 'rejected') && (
                                        <div className="flex gap-2 pt-2">
                                            <button
                                                onClick={() => handleApproveUser(selectedUserForProfile)}
                                                disabled={approvingUserId === selectedUserForProfile.id}
                                                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                            >
                                                <Check className="w-4 h-4" />
                                                {approvingUserId === selectedUserForProfile.id ? 'Approving...' : 'Approve Access'}
                                            </button>
                                            <button
                                                onClick={() => handleRejectUser(selectedUserForProfile)}
                                                disabled={approvingUserId === selectedUserForProfile.id}
                                                className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-black text-xs uppercase tracking-wider rounded-xl border border-rose-200 transition-all cursor-pointer disabled:opacity-50"
                                            >
                                                <X className="w-4 h-4" />
                                                Reject
                                            </button>
                                        </div>
                                    )}

                                    <div className="pt-4 flex justify-center">
                                        <button
                                            onClick={() => setSelectedUserForProfile(null)}
                                            className="px-8 py-2.5 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all w-full cursor-pointer"
                                        >
                                            Done
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Client QR Generator Modal */}
            <ClientQRGeneratorModal
                isOpen={showClientQRModal}
                onClose={() => setShowClientQRModal(false)}
                propertyId={propertyId || (properties && properties.length > 0 ? properties[0].id : '')}
                propertyName={(properties && properties.find(p => p.id === (propertyId || properties[0]?.id))?.name) || 'Property Workspace'}
            />
        </div>
    );
};

export default UserDirectory;
