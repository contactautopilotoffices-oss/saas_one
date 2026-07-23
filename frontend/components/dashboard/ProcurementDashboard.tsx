'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@utils/supabase/client';
import { 
    LayoutDashboard, Package, ShoppingCart, CheckCircle2, 
    Settings, UserCircle, LogOut, Search, Filter, 
    ChevronDown, ChevronRight, Building2, Calendar, Menu, X,
    ArrowUpRight, Scan, Truck, RefreshCw, Box, Clock,
    AlertCircle, ExternalLink, Trash2, Camera, Link2, Shield, User, Loader2, FileText, MessageSquarePlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import NotificationBell from './NotificationBell';
import ProcurementPOProcessor from '../procurement/ProcurementPOProcessor';
import ProcurementStatusModal from './ProcurementStatusModal';
import ProcurementCatalogModal from '../procurement/ProcurementCatalogModal';
import FeedbackModal from '@/frontend/components/ui/FeedbackModal';

// --- Types ---
interface MaterialRequest {
    id: string;
    ticket_id: string;
    status: string;
    requested_by: string;
    assignee_uid: string;
    created_at: string;
    updated_at: string;
    delivered_at?: string;
    total_amount?: number;
    total_estimated_cost?: number;
    quotation_file_url?: string;
    items?: any[];
    line_items?: any[];
    ticket?: {
        ticket_number: string;
        title: string;
        priority: string;
    };
    property?: {
        id: string;
        name: string;
    };
    requester?: {
        full_name: string;
    };
    assignee?: {
        full_name: string;
    };
}

type Tab = 'overview' | 'requests' | 'history' | 'manage-items' | 'po-generator' | 'settings' | 'profile';

export default function ProcurementDashboard() {
    const supabase = createClient();
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [user, setUser] = useState<any>(null);
    const [requests, setRequests] = useState<MaterialRequest[]>([]);
    const [activities, setActivities] = useState<any[]>([]);
    const [procurementUsers, setProcurementUsers] = useState<any[]>([]);
    const [allProperties, setAllProperties] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [statusFilter, setStatusFilter] = useState('all');
    const [propertyFilter, setPropertyFilter] = useState('all');
    const [timeRange, setTimeRange] = useState<'today' | 'month' | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [reassigningId, setReassigningId] = useState<string | null>(null);
    const [statusModalOpen, setStatusModalOpen] = useState(false);
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [deleteRequestData, setDeleteRequestData] = useState<{ id: string; requesterId: string } | null>(null);
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [notification, setNotification] = useState<{ message: string; type: string } | null>(null);

    const isProcurementRole = true; // Simplified for now

    // --- Helpers ---
    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 3000);
    };

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
        };
        getUser();
    }, [supabase]);

    const shouldShowPrice = useMemo(() => {
        return requests.length > 0 && requests.some(r => (r.total_amount !== null && r.total_amount !== undefined) || (r.total_estimated_cost !== null && r.total_estimated_cost !== undefined));
    }, [requests]);

    // --- Fetching Logic ---
    const fetchRequests = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/procurement/tickets');
            if (res.ok) {
                const data = await res.json();
                setRequests(data || []);
            }
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchActivities = useCallback(async () => {
        try {
            const res = await fetch('/api/procurement/activity');
            if (res.ok) {
                const data = await res.json();
                setActivities(data || []);
            }
        } catch (err) {
            console.error('Activities fetch error:', err);
        }
    }, []);

    const fetchProcurementUsers = useCallback(async () => {
        try {
            const res = await fetch('/api/procurement/users');
            if (res.ok) {
                const data = await res.json();
                setProcurementUsers(data || []);
            }
        } catch (err) {
            console.error('Procurement users fetch error:', err);
        }
    }, []);

    const fetchProperties = useCallback(async () => {
        try {
            const { data } = await supabase
                .from('properties')
                .select('id, name')
                .order('name');
            if (data) {
                setAllProperties(data);
            }
        } catch (err) {
            console.error('Properties fetch error:', err);
        }
    }, [supabase]);

    useEffect(() => {
        fetchRequests();
        fetchActivities();
        fetchProcurementUsers();
        fetchProperties();
    }, [fetchRequests, fetchActivities, fetchProcurementUsers, fetchProperties]);

    // --- Handlers ---
    const handleDeleteRequest = async (requestId: string, requesterId: string) => {
        if (user?.id !== requesterId) {
            showToast('Only the creator can delete the request', 'error');
            return;
        }
        setDeleteRequestData({ id: requestId, requesterId });
    };

    const executeDeleteRequest = async () => {
        if (!deleteRequestData) return;
        try {
            setUpdatingId(deleteRequestData.id);
            const res = await fetch(`/api/procurement/requests/${deleteRequestData.id}`, {
                method: 'DELETE'
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || err.error || 'Failed to delete request');
            }
            showToast('Material request deleted', 'success');
            await fetchRequests();
            await fetchActivities();
        } catch (error: any) {
            console.error('Delete Error:', error);
            showToast(error.message, 'error');
        } finally {
            setUpdatingId(null);
            setDeleteRequestData(null);
        }
    };

    const updateStatus = async (requestId: string, newStatus: string, ticketId: string) => {
        setUpdatingId(requestId);
        try {
            const res = await fetch(`/api/tickets/${ticketId}/materials`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ material_id: requestId, status: newStatus })
            });
            if (res.ok) {
                setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: newStatus } : r));
                fetchActivities();
                showToast(`Request marked as ${newStatus}`, 'success');
            }
        } catch (err) {
            console.error('Update error:', err);
            showToast('Failed to update status', 'error');
        } finally {
            setUpdatingId(null);
        }
    };

    const handleReassign = async (requestId: string, newAssigneeId: string) => {
        setUpdatingId(requestId);
        try {
            const res = await fetch('/api/procurement/requests', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, assignee_uid: newAssigneeId })
            });
            if (res.ok) {
                setRequests(prev => prev.map(r => 
                    r.id === requestId 
                        ? { ...r, assignee_uid: newAssigneeId, assignee: { ...r.assignee, full_name: procurementUsers.find(u => u.id === newAssigneeId)?.full_name || 'Assigned' } } 
                        : r
                ));
                setReassigningId(null);
                showToast('Staff reassigned successfully', 'success');
            }
        } catch (err) {
            console.error('Reassign error:', err);
            showToast('Failed to reassign', 'error');
        } finally {
            setUpdatingId(null);
        }
    };

    // --- Memos ---
    const handleOpenStatusModal = (requestId: string, ticketId: string) => {
        setSelectedRequestId(requestId);
        setSelectedTicketId(ticketId);
        setStatusModalOpen(true);
    };
    const requestProperties = useMemo(() => {
        const map = new Map<string, string>();
        requests.forEach(r => {
            if (r.property?.id && r.property?.name) {
                map.set(r.property.id, r.property.name);
            }
        });
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [requests]);

    const dropdownProperties = allProperties.length > 0 ? allProperties : requestProperties;

    const baseRequests = useMemo(() => {
        return requests.filter(r => {
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matchesSearch =
                    r.ticket?.ticket_number?.toLowerCase().includes(q) ||
                    r.ticket?.title?.toLowerCase().includes(q) ||
                    r.property?.name?.toLowerCase().includes(q) ||
                    (r.items || []).some((i: any) => i.name?.toLowerCase().includes(q)) ||
                    (r.line_items || []).some((i: any) => i.name?.toLowerCase().includes(q));
                if (!matchesSearch) return false;
            }

            if (propertyFilter !== 'all' && r.property?.id !== propertyFilter) return false;

            const createdDate = new Date(r.created_at);
            const now = new Date();
            if (timeRange === 'today') {
                if (createdDate.toDateString() !== now.toDateString()) return false;
            } else if (timeRange === 'month') {
                if (createdDate.getMonth() !== now.getMonth() || createdDate.getFullYear() !== now.getFullYear()) return false;
            }

            return true;
        });
    }, [requests, searchQuery, propertyFilter, timeRange]);

    const stats = useMemo(() => {
        const visibleRequests = baseRequests;
        
        const deliveryTimes = visibleRequests
            .filter(r => r.status === 'delivered' && r.delivered_at)
            .map(r => (new Date(r.delivered_at!).getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
        
        const avgLeadTime = deliveryTimes.length > 0 
            ? (deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length).toFixed(1) 
            : '2.4';

        const totalSavings = visibleRequests
            .filter(r => r.status === 'delivered')
            .reduce((acc, r) => acc + (Math.max(0, (r.total_estimated_cost || 0) - (r.total_amount || 0))), 0);

        return {
            total: visibleRequests.length,
            pending: visibleRequests.filter(r => r.status === 'pending_quotation').length,
            ordered: visibleRequests.filter(r => r.status === 'ordered').length,
            delivered: visibleRequests.filter(r => r.status === 'delivered').length,
            totalValue: visibleRequests.reduce((acc, r) => acc + (r.total_amount ?? r.total_estimated_cost ?? 0), 0),
            pendingValue: visibleRequests.filter(r => r.status === 'ordered').reduce((acc, r) => acc + (r.total_amount ?? 0), 0),
            fulfillmentRate: visibleRequests.length > 0 
                ? Math.round((visibleRequests.filter(r => r.status === 'delivered').length / visibleRequests.length) * 100) 
                : 100,
            avgLeadTime,
            criticalRequests: visibleRequests.filter(r => ['high', 'urgent'].includes(r.ticket?.priority?.toLowerCase() || '')).length,
            totalSavings
        };
    }, [baseRequests]);

    const filteredActivities = useMemo(() => {
        return activities.filter(log => {
            const logDate = new Date(log.created_at);
            const now = new Date();
            if (timeRange === 'today') {
                if (logDate.toDateString() !== now.toDateString()) return false;
            } else if (timeRange === 'month') {
                if (logDate.getMonth() !== now.getMonth() || logDate.getFullYear() !== now.getFullYear()) return false;
            }
            if (propertyFilter !== 'all' && log.material_request?.property_id !== propertyFilter) return false;
            return true;
        });
    }, [activities, timeRange, propertyFilter]);

    const tabCounts = useMemo(() => {
        const matchesStatusTab = (r: MaterialRequest, filter: string) => {
            if (filter === 'all') return true;
            if (filter === 'pending') return r.status?.toLowerCase() === 'approved' || r.status?.toLowerCase().includes('pending');
            return r.status?.toLowerCase() === filter.toLowerCase();
        };
        return {
            all: baseRequests.length,
            pending: baseRequests.filter(r => matchesStatusTab(r, 'pending')).length,
            ordered: baseRequests.filter(r => matchesStatusTab(r, 'ordered')).length,
            delivered: baseRequests.filter(r => matchesStatusTab(r, 'delivered')).length,
        };
    }, [baseRequests]);

    const filteredRequests = useMemo(() => {
        const matchesStatusTab = (r: MaterialRequest, filter: string) => {
            if (filter === 'all') return true;
            if (filter === 'pending') return r.status?.toLowerCase() === 'approved' || r.status?.toLowerCase().includes('pending');
            return r.status?.toLowerCase() === filter.toLowerCase();
        };
        return baseRequests.filter(r => matchesStatusTab(r, statusFilter));
    }, [baseRequests, statusFilter]);

    // --- Main Render ---
    return (
        <div className="min-h-screen bg-slate-50 flex font-inter text-slate-900 overflow-hidden">
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        onClick={() => setSidebarOpen(false)}
                        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
                    />
                )}
            </AnimatePresence>

            <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-slate-300 transition-transform duration-300 transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
                <Toast 
                    message={notification?.message || ''} 
                    type={notification?.type || 'info'} 
                    visible={!!notification} 
                    onClose={() => setNotification(null)} 
                />
                
                <ConfirmModal 
                    isOpen={!!deleteRequestData}
                    onClose={() => setDeleteRequestData(null)}
                    onConfirm={executeDeleteRequest}
                    title="Delete Request"
                    message="Are you sure you want to delete this material request? This action cannot be undone."
                    confirmText="Yes, Delete"
                    cancelText="Keep Request"
                    type="danger"
                    isLoading={!!updatingId}
                />
        {/* Status Update Modal */}
        <ProcurementStatusModal
          isOpen={statusModalOpen}
          onClose={() => setStatusModalOpen(false)}
          requestId={selectedRequestId || ''}
          onConfirm={async (status, quotedPrice, quotationUrl) => {
            if (!selectedRequestId) return;
            try {
                const res = await fetch(`/api/procurement/requests/${selectedRequestId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status, quoted_price: quotedPrice, quotation_file_url: quotationUrl })
                });
                if (!res.ok) {
                  const errData = await res.json();
                  const errMsg = errData.error || errData.message || 'Failed to update request';
                  throw new Error(errMsg);
                }
                await fetchRequests();
                await fetchActivities();
                setNotification({ message: 'Order confirmed successfully', type: 'success' });
            } catch (err) {
              console.error(err);
            } finally {
              setStatusModalOpen(false);
            }
          }}
        />

                <div className="h-full flex flex-col pt-4">
                    <button onClick={() => setSidebarOpen(false)} className="absolute top-4 right-4 lg:hidden p-2 rounded-lg hover:bg-slate-100 transition-colors">
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                    <div className="px-10 mb-10 mt-6 flex flex-col items-start">
                        <img src="/autopilot-logo-new.png" alt="Autopilot" className="h-10 w-auto object-contain mb-1" />
                        <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.4em] leading-relaxed mb-6">Procurement</p>
                        <div className="h-[2px] w-full bg-slate-100 mb-6 hidden lg:block" />
                    </div>

                    <nav className="flex-1 px-4 overflow-y-auto min-h-0 custom-scrollbar">
                        <div className="mb-8">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-4 mb-3 flex items-center gap-2">
                                <span className="w-0.5 h-3 bg-primary rounded-full"></span>
                                Core Operations
                            </p>
                            <div className="space-y-1">
                                {[
                                    { id: 'overview', icon: LayoutDashboard, label: 'Dashboard' },
                                    { id: 'requests', icon: Package, label: 'Active Orders' },
                                    { id: 'history', icon: CheckCircle2, label: 'Order History' },
                                    { id: 'manage-items', icon: ShoppingCart, label: 'Manage Items' },
                                    { id: 'po-generator', icon: FileText, label: 'PO Generator' },
                                ].map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => { setActiveTab(item.id as Tab); setSidebarOpen(false); }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === item.id 
                                            ? 'bg-primary text-white shadow-md' 
                                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
                                    >
                                        <item.icon className="w-4 h-4" />
                                        {item.label}
                                        {item.id === 'po-generator' && (
                                            <span className="ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-100 text-amber-600 uppercase tracking-wider">
                                                Coming Soon
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mb-8">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-4 mb-3 flex items-center gap-2">
                                <span className="w-0.5 h-3 bg-slate-300 rounded-full"></span>
                                System & Personal
                            </p>
                            <div className="space-y-1">
                                {[
                                    { id: 'settings', icon: Settings, label: 'Settings' },
                                    { id: 'profile', icon: UserCircle, label: 'Profile' },
                                ].map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => { setActiveTab(item.id as Tab); setSidebarOpen(false); }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === item.id 
                                            ? 'bg-primary text-white shadow-md' 
                                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
                                    >
                                        <item.icon className="w-4 h-4" />
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </nav>

                    <div className="px-6 py-6 border-t border-slate-100 mt-auto flex-shrink-0 bg-slate-50/50">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-primary font-black shadow-sm border border-slate-200 text-lg">
                                {user?.email?.[0].toUpperCase() || 'P'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-black text-slate-900 truncate">{user?.user_metadata?.full_name || 'Procurement User'}</p>
                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Access: Procurement</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <button onClick={() => setShowFeedbackModal(true)} className="flex items-center gap-2 text-slate-500 hover:text-primary transition-all font-black text-[10px] uppercase tracking-widest group">
                                <MessageSquarePlus className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                                Feedback
                            </button>

            <FeedbackModal isOpen={showFeedbackModal} onClose={() => setShowFeedbackModal(false)} />

                            <button onClick={() => setShowSignOutModal(true)} className="flex items-center gap-2 text-rose-500 hover:text-rose-600 transition-all font-black text-[10px] uppercase tracking-widest group">
                                <LogOut className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </aside>

            <main className="flex-1 lg:ml-72 min-h-screen flex flex-col bg-slate-50 overflow-y-auto">
                <header className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40 px-8 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-xl">
                            <Menu className="w-6 h-6" />
                        </button>
                        <div className="hidden xl:block">
                            <h1 className="text-2xl font-black text-slate-900 leading-none mb-1 capitalize">
                                {activeTab.replace(/-/g, ' ')}
                            </h1>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                                {activeTab === 'overview' ? 'Operational Overview' : 
                                 activeTab === 'manage-items' ? `Catalog · ${stats.total} Items` :
                                 activeTab === 'po-generator' ? 'AI Purchase Order Processor' :
                                 `Awaiting Fulfillment · ${stats.pending} Items`}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="hidden lg:flex items-center gap-4">
                            {dropdownProperties.length > 0 && (
                                <div className="relative">
                                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <select
                                        value={propertyFilter}
                                        onChange={(e) => setPropertyFilter(e.target.value)}
                                        className="pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-700 outline-none focus:ring-4 focus:ring-primary/10 transition-all appearance-none cursor-pointer min-w-[180px]"
                                    >
                                        <option value="all">All Properties</option>
                                        {dropdownProperties.map((p: any) => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                                </div>
                            )}

                            <div className="relative w-64 xl:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                                <input
                                    type="text"
                                    placeholder="Global Search..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold placeholder:text-slate-300 outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <NotificationBell />
                            <div className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 font-black text-sm">
                                {user?.email?.[0].toUpperCase() || 'P'}
                            </div>
                        </div>
                    </div>
                </header>

                <div className="p-8">
                    <AnimatePresence mode="wait">
                        {activeTab === 'overview' && (
                            <OverviewTab 
                                stats={stats} 
                                activities={filteredActivities} 
                                shouldShowPrice={shouldShowPrice} 
                                onRefreshActivities={fetchActivities} 
                                onNavigate={(tab: Tab, filter: string) => {
                                    setActiveTab(tab);
                                    setStatusFilter(filter);
                                }}
                            />
                        )}
                        {activeTab === 'requests' && (
                            <RequestsTab 
                                requests={filteredRequests}
                                statusFilter={statusFilter}
                                setStatusFilter={setStatusFilter}
                                searchQuery={searchQuery}
                                setSearchQuery={setSearchQuery}
                                tabCounts={tabCounts}
                                updatingId={updatingId}
                                reassigningId={reassigningId}
                                setReassigningId={setReassigningId}
                                onUpdateStatus={updateStatus}
                                onReassign={handleReassign}
                                onDeleteRequest={handleDeleteRequest}
                                procurementUsers={procurementUsers}
                                user={user}
                                shouldShowPrice={shouldShowPrice}
                                statusModalOpen={statusModalOpen}
                                setStatusModalOpen={setStatusModalOpen}
                                selectedRequestId={selectedRequestId}
                                setSelectedRequestId={setSelectedRequestId}
                                handleOpenStatusModal={handleOpenStatusModal}
                            />
                        )}
                                                {activeTab === 'history' && <HistoryTab requests={requests} user={user} />}
                        {activeTab === 'manage-items' && (
                            <ManageItemsTab 
                                organizationId={user?.user_metadata?.organization_id} 
                                propertyId={propertyFilter === 'all' ? '' : propertyFilter}
                                isProcurementUser={isProcurementRole}
                            />
                        )}
                        {activeTab === 'po-generator' && (
                            <div className="py-8">
                                <ProcurementPOProcessor organizationId={user?.user_metadata?.organization_id} />
                            </div>
                        )}
                        {activeTab === 'settings' && <PlaceholderTab title="Settings" icon={Settings} desc="Configure procurement thresholds and approval workflows." />}
                        {activeTab === 'profile' && <ProfileTab user={user} />}
                    </AnimatePresence>
                </div>
            </main>

            <SignOutModal isOpen={showSignOutModal} onClose={() => setShowSignOutModal(false)} onConfirm={async () => {
                await supabase.auth.signOut();
                window.location.replace('/login');
            }} />
        </div>
    );
}

// --- Subcomponents ---

function OverviewTab({ stats, activities, shouldShowPrice, onRefreshActivities, onNavigate }: any) {
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
            {/* KPI Cards - Full Width Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Requests" value={stats.total} icon={FileText} color="indigo" subLabel="All Material Requests" onClick={() => onNavigate('requests', 'all')} />
                <StatCard label="Pending" value={stats.pending} icon={Clock} color="amber" subLabel="Awaiting Fulfillment" onClick={() => onNavigate('requests', 'pending')} />
                <StatCard label="Ordered" value={stats.ordered} icon={Truck} color="blue" subLabel="In Transit / Placed" onClick={() => onNavigate('requests', 'ordered')} />
                <StatCard label="Delivered" value={stats.delivered} icon={CheckCircle2} color="emerald" subLabel="Successfully Fulfilled" onClick={() => onNavigate('requests', 'delivered')} />
            </div>

            {/* Recent Activity + Quick Insights */}
            <div className="grid lg:grid-cols-4 gap-8">
                {/* Recent Activity - Left (larger) */}
                <div className="lg:col-span-3">
                    <div className="bg-white rounded-[40px] border border-slate-200 p-8 shadow-sm">
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-xl font-black text-slate-900 tracking-tight">Recent Activity</h3>
                            <button onClick={onRefreshActivities} className="p-2 text-slate-400 hover:text-primary hover:bg-slate-50 rounded-lg transition-all">
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="space-y-1">
                            {activities.length > 0 ? (
                                activities.map((log: any, i: number) => (
                                    <ActivityRow key={i} log={log} />
                                ))
                            ) : (
                                <div className="text-center py-20 bg-slate-50 rounded-[32px] border border-dashed border-slate-200">
                                    <p className="text-slate-300 italic text-sm">No recent activity detected.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Quick Insights - Right (smaller box) */}
                <div className="lg:col-span-1">
                    <div className="bg-gradient-to-br from-indigo-900 to-indigo-700 rounded-[32px] p-6 text-white shadow-xl relative overflow-hidden group h-fit">
                        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -mr-20 -mt-20 blur-2xl group-hover:scale-110 transition-transform duration-700" />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] mb-8 text-indigo-200 relative z-10">Quick Insights</h3>
                        
                        <div className="space-y-6 relative z-10">
                            <div className="bg-white/10 rounded-2xl p-5 backdrop-blur-sm">
                                <p className="text-[9px] font-black text-indigo-200 uppercase tracking-widest mb-2">Success Rate</p>
                                <div className="flex items-end gap-3 mb-2">
                                    <span className="text-2xl font-black tracking-tighter">{stats.fulfillmentRate}%</span>
                                </div>
                                <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                                    <motion.div 
                                        initial={{ width: 0 }} 
                                        animate={{ width: `${stats.fulfillmentRate}%` }} 
                                        className="h-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.3)]" 
                                    />
                                </div>
                            </div>

                            <div className="bg-white/10 rounded-2xl p-5 backdrop-blur-sm">
                                <p className="text-[9px] font-black text-indigo-200 uppercase tracking-widest mb-2">Average Delivery</p>
                                <div className="flex items-end gap-3">
                                    <span className="text-2xl font-black tracking-tighter">{stats.avgLeadTime} Days</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function ActivityRow({ log }: any) {
    const timeAgo = (date: string) => {
        const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}M AGO`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}H AGO`;
        const days = Math.floor(hours / 24);
        return `${days}D AGO`;
    };

    const isDelivered = log.action === 'delivered' || log.metadata?.new_status === 'delivered';
    const isOrdered = log.action === 'ordered' || log.metadata?.new_status === 'ordered';
    const ticket = log.material_request?.ticket || log.metadata?.ticket || {};

    return (
        <div className="flex items-center gap-6 p-4 rounded-3xl hover:bg-slate-50 transition-all group">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${
                isDelivered ? 'bg-emerald-50 border-emerald-100 text-emerald-500' : 
                isOrdered ? 'bg-blue-50 border-blue-100 text-blue-500' : 
                'bg-slate-50 border-slate-100 text-slate-400'
            }`}>
                {isDelivered ? <CheckCircle2 className="w-5 h-5" /> : <Box className="w-5 h-5" />}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">{ticket.ticket_number || 'TKT-REQ'}</span>
                    <span className="text-slate-300 text-[10px] font-black">•</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{log.action.replace(/_/g, ' ')}</span>
                </div>
                <h4 className="text-xs font-bold text-slate-600 line-clamp-1 mb-1 leading-tight">{ticket.title || 'Material Request Update'}</h4>
                <div className="flex items-center gap-3 text-[9px] font-black text-slate-300 uppercase tracking-widest">
                    <span>{log.material_request?.property?.name || 'Property'}</span>
                    <span>•</span>
                    <span>{log.profiles?.full_name || 'System'}</span>
                </div>
                
                {log.metadata?.old_status && log.metadata?.new_status && (
                    <div className="flex items-center gap-2 mt-2">
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded text-[7px] font-black uppercase tracking-widest">{log.metadata.old_status}</span>
                        <ChevronRight className="w-2 h-2 text-slate-300" />
                        <span className={`px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest ${
                            log.metadata.new_status === 'delivered' ? 'bg-emerald-50 text-emerald-500' : 'bg-blue-50 text-blue-500'
                        }`}>{log.metadata.new_status}</span>
                    </div>
                )}
            </div>

            <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest whitespace-nowrap">
                {timeAgo(log.created_at)}
            </div>
        </div>
    );
}

function ManageItemsTab({ organizationId, propertyId, isProcurementUser }: any) {
    const [showModal, setShowModal] = useState(true);

    return (
        <div className="relative min-h-[80vh]">
            <ProcurementCatalogModal 
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                ticketId="dashboard_catalog_management"
                propertyId={propertyId}
                organizationId={organizationId}
                isProcurementUser={isProcurementUser}
            />
            {!showModal && (
                <div className="flex flex-col items-center justify-center py-32 text-center">
                    <div className="w-20 h-20 bg-slate-100 rounded-[2.5rem] flex items-center justify-center mb-6">
                        <ShoppingCart className="w-10 h-10 text-slate-300" />
                    </div>
                    <h3 className="text-xl font-black text-slate-900">Catalog Closed</h3>
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-2">Click below to reopen the catalog manager</p>
                    <button 
                        onClick={() => setShowModal(true)}
                        className="mt-8 px-8 py-4 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-primary/20 hover:-translate-y-1 transition-all"
                    >
                        Open Catalog
                    </button>
                </div>
            )}
        </div>
    );
}

function RequestsTab({ 
    requests, statusFilter, setStatusFilter, searchQuery, setSearchQuery, 
    tabCounts, updatingId, reassigningId, setReassigningId, onUpdateStatus, 
    onReassign, onDeleteRequest, procurementUsers, user, shouldShowPrice,
    statusModalOpen, setStatusModalOpen, selectedRequestId, setSelectedRequestId,
    handleOpenStatusModal
}: any) {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    return (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                    {[
                        { id: 'all', label: 'All', count: tabCounts.all },
                        { id: 'pending', label: 'Pending', count: tabCounts.pending },
                        { id: 'ordered', label: 'Ordered', count: tabCounts.ordered },
                        { id: 'delivered', label: 'Delivered', count: tabCounts.delivered },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setStatusFilter(tab.id)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 whitespace-nowrap ${statusFilter === tab.id 
                                ? 'bg-slate-500 text-white shadow-md' 
                                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                        >
                            {tab.label}
                            <span className={`px-2 py-0.5 rounded-md text-[9px] ${statusFilter === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden xl:flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                        <Calendar className="w-3 h-3" />
                        <span>dd-mm-yyyy</span>
                        <span className="mx-2 text-slate-300">to</span>
                        <span>dd-mm-yyyy</span>
                        <Calendar className="w-3 h-3 ml-2" />
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest px-4 py-2 border-l border-slate-100">
                        <Filter className="w-3 h-3" />
                        <span>{requests.length} Results</span>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                {requests.length > 0 ? requests.map((req: any) => {
                    const isExpanded = expandedId === req.id;
                    return (
                        <div
                            key={req.id}
                            className={`bg-white rounded-3xl border ${isExpanded ? 'border-primary ring-2 ring-primary/5' : 'border-slate-100'} p-4 transition-all hover:shadow-md cursor-pointer group relative overflow-hidden`}
                            onClick={() => setExpandedId(isExpanded ? null : req.id)}
                        >
                            <div className="flex items-center gap-6">
                                {/* Left Icon */}
                                <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 group-hover:bg-primary/5 group-hover:border-primary/10 transition-colors">
                                    <Box className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                                </div>
                                {req.status?.toLowerCase().includes('pending') && (
                                    <button
                                        className="ml-2 px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenStatusModal(req.id, req.ticket_id);
                                        }}
                                    >
                                        Update Status
                                    </button>
                                )}
                                <div className="flex-1 min-w-0">
                                    {/* Row 1: ID + Status */}
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">#{req.ticket?.ticket_number}</span>
                                        <div className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${
                                            req.status?.toLowerCase() === 'delivered' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                            req.status?.toLowerCase() === 'ordered' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                            'bg-indigo-50 text-indigo-600 border-indigo-100'
                                        }`}>
                                            {req.status?.toLowerCase().includes('pending') ? 'Pending' : req.status?.replace(/_/g, ' ')}
                                        </div>
                                    </div>

                                    {/* Row 2: Title */}
                                    <h4 className="text-sm font-bold text-slate-700 tracking-tight leading-tight mb-1 truncate">{req.ticket?.title}</h4>

                                    {/* Row 3: Metadata */}
                                    <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                        {req.property?.name && (
                                            <div className="flex items-center gap-1.5">
                                                <Building2 className="w-3 h-3 opacity-50" />
                                                <span className="truncate max-w-[150px]">{req.property.name}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1.5">
                                            <Clock className="w-3 h-3 opacity-50" />
                                            <span>{new Date(req.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, {new Date(req.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()}</span>
                                        </div>
                                        {req.status === 'delivered' && req.delivered_at && (
                                            <div className="flex items-center gap-1.5 text-emerald-600/80">
                                                <CheckCircle2 className="w-3 h-3" />
                                                <span>Delivered {new Date(req.delivered_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, {new Date(req.delivered_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Right Chevron */}
                                <ChevronDown className={`w-4 h-4 text-slate-200 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180 text-primary' : ''}`} />
                            </div>

                            {isExpanded && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    transition={{ duration: 0.2 }}
                                    className="mt-5"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex flex-wrap items-center justify-end gap-6 lg:gap-8 pb-4 border-b border-slate-100">
                                        <div className="text-right">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1 justify-end">
                                                <Building2 className="w-3 h-3" /> Property
                                            </p>
                                            <p className="text-xs font-bold text-slate-700 truncate max-w-[140px]">{req.property?.name || 'No Property'}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1 justify-end">
                                                <User className="w-3 h-3" /> Requester
                                            </p>
                                            <p className="text-xs font-bold text-slate-700 truncate max-w-[140px]">{req.requester?.full_name || 'No Requester'}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1 justify-end">
                                                <Shield className="w-3 h-3" /> Assignee
                                            </p>
                                            <div className="flex items-center gap-1 justify-end">
                                                <p className="text-xs font-bold text-slate-700 truncate max-w-[140px]">{req.assignee?.full_name || 'No Assignee'}</p>
                                                <button
                                                    onClick={() => setReassigningId(reassigningId === req.id ? null : req.id)}
                                                    className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-primary transition-all"
                                                    title="Reassign Staff"
                                                >
                                                    <RefreshCw className={`w-3 h-3 ${updatingId === req.id ? 'animate-spin' : ''}`} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {reassigningId === req.id && (
                                        <div className="mt-3 p-3 bg-white rounded-xl border border-primary/20 shadow-sm animate-in slide-in-from-top-1 duration-200 max-w-sm ml-auto">
                                            <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-2">Reassign To:</p>
                                            <div className="flex gap-2">
                                                <select
                                                    className="flex-1 bg-slate-50 border border-slate-100 rounded-lg py-1.5 px-3 text-[11px] font-bold outline-none focus:ring-2 focus:ring-primary/20"
                                                    onChange={(e) => onReassign(req.id, e.target.value)}
                                                    value={req.assignee_uid || ''}
                                                >
                                                    <option value="" disabled>Select Staff</option>
                                                    {procurementUsers.map((u: any) => (
                                                        <option key={u.id} value={u.id}>{u.full_name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => setReassigningId(null)}
                                                    className="p-1.5 rounded-lg bg-slate-100 text-slate-400 hover:bg-slate-200 transition-all"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="mt-4 space-y-1">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                            <Box className="w-3 h-3" /> Materials Required
                                        </p>
                                        {req.items?.map((item: any, i: number) => (
                                            <div key={i} className="py-3 border-b border-slate-100/50 last:border-0 group/item">
                                                <div className="flex justify-between items-start gap-4">
                                                    <div className="flex items-start gap-3 min-w-0 flex-1">
                                                        {item.photo_url && (
                                                            <button 
                                                                type="button"
                                                                onClick={() => {
                                                                    if (item.photo_url.startsWith('data:')) {
                                                                        const w = window.open();
                                                                        w?.document.write(`<img src="${item.photo_url}" style="max-width:100%; max-height:100%; object-fit:contain; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);" />`);
                                                                    } else {
                                                                        window.open(item.photo_url, '_blank');
                                                                    }
                                                                }}
                                                                className="flex-shrink-0 hover:opacity-80 transition-opacity"
                                                            >
                                                                <img 
                                                                    src={item.photo_url} 
                                                                    alt={item.name}
                                                                    className="w-14 h-14 rounded-xl object-cover border border-slate-100 bg-slate-50"
                                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                                />
                                                            </button>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <span className="text-sm font-bold text-slate-800">{item.name}</span>
                                                            {(item.description || item.notes) && (
                                                                <p className="text-[11px] text-slate-500 mt-1 whitespace-pre-wrap leading-relaxed">{item.description || item.notes}</p>
                                                            )}
                                                            {Array.isArray(item.links) && item.links.length > 0 && (
                                                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                                    {item.links.map((link: string, li: number) => (
                                                                        <a key={li} href={link.startsWith('http') ? link : `https://${link}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-black uppercase tracking-widest hover:bg-blue-100 transition-colors">
                                                                            <Link2 className="w-2.5 h-2.5" /> Link {li + 1}
                                                                        </a>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Qty: {item.quantity}</span>
                                                        <span className="text-xs font-black text-emerald-600">
                                                            {(() => {
                                                                const price = item.unit_price ?? item.estimated_cost ?? item.estimated_price;
                                                                return shouldShowPrice && price !== null && price !== undefined ? `₹${price.toLocaleString()}` : '';
                                                            })()}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-2">
                                            <a href={`/tickets/${req.ticket_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                                                <ExternalLink className="w-3.5 h-3.5" /> View Ticket
                                            </a>
                                            {req.quotation_file_url && (
                                                <a href={req.quotation_file_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                                                    <FileText className="w-3.5 h-3.5" /> View Quotation
                                                </a>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {req.status === 'pending_quotation' && (
                                                <button onClick={() => onUpdateStatus(req.id, 'ordered', req.ticket_id)} disabled={updatingId === req.id} className="flex items-center justify-center gap-2 px-8 py-3 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-primary/20 hover:bg-primary-dark">
                                                    {updatingId === req.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} Buy
                                                </button>
                                            )}
                                            {req.status === 'ordered' && (
                                                <button onClick={() => onUpdateStatus(req.id, 'delivered', req.ticket_id)} disabled={updatingId === req.id} className="flex items-center justify-center gap-2 px-8 py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-emerald-200 hover:bg-emerald-700">
                                                    {updatingId === req.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Delivered
                                                </button>
                                            )}
                                            {(req.status === 'ordered' || req.status === 'delivered') && (
                                                <button onClick={() => onUpdateStatus(req.id, 'reverted', req.ticket_id)} disabled={updatingId === req.id} className="px-4 py-2.5 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center gap-2">
                                                    <RefreshCw className={`w-3 h-3 ${updatingId === req.id ? 'animate-spin' : ''}`} /> Revert
                                                </button>
                                            )}
                                            {req.requested_by === user?.id && (req.status === 'pending_approval' || req.status === 'rejected') && (
                                                <button onClick={() => onDeleteRequest(req.id, req.requested_by)} disabled={updatingId === req.id} className="p-2.5 bg-rose-50 text-rose-500 hover:bg-rose-100 rounded-xl transition-all border border-rose-100">
                                                    {updatingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    );
                }) : (
                    <div className="py-32 flex flex-col items-center justify-center text-center">
                        <PackageSearchIcon className="w-16 h-16 text-slate-200 mb-6" />
                        <h3 className="text-xl font-black text-slate-900 mb-2 font-display">No requests found</h3>
                        <p className="text-slate-400 font-medium max-w-xs mx-auto">Try changing your filters or searching for a different ticket ID.</p>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function HistoryTab({ requests, user }: { requests: any[]; user: any }) {
    const delivered = requests.filter(r => r.status === 'delivered');
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Order Archive</h3>
            <div className="bg-white rounded-[32px] border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        <tr>
                            <th className="px-8 py-5">Order Reference</th>
                            <th className="px-8 py-5">Property</th>

                            <th className="px-8 py-5">Quotation</th>
                            <th className="px-8 py-5 text-right">Fulfillment</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {delivered.length > 0 ? delivered.map(req => (
                            <tr key={req.id} className="hover:bg-slate-50/50 transition-all group">
                                <td className="px-8 py-5">
                                    <div className="flex items-center gap-3">
                                        <span className="font-black text-slate-900">#{req.ticket?.ticket_number}</span>
                                        <a href={`/tickets/${req.ticket_id}`} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity text-primary">
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>
                                </td>
                                <td className="px-8 py-5">
                                    <p className="font-bold text-slate-600 text-sm">{req.property?.name}</p>
                                    <p className="text-[10px] text-slate-300 font-bold uppercase">Requested {new Date(req.created_at).toLocaleDateString()}</p>
                                </td>
                                <td className="px-8 py-5 flex items-center">
                                    {req.quotation_file_url && (
                                        <a href={req.quotation_file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all">
                                            <FileText className="w-3 h-3" /> Quotation
                                        </a>
                                    )}
                                </td>
                                <td className="px-8 py-5 text-right">
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[9px] font-black uppercase tracking-widest border border-emerald-100">Delivered</span>
                                        <span className="text-[9px] text-slate-300 font-bold">{new Date(req.delivered_at || req.updated_at).toLocaleDateString()}</span>
                                    </div>
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan={4} className="px-8 py-20 text-center text-slate-300 italic">No historical data available.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
}

function PlaceholderTab({ title, icon: Icon, desc }: any) {
    return (
        <div className="py-32 flex flex-col items-center text-center">
            <div className="w-24 h-24 bg-white rounded-[32px] border border-slate-200 flex items-center justify-center text-slate-200 mb-8 shadow-sm">
                <Icon className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{title}</h2>
            <p className="text-slate-400 font-medium max-w-sm mx-auto mt-2">{desc}</p>
            <div className="mt-8 px-6 py-2 bg-primary/5 text-primary rounded-full text-[10px] font-black uppercase tracking-widest border border-primary/10">Coming Soon</div>
        </div>
    );
}

function ProfileTab({ user }: any) {
    return (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex justify-center py-10">
            <div className="w-full max-w-xl bg-white rounded-[40px] border border-slate-200 shadow-2xl p-10 flex flex-col items-center">
                <div className="w-32 h-32 rounded-3xl bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center text-white text-5xl font-black shadow-xl mb-8">
                    {user?.email?.[0].toUpperCase()}
                </div>
                <h2 className="text-2xl font-black text-slate-900 mb-1">{user?.user_metadata?.full_name || 'Procurement Officer'}</h2>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em] mb-10">Security Tier: Authorized</p>
                <div className="w-full space-y-4">
                    <ProfileRow label="Official Email" value={user?.email} />
                    <ProfileRow label="Assigned Role" value="Procurement Manager" highlight />
                    <ProfileRow label="Office Hours" value="09:00 - 18:00 (IST)" />
                </div>
            </div>
        </motion.div>
    );
}

// --- Helpers & UI Components ---

const StatCard = ({ label, value, icon: Icon, color, subLabel, onClick }: any) => {
    const theme: any = {
        indigo: { bg: 'from-indigo-500/10 to-indigo-500/5', icon: 'bg-indigo-500 text-white', border: 'border-indigo-100', dot: 'bg-indigo-500' },
        amber: { bg: 'from-amber-500/10 to-amber-500/5', icon: 'bg-amber-500 text-white', border: 'border-amber-100', dot: 'bg-amber-500' },
        blue: { bg: 'from-blue-500/10 to-blue-500/5', icon: 'bg-blue-500 text-white', border: 'border-blue-100', dot: 'bg-blue-500' },
        emerald: { bg: 'from-emerald-500/10 to-emerald-500/5', icon: 'bg-emerald-500 text-white', border: 'border-emerald-100', dot: 'bg-emerald-500' },
    };
    const t = theme[color] || theme.indigo;

    return (
        <div onClick={onClick} className={`relative bg-white rounded-[32px] border ${t.border} p-6 shadow-sm hover:shadow-xl transition-all duration-500 group overflow-hidden ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''}`}>
            <div className={`absolute top-0 right-0 w-40 h-40 bg-gradient-to-br ${t.bg} rounded-full -mr-20 -mt-20 transition-transform duration-700 group-hover:scale-150`} />
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-6">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/5 transition-transform duration-500 group-hover:rotate-6 ${t.icon}`}>
                        <Icon className="w-6 h-6" />
                    </div>
                </div>
                <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">{label}</p>
                    <h3 className="text-3xl font-black text-slate-900 tracking-tighter leading-none mb-3">{value}</h3>
                    {subLabel && (
                        <div className="flex items-center gap-1.5">
                            <div className={`w-1 h-1 rounded-full ${t.dot}`} />
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{subLabel}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ProfileRow = ({ label, value, highlight }: any) => (
    <div className="flex justify-between items-center p-5 bg-slate-50 rounded-2xl border border-slate-100">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
        <span className={`text-sm font-black ${highlight ? 'text-primary' : 'text-slate-900'}`}>{value}</span>
    </div>
);

const Toast = ({ message, type, visible, onClose }: any) => (
    <AnimatePresence>
        {visible && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border ${
                type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' :
                type === 'error' ? 'bg-rose-500 text-white border-rose-400' :
                'bg-slate-800 text-white border-slate-700'
            }`}>
                {type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <p className="text-xs font-black uppercase tracking-widest">{message}</p>
                <button onClick={onClose} className="ml-2 hover:opacity-70"><X className="w-4 h-4" /></button>
            </motion.div>
        )}
    </AnimatePresence>
);

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, confirmText, cancelText, type, isLoading }: any) => (
    <AnimatePresence>
        {isOpen && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative bg-white rounded-[40px] shadow-2xl p-10 max-w-md w-full text-center">
                    <div className={`w-20 h-20 rounded-[28px] ${type === 'danger' ? 'bg-rose-50 text-rose-500' : 'bg-primary/10 text-primary'} flex items-center justify-center mx-auto mb-8`}>
                        <AlertCircle className="w-10 h-10" />
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 mb-2">{title}</h3>
                    <p className="text-slate-400 font-medium mb-10">{message}</p>
                    <div className="flex gap-4">
                        <button onClick={onClose} className="flex-1 px-6 py-4 bg-slate-50 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">
                            {cancelText}
                        </button>
                        <button onClick={onConfirm} disabled={isLoading} className={`flex-1 px-6 py-4 ${type === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-primary hover:bg-primary-dark'} text-white font-black text-[10px] uppercase tracking-widest rounded-2xl transition-all shadow-xl disabled:opacity-50`}>
                            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin mx-auto" /> : confirmText}
                        </button>
                    </div>
                </motion.div>
        </div>
        )}
    </AnimatePresence>
);

const SignOutModal = ({ isOpen, onClose, onConfirm }: any) => (
    <ConfirmModal 
        isOpen={isOpen} 
        onClose={onClose} 
        onConfirm={onConfirm} 
        title="Sign Out" 
        message="Are you sure you want to end your current session?" 
        confirmText="Sign Out" 
        cancelText="Cancel" 
        type="danger" 
    />
);

const PackageSearchIcon = (p: any) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.5 21a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z"/><path d="m21 21-1.9-1.9"/><path d="M21 7.82V12"/><path d="M20 18.83V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v.83"/><path d="M10 3v4"/><path d="M14 3v4"/><path d="M18 3v4"/><path d="M2 7h18"/><path d="M6 3v4"/>
    </svg>
);
