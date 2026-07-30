'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
    Clock, CheckCircle2, XCircle, ChevronRight, 
    ShoppingBag, User, Building2, Wallet, 
    ArrowRight, Loader2, Package, Eye, ChevronDown, Trash2,
    Plus, FileText, Truck, ClipboardList, Pencil, UserCheck
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import ConfirmModal from '../ui/ConfirmModal';
import { Toast } from '../ui/Toast';
import { useAuth } from '@/frontend/context/AuthContext';

interface RequestItem {
    id?: string;
    name: string;
    quantity: number;
    unit_price: number | null;
    total_price: number | null;
    photo_url: string;
    description?: string;
    links?: string[];
}

interface ProcurementRequest {
    id: string;
    ticket_id: string;
    ticket?: { ticket_number: string; title: string; floor_number?: number | string | null };
    requester: { full_name: string };
    budget_type: 'rnm' | 'general';
    total_amount: number | null;
    status: 'pending_quotation' | 'pending_approval' | 'quoted' | 'approved' | 'rejected' | 'negotiating' | 'ordered' | 'delivered' | 'cancelled';
    service_description?: string;
    vendor_name?: string;
    vendor_contact?: string;
    vendor_email?: string;
    vendor_address?: string;
    has_custom_items?: boolean;
    approval_level?: number;
    property_id: string;
    organization_id: string;
    created_at: string;
    items: RequestItem[];
    approver?: { full_name: string };
    rejecter?: { full_name: string };
    target_approver?: { full_name: string };
    target_approver_id?: string;
    target_approver_ids?: string[];
    target_approver_names?: string[];
    assignee_uid?: string;
    assignee?: { id?: string; full_name: string };
    comparatives?: {
        id: string;
        file_url: string;
        total_cost: number;
        status: string;
        created_at: string;
        notes?: string;
        created_by_user?: { full_name: string };
        action_by_user?: { full_name: string };
        action_at?: string;
    }[];
    procurement_viewed_at?: string;
}

interface Props {
    organizationId: string;
    propertyId?: string;
    approverId?: string;
    requests?: ProcurementRequest[];
    allFloors?: (string | number)[];
    hasUnspecified?: boolean;
    floorFilter?: string;
    setFloorFilter?: (f: string) => void;
    onAction?: () => void;
}

export default function ProcurementRequestList({ 
    organizationId, propertyId, approverId, 
    requests: propRequests, allFloors: propAllFloors, hasUnspecified: propHasUnspecified, 
    floorFilter: propFloorFilter, setFloorFilter: propSetFloorFilter, onAction 
}: Props) {
    const { user } = useAuth();
    const [internalRequests, setInternalRequests] = useState<ProcurementRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<ProcurementRequest | null>(null);
    const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
    const [deleteRequestId, setDeleteRequestId] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [budgets, setBudgets] = useState<any[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Quotation form state (procurement can edit items + add vendor)
    const [isEditingQuotation, setIsEditingQuotation] = useState(false);
    const [quotVendorName, setQuotVendorName] = useState('');
    const [quotVendorContact, setQuotVendorContact] = useState('');
    const [quotVendorEmail, setQuotVendorEmail] = useState('');
    const [quotItems, setQuotItems] = useState<RequestItem[]>([]);
    
    // Comparative Flow State
    const [comparativeFile, setComparativeFile] = useState<File | null>(null);
    const [comparativePrice, setComparativePrice] = useState('');
    const [comparativeNotes, setComparativeNotes] = useState('');
    
    // Internal state for uncontrolled mode
    const [internalFloorFilter, setInternalFloorFilter] = useState('all');
    
    // Use either prop or internal state
    const requests = propRequests !== undefined ? propRequests : internalRequests;
    const floorFilter = propFloorFilter !== undefined ? propFloorFilter : internalFloorFilter;
    const setFloorFilter = propSetFloorFilter !== undefined ? propSetFloorFilter : setInternalFloorFilter;

    const showToast = (message: string, type: 'success' | 'error') => {
        setNotification({ message, type });
    };
    
    const shouldShowPrice = useMemo(() => {
        return requests.length > 0 && requests.some(r => r.total_amount !== null && r.total_amount !== undefined);
    }, [requests]);

    const isProcurementUser = useMemo(() => {
        const role = user?.user_metadata?.role?.toLowerCase() || '';
        return role.includes('procurement') || role === 'org_super_admin' || role === 'master_admin' || role === 'admin';
    }, [user]);

    const isAdmin = useMemo(() => {
        const role = user?.user_metadata?.role?.toLowerCase() || '';
        return ['org_super_admin', 'master_admin', 'property_admin', 'org_admin'].includes(role);
    }, [user]);

    const canMarkDelivered = useMemo(() => {
        const role = user?.user_metadata?.role?.toLowerCase() || '';
        const isSiteTeamOrAdmin = ['org_super_admin', 'master_admin', 'org_admin', 'property_admin', 'staff', 'mst'].includes(role);
        const isPureProcurement = role.includes('procurement') && !['org_super_admin', 'master_admin', 'org_admin', 'property_admin'].includes(role);
        return isSiteTeamOrAdmin && !isPureProcurement;
    }, [user]);

    const toggleTimeline = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const newSet = new Set(expandedRequests);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedRequests(newSet);
    };

    const getStatusStep = (status: string) => {
        switch (status) {
            case 'pending_quotation': return 1;
            case 'pending_approval': return 2;
            case 'quoted': return 2;
            case 'approved': return 3;
            case 'ordered': return 4;
            case 'delivered': return 5;
            default: return 0;
        }
    };

    const formatExactTime = (dateString: string | null | undefined) => {
        if (!dateString) return '';
        return format(new Date(dateString), 'dd MMM yyyy, hh:mm a');
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending_quotation': return 'Pending Quotation';
            case 'pending_approval': return 'Waiting for Approval';
            case 'quoted': return 'Quoted';
            case 'approved': return 'Approved';
            case 'rejected': return 'Rejected';
            case 'negotiating': return 'Negotiating';
            case 'ordered': return 'Ordered';
            case 'delivered': return 'Received';
            case 'cancelled': return 'Cancelled';
            default: return status.replace('_', ' ');
        }
    };

    const getStatusBadgeClass = (status: string) => {
        switch (status) {
            case 'pending_quotation':
            case 'pending_approval': return 'bg-amber-100 text-amber-600';
            case 'quoted':
            case 'approved': return 'bg-blue-100 text-blue-600';
            case 'ordered': return 'bg-indigo-100 text-indigo-600';
            case 'delivered': return 'bg-green-100 text-green-600';
            case 'rejected': return 'bg-red-100 text-red-600';
            case 'cancelled': return 'bg-slate-100 text-slate-600';
            default: return 'bg-slate-100 text-slate-600';
        }
    };

    const getStatusIconClass = (status: string) => {
        switch (status) {
            case 'pending_quotation':
            case 'pending_approval': return 'bg-amber-50 text-amber-500';
            case 'quoted':
            case 'approved': return 'bg-blue-50 text-blue-500';
            case 'ordered': return 'bg-indigo-50 text-indigo-500';
            case 'delivered': return 'bg-green-50 text-green-500';
            case 'rejected':
            case 'negotiating': return 'bg-red-50 text-red-500';
            default: return 'bg-slate-50 text-slate-500';
        }
    };

    // Calculate floors locally if not provided
    const { allFloors, hasUnspecified } = useMemo(() => {
        if (propAllFloors !== undefined) return { allFloors: propAllFloors, hasUnspecified: propHasUnspecified || false };
        
        const floors = [...new Set(requests.map(r => r.ticket?.floor_number).filter(v => v !== null && v !== undefined && String(v) !== ''))].sort((a, b) => Number(a) - Number(b)) as (string | number)[];
        const unspecified = requests.some(r => r.ticket?.floor_number === null || r.ticket?.floor_number === undefined || String(r.ticket?.floor_number) === '');
        return { allFloors: floors, hasUnspecified: unspecified };
    }, [propAllFloors, propHasUnspecified, requests]);

    const fetchRequests = async () => {
        if (propRequests !== undefined) return;
        setIsLoading(true);
        try {
            let url = `/api/procurement/requests?organizationId=${organizationId}`;
            if (approverId) url += `&approverId=${approverId}`;
            if (propertyId) url += `&propertyId=${propertyId}`;
            if (floorFilter !== 'all') url += `&floorNumber=${floorFilter}`;
            
            const res = await fetch(url);
            const data = await res.json();
            if (Array.isArray(data)) setInternalRequests(data);
        } catch (err) {
            console.error(err);
            setInternalRequests([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (propRequests !== undefined) {
            setIsLoading(false);
        } else {
            fetchRequests();
        }
    }, [propRequests, organizationId, propertyId, approverId, floorFilter]);

    const handleStatusChange = async (id: string, status: string, extra?: any) => {
        setIsSubmitting(true);
        try {
            const body: any = { status, ...extra };
            const res = await fetch(`/api/procurement/requests/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                // If we are just updating read receipts, don't close the modal
                if (!status && extra?.procurement_viewed_at) {
                    setIsSubmitting(false);
                    return;
                }
                setSelectedRequest(null);
                setIsEditingQuotation(false);
                if (onAction) onAction();
                showToast(status ? `Request marked as ${getStatusLabel(status)}` : 'Updated', 'success');
            } else {
                const data = await res.json();
                showToast(data.error || 'Action failed', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Network error', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUploadComparative = async () => {
        if (!selectedRequest || !comparativeFile || !comparativePrice) {
            showToast('File and total cost are required', 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            // 1. Upload File
            const formData = new FormData();
            formData.append('file', comparativeFile);
            const uploadRes = await fetch(`/api/procurement/requests/${selectedRequest.id}/upload`, {
                method: 'POST',
                body: formData
            });
            if (!uploadRes.ok) throw new Error('Failed to upload comparative file');
            const uploadData = await uploadRes.json();

            // 2. Submit Comparative
            const res = await fetch(`/api/procurement/requests/${selectedRequest.id}/comparatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_url: uploadData.url,
                    total_cost: parseFloat(comparativePrice),
                    notes: comparativeNotes
                })
            });
            if (res.ok) {
                setComparativeFile(null);
                setComparativePrice('');
                setComparativeNotes('');
                showToast('Comparative uploaded for approval', 'success');
                if (onAction) onAction();
                fetchRequests(); // refresh local data
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to upload comparative', 'error');
            }
        } catch (err: any) {
            console.error(err);
            showToast(err.message || 'Network error', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleApproveRejectComparative = async (comparativeId: string, actionStatus: string) => {
        if (!selectedRequest) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/procurement/requests/${selectedRequest.id}/comparatives`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comparative_id: comparativeId, status: actionStatus })
            });
            if (res.ok) {
                showToast(`Comparative marked as ${actionStatus}`, 'success');
                if (onAction) onAction();
                fetchRequests(); // refresh local data
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to update comparative', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Network error', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmitQuotation = async () => {
        if (!selectedRequest) return;
        if (!quotVendorName.trim()) {
            showToast('Vendor name is required', 'error');
            return;
        }
        if (quotItems.length === 0) {
            showToast('At least one item is required', 'error');
            return;
        }
        // Validate all items have names
        if (quotItems.some(i => !i.name.trim())) {
            showToast('All items must have a name', 'error');
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/procurement/requests/${selectedRequest.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'quoted',
                    vendor_name: quotVendorName,
                    vendor_contact: quotVendorContact,
                    vendor_email: quotVendorEmail,
                    items: quotItems.map(i => ({
                        name: i.name,
                        quantity: i.quantity,
                        unit_price: i.unit_price,
                        photo_url: i.photo_url,
                        description: i.description,
                        links: i.links
                    }))
                })
            });
            if (res.ok) {
                setSelectedRequest(null);
                setIsEditingQuotation(false);
                setQuotItems([]);
                setQuotVendorName('');
                setQuotVendorContact('');
                setQuotVendorEmail('');
                if (onAction) onAction();
                showToast('Quotation submitted and budget deducted', 'success');
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to submit quotation', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Network error', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Fetch budgets when a request is selected
    useEffect(() => {
        if (selectedRequest?.property_id) {
            fetch(`/api/procurement/budgets?propertyId=${selectedRequest.property_id}`)
                .then(res => res.json())
                .then(data => {
                    if (Array.isArray(data)) setBudgets(data);
                })
                .catch(err => console.error('Failed to fetch budgets:', err));
        }
    }, [selectedRequest?.id]);

    // Init quotation form when selecting a pending request
    useEffect(() => {
        if (selectedRequest) {
            setQuotVendorName(selectedRequest.vendor_name || '');
            setQuotVendorContact(selectedRequest.vendor_contact || '');
            setQuotVendorEmail(selectedRequest.vendor_email || '');
            setQuotItems(selectedRequest.items?.length ? selectedRequest.items.map(i => ({ ...i })) : []);
            setIsEditingQuotation(false);
        }
    }, [selectedRequest?.id]);

    const handleDelete = (id: string) => {
        setDeleteRequestId(id);
    };

    const executeDelete = async () => {
        if (!deleteRequestId) return;
        
        try {
            setIsDeleting(true);
            const res = await fetch(`/api/procurement/requests/${deleteRequestId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast('Material request deleted', 'success');
                setSelectedRequest(null);
                if (onAction) onAction();
            } else {
                const data = await res.json();
                showToast(data.message || 'Failed to delete request.', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Failed to delete request.', 'error');
        } finally {
            setIsDeleting(false);
            setDeleteRequestId(null);
        }
    };

    const addQuotItem = () => {
        setQuotItems(prev => [...prev, { name: '', quantity: 1, unit_price: 0, total_price: 0, photo_url: '' }]);
    };

    const updateQuotItem = (idx: number, field: keyof RequestItem, value: any) => {
        setQuotItems(prev => prev.map((item, i) => {
            if (i !== idx) return item;
            const updated = { ...item, [field]: value };
            if (field === 'quantity' || field === 'unit_price') {
                updated.total_price = (updated.quantity || 0) * (updated.unit_price || 0);
            }
            return updated;
        }));
    };

    const removeQuotItem = (idx: number) => {
        setQuotItems(prev => prev.filter((_, i) => i !== idx));
    };

    const quotationTotal = quotItems.reduce((acc, item) => acc + ((item.quantity || 0) * ((item.unit_price || 0))), 0);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Toast 
                message={notification?.message || ''} 
                type={notification?.type || 'info'} 
                visible={!!notification} 
                onClose={() => setNotification(null)} 
            />
            
            <ConfirmModal 
                isOpen={!!deleteRequestId}
                onClose={() => setDeleteRequestId(null)}
                onConfirm={executeDelete}
                title="Delete Material Request"
                message="Are you sure you want to delete this material request? This action cannot be undone."
                confirmText="Yes, Delete"
                cancelText="Keep Request"
                type="danger"
                isLoading={isDeleting}
            />

            <div className="lg:col-span-3 flex items-center justify-between bg-white p-4 rounded-3xl border border-slate-200 shadow-sm mb-2">
                <div className="flex items-center gap-4">
                    <h3 className="text-lg font-black text-slate-900">Material Requests</h3>
                    <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-400" />
                        <select 
                            value={floorFilter}
                            onChange={(e) => setFloorFilter(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                        >
                            <option value="all">All Floors</option>
                            {hasUnspecified && <option value="unspecified">Unspecified</option>}
                            {allFloors.map(f => (
                                <option key={`floor-${f}`} value={String(f)}>
                                    {f === 0 ? 'Ground Floor' : f === -1 ? 'Basement 1' : f === -2 ? 'Basement 2' : `Floor ${f}`}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    {requests.length} Request{requests.length !== 1 ? 's' : ''}
                </div>
            </div>

            {/* List Column */}
            <div className={`lg:col-span-2 space-y-4 ${selectedRequest ? 'hidden lg:block' : ''}`}>
                {requests.length === 0 ? (
                    <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center space-y-4">
                        <ShoppingBag className="w-16 h-16 text-slate-100 mx-auto" />
                        <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No orders found</p>
                    </div>
                ) : (
                    requests.map(req => {
                        const isExpanded = expandedRequests.has(req.id);
                        const currentStep = getStatusStep(req.status);
                        
                        return (
                            <div 
                                key={`req-${req.id}`}
                                className={`bg-white rounded-2xl border transition-all cursor-pointer group overflow-hidden
                                    ${selectedRequest?.id === req.id 
                                        ? 'border-primary ring-2 ring-primary/10 shadow-lg' 
                                        : 'border-slate-200 hover:border-primary/30 hover:shadow-md'}`}
                                onClick={() => setSelectedRequest(req)}
                            >
                                <div className="p-5">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${getStatusIconClass(req.status)}`}>
                                                <Package className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-sm font-black text-slate-800">#{req.ticket?.ticket_number || '---'}</h4>
                                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${getStatusBadgeClass(req.status)}`}>
                                                        {getStatusLabel(req.status)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-500 font-medium mt-0.5 cursor-help" title={req.ticket?.title || 'No Title'}>{req.ticket?.title || 'No Title'}</p>
                                                {req.items?.length > 0 && (
                                                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{req.items.length} item{req.items.length > 1 ? 's' : ''} requested</p>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <p className="text-sm font-black text-slate-900">
                                                    {shouldShowPrice && req.total_amount !== null && req.total_amount > 0 ? `₹${req.total_amount.toLocaleString()}` : ''}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-medium">
                                                    {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                                                </p>
                                            </div>
                                            <button 
                                                onClick={(e) => toggleTimeline(e, req.id)}
                                                className={`p-1.5 rounded-lg transition-all ${isExpanded ? 'bg-primary text-white' : 'bg-slate-50 text-slate-400 hover:text-primary hover:bg-primary/10'}`}
                                            >
                                                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Timeline Section */}
                                    {isExpanded && (
                                        <div className="mt-6 pt-6 border-t border-slate-100 animate-in slide-in-from-top-2 duration-300">
                                            <div className="relative">
                                                {/* Labels */}
                                                <div className="grid grid-cols-5 gap-2 mb-4">
                                                    {[
                                                        { label: 'REQUESTED', time: req.created_at },
                                                        { label: 'PENDING', time: (req as any).procurement_viewed_at },
                                                        { label: 'APPROVED', time: req.comparatives?.find((c: any) => c.status === 'approved')?.action_at },
                                                        { label: 'ORDERED', time: (req as any).ordered_at },
                                                        { label: 'DELIVERED', time: (req as any).delivered_at }
                                                    ].map((step, idx) => (
                                                        <div key={step.label} className="text-center">
                                                            <p className={`text-[8px] font-black tracking-widest uppercase transition-colors
                                                                ${currentStep >= idx + 1 ? 'text-primary' : 'text-slate-300'}`}>
                                                                {step.label}
                                                            </p>
                                                            {step.time && currentStep >= idx + 1 && (
                                                                <p className="text-[7px] text-slate-400 mt-1 uppercase font-medium">
                                                                    {formatExactTime(step.time)}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                                
                                                {/* Progress Bar segments */}
                                                <div className="flex gap-1.5 px-1">
                                                    {[1, 2, 3, 4, 5].map((i) => (
                                                        <div 
                                                            key={i}
                                                            className={`h-1.5 flex-1 rounded-full transition-all duration-500
                                                                ${currentStep >= i ? 'bg-primary shadow-sm' : 'bg-slate-100'}`}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                            
                                            {/* Extra details in timeline */}
                                            <div className="mt-4 flex items-center justify-between px-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-5 h-5 rounded-full bg-slate-50 flex items-center justify-center">
                                                        <User className="w-2.5 h-2.5 text-slate-400" />
                                                    </div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                                    Requested by {req.requester?.full_name || 'Unknown'}
                                                    {(req as any).status === 'delivered' && (req as any).delivered_by_user?.full_name && ` • Delivered by ${(req as any).delivered_by_user.full_name}`}
                                                    {req.status === 'pending_quotation' && ' • Awaiting quotation'}
                                                    {req.vendor_name && ` • Vendor: ${req.vendor_name}`}
                                                </p>
                                                </div>
                                                <p className="text-[9px] font-black text-primary uppercase tracking-widest">
                                                    {shouldShowPrice && req.total_amount !== null && req.total_amount > 0 ? `Total ₹${req.total_amount.toLocaleString()}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Detail Column */}
            <div className={`lg:col-span-1 ${!selectedRequest ? 'hidden lg:block' : ''}`}>
                {selectedRequest ? (
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden sticky top-6 max-h-[90vh] overflow-y-auto">
                        <div className="bg-slate-50 p-6 border-b border-slate-200 flex items-center justify-between">
                            <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">Order Details</h3>
                            <button onClick={() => setSelectedRequest(null)} className="lg:hidden p-2 rounded-lg hover:bg-slate-200">
                                <XCircle className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-6">
                            {/* Summary Section */}
                            <div className="flex flex-col gap-3 pb-6 border-b border-slate-100">
                                <div className="bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100/50 flex flex-col justify-center min-w-0">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Requested By</p>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <User className="w-3 h-3 text-primary" />
                                        </div>
                                        <span className="text-xs font-black text-slate-800 break-words whitespace-normal leading-normal">
                                            {selectedRequest.requester.full_name}
                                        </span>
                                    </div>
                                </div>

                                {selectedRequest.vendor_name && (
                                    <div className="bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100/50 flex flex-col justify-center min-w-0">
                                        <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1.5">Vendor</p>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                                                <Truck className="w-3 h-3 text-blue-500" />
                                            </div>
                                            <span className="text-xs font-black text-slate-800 break-words whitespace-normal leading-normal">
                                                {selectedRequest.vendor_name}
                                            </span>
                                        </div>
                                        {selectedRequest.vendor_contact && (
                                            <p className="text-[10px] text-slate-500 mt-1 ml-8">{selectedRequest.vendor_contact}</p>
                                        )}
                                        {selectedRequest.vendor_email && (
                                            <p className="text-[10px] text-slate-500 ml-8">{selectedRequest.vendor_email}</p>
                                        )}
                                    </div>
                                )}

                                <div className="bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100/50 flex flex-col justify-center min-w-0">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Account</p>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                                            <Wallet className="w-3 h-3 text-emerald-500" />
                                        </div>
                                        <span className="text-xs font-black text-slate-800 uppercase tracking-tight break-words whitespace-normal leading-normal">
                                            {selectedRequest.budget_type === 'rnm' ? 'Repair and Maintenance Account' : 
                                             selectedRequest.budget_type === 'general' ? 'General Account' : 
                                             selectedRequest.budget_type}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* PROCUREMENT ACTION: Edit Quotation for pending requests */}
                            {selectedRequest.status === 'pending_quotation' && isProcurementUser && (
                                <div className="space-y-4 pb-6 border-b border-slate-100">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                                            <ClipboardList className="w-3.5 h-3.5" />
                                            {isEditingQuotation ? 'Edit Quotation' : 'Review & Quote'}
                                        </p>
                                        {!isEditingQuotation && (
                                            <button
                                                onClick={() => setIsEditingQuotation(true)}
                                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all"
                                            >
                                                <Pencil className="w-3 h-3" /> Edit
                                            </button>
                                        )}
                                    </div>
                                    
                                    {isEditingQuotation ? (
                                        <div className="space-y-3">
                                            <input
                                                type="text"
                                                placeholder="Vendor Name *"
                                                value={quotVendorName}
                                                onChange={(e) => setQuotVendorName(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Vendor Contact"
                                                value={quotVendorContact}
                                                onChange={(e) => setQuotVendorContact(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <input
                                                type="email"
                                                placeholder="Vendor Email"
                                                value={quotVendorEmail}
                                                onChange={(e) => setQuotVendorEmail(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-primary/20 outline-none"
                                            />

                                            <div className="space-y-2 pt-2">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Quotation Items</p>
                                                    <button
                                                        onClick={addQuotItem}
                                                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all"
                                                    >
                                                        <Plus className="w-3 h-3" /> Add Item
                                                    </button>
                                                </div>
                                                {quotItems.map((item, idx) => (
                                                    <div key={idx} className="bg-slate-50 rounded-xl p-3 space-y-2 border border-slate-100">
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="text"
                                                                placeholder="Item name"
                                                                value={item.name}
                                                                onChange={(e) => updateQuotItem(idx, 'name', e.target.value)}
                                                                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-primary/20 outline-none"
                                                            />
                                                            <button
                                                                onClick={() => removeQuotItem(idx)}
                                                                className="p-1.5 rounded-lg bg-rose-50 text-rose-400 hover:text-rose-600 transition-all"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="number"
                                                                placeholder="Qty"
                                                                value={item.quantity}
                                                                onChange={(e) => updateQuotItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                                                className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-primary/20 outline-none"
                                                            />
                                                            <input
                                                                type="number"
                                                                placeholder="Unit Price ₹"
                                                                value={item.unit_price || ''}
                                                                onChange={(e) => updateQuotItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                                                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-primary/20 outline-none"
                                                            />
                                                            <div className="flex items-center px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-black text-slate-500 min-w-[60px] justify-center">
                                                                ₹{((item.quantity || 0) * (item.unit_price || 0)).toLocaleString()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="flex items-center justify-between pt-2">
                                                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Quotation Total</span>
                                                <span className="text-lg font-black text-primary">₹{quotationTotal.toLocaleString()}</span>
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setIsEditingQuotation(false)}
                                                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 transition-all font-black text-[10px] uppercase tracking-widest"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={handleSubmitQuotation}
                                                    disabled={isSubmitting}
                                                    className="flex-[2] py-2.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-all font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
                                                >
                                                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                                                    Submit Quotation & Deduct
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <p className="text-[10px] text-slate-400 font-medium">Click Edit to review items, adjust prices, add vendor details, and submit the final quotation.</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* COMPARATIVE HISTORY & ACTIONS */}
                            <div className="space-y-4 pb-6 border-b border-slate-100">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                                    <span>Comparative History</span>
                                </p>
                                
                                {selectedRequest.comparatives && selectedRequest.comparatives.length > 0 ? (
                                    <div className="space-y-3">
                                        {selectedRequest.comparatives.map((comp: any) => (
                                            <div key={comp.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div>
                                                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${getStatusBadgeClass(comp.status)}`}>
                                                            {comp.status}
                                                        </span>
                                                        <p className="text-xs font-bold text-slate-800 mt-2">Total Cost: ₹{comp.total_cost.toLocaleString()}</p>
                                                    </div>
                                                    <a href={comp.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-primary hover:underline bg-primary/10 px-2 py-1 rounded-md">
                                                        <FileText className="w-3 h-3" /> View File
                                                    </a>
                                                </div>
                                                {comp.notes && <p className="text-[10px] text-slate-500 mt-2">{comp.notes}</p>}
                                                <div className="flex flex-col gap-1 mt-3 pt-3 border-t border-slate-100">
                                                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                                                        <User className="w-3 h-3" /> Uploaded by {comp.created_by_user?.full_name || 'Procurement User'}
                                                        <span className="normal-case tracking-normal font-medium opacity-80">
                                                            ({formatExactTime(comp.created_at)})
                                                        </span>
                                                    </p>
                                                    {comp.action_by_user && comp.action_at && (
                                                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
                                                            <CheckCircle2 className={`w-3 h-3 ${comp.status === 'rejected' ? 'text-red-400' : 'text-green-400'}`} /> 
                                                            {comp.status === 'rejected' ? 'Rejected' : 'Approved'} by {comp.action_by_user.full_name}
                                                            <span className="normal-case tracking-normal font-medium opacity-80">
                                                                ({formatExactTime(comp.action_at)})
                                                            </span>
                                                        </p>
                                                    )}
                                                    {comp.status === 'pending_approval' && comp.approver_user && (
                                                        <p className="text-[9px] text-amber-500 font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
                                                            <UserCheck className="w-3 h-3" /> Pending Approval from {comp.approver_user.full_name}
                                                        </p>
                                                    )}
                                                </div>
                                                
                                                {comp.status === 'pending_approval' && isAdmin && (
                                                    <div className="flex gap-2 mt-4 pt-4 border-t border-slate-200">
                                                        <button 
                                                            onClick={() => handleApproveRejectComparative(comp.id, 'rejected')}
                                                            disabled={isSubmitting}
                                                            className="flex-1 py-2 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 transition-all font-black text-[9px] uppercase tracking-widest"
                                                        >
                                                            Negotiate / Reject
                                                        </button>
                                                        <button 
                                                            onClick={() => handleApproveRejectComparative(comp.id, 'approved')}
                                                            disabled={isSubmitting}
                                                            className="flex-1 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-all font-black text-[9px] uppercase tracking-widest shadow-md"
                                                        >
                                                            Approve Cost
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-slate-400 font-medium">No comparatives uploaded yet.</p>
                                )}

                                {(() => {
                                    const reqStatus = (selectedRequest.status || '').toLowerCase();
                                    const isUploadAllowedStatus = ['pending_quotation', 'pending', 'negotiating', 'quoted', 'requested'].includes(reqStatus);
                                    const isAssigned = user?.id && selectedRequest.assignee_uid === user.id;
                                    const canUpload = isUploadAllowedStatus && (isProcurementUser || isAdmin || isAssigned);

                                    if (!canUpload) return null;

                                    return (
                                        <div className="mt-4 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 space-y-4">
                                            <p className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                                                <Plus className="w-3.5 h-3.5" /> Upload New Comparative
                                            </p>
                                        <input
                                            type="file"
                                            accept="application/pdf,image/*,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                            onChange={(e) => setComparativeFile(e.target.files?.[0] || null)}
                                            className="w-full text-xs text-slate-600 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-black file:uppercase file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                                        />
                                        <input
                                            type="number"
                                            placeholder="Total Comparative Cost ₹"
                                            value={comparativePrice}
                                            onChange={(e) => setComparativePrice(e.target.value)}
                                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                                        />
                                        <textarea
                                            placeholder="Notes / Vendor info (optional)"
                                            value={comparativeNotes}
                                            onChange={(e) => setComparativeNotes(e.target.value)}
                                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                                            rows={2}
                                        />
                                        <button
                                            onClick={handleUploadComparative}
                                            disabled={isSubmitting || !comparativeFile || !comparativePrice}
                                            className="w-full py-2.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-all font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200 disabled:opacity-50"
                                        >
                                        </button>
                                    </div>
                                );
                            })()}
                            </div>

                            {/* PROCUREMENT ACTIONS: Quoted/Approved → Ordered → Delivered */}
                            {selectedRequest.status === 'quoted' && isProcurementUser && (
                                <button
                                    onClick={() => handleStatusChange(selectedRequest.id, 'ordered')}
                                    disabled={isSubmitting}
                                    className="w-full py-3 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 transition-all font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                                    Mark as Ordered
                                </button>
                            )}

                            {(selectedRequest.status === 'ordered' || selectedRequest.status === 'approved') && (canMarkDelivered || (selectedRequest as any).requested_by === user?.id) && (
                                <button
                                    onClick={() => handleStatusChange(selectedRequest.id, 'delivered')}
                                    disabled={isSubmitting}
                                    className="w-full py-3 rounded-xl bg-green-500 text-white hover:bg-green-600 transition-all font-black text-xs uppercase tracking-widest shadow-lg shadow-green-200 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    Mark as Delivered / Received
                                </button>
                            )}

                            {/* Items List */}
                            <div className="space-y-4">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                                    <span>Items ({selectedRequest.items?.length || 0})</span>
                                </p>
                                <div className="divide-y divide-slate-100">
                                    {selectedRequest.items?.map((item, idx) => (
                                        <div key={item.id || `item-${idx}`} className="flex items-center gap-4 py-3 group">
                                            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex-shrink-0 overflow-hidden">
                                                <img 
                                                    src={item.photo_url || `https://placehold.co/100x100?text=${encodeURIComponent(item.name?.[0] || 'I')}`} 
                                                    className="w-full h-full object-cover" 
                                                    onError={(e) => {
                                                        const target = e.target as HTMLImageElement;
                                                        target.onerror = null;
                                                        target.src = `https://placehold.co/100x100?text=${encodeURIComponent(item.name?.[0] || 'I')}`;
                                                    }}
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[11px] font-black text-slate-800 truncate cursor-help" title={item.name}>{item.name}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[9px] font-black text-primary bg-primary/5 px-1.5 py-0.5 rounded-md">Qty: {item.quantity}</span>
                                                    <span className="text-[9px] text-slate-400 font-bold">
                                                        {shouldShowPrice && item.unit_price !== null && item.unit_price !== undefined && item.unit_price > 0 
                                                            ? `₹${item.unit_price.toLocaleString()}` 
                                                            : ''}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[11px] font-black text-slate-900">
                                                    {shouldShowPrice && item.total_price !== null && item.total_price !== undefined && item.total_price > 0 
                                                        ? `₹${item.total_price.toLocaleString()}` 
                                                        : ''}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                             <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                                    {shouldShowPrice && (selectedRequest.total_amount || 0) > 0 ? 'Total' : ''}
                                </span>
                                <span className="text-lg font-black text-primary">
                                    {shouldShowPrice && selectedRequest.total_amount !== null && selectedRequest.total_amount !== undefined && selectedRequest.total_amount > 0 
                                        ? `₹${selectedRequest.total_amount.toLocaleString()}` 
                                        : ''}
                                </span>
                            </div>

                            {selectedRequest.ticket_id && (
                                <button 
                                    onClick={() => {
                                        window.location.href = `/tickets/${selectedRequest.ticket_id}`;
                                    }}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-all font-black text-xs uppercase tracking-widest"
                                >
                                    <Eye className="w-4 h-4" />
                                    View Ticket
                                </button>
                            )}

                            {/* Delete Option */}
                            {(selectedRequest.status === 'pending_quotation' || selectedRequest.status === 'rejected') && (
                                <button 
                                    onClick={() => handleDelete(selectedRequest.id)}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-rose-100 text-rose-500 hover:bg-rose-50 transition-all font-black text-[10px] uppercase tracking-widest mt-2"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete Request
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 p-12 text-center h-[400px] flex flex-col items-center justify-center space-y-4">
                        <ArrowRight className="w-12 h-12 text-slate-300 animate-pulse" />
                        <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Choose an order to see details</p>
                    </div>
                )}
            </div>
        </div>
    );
}
