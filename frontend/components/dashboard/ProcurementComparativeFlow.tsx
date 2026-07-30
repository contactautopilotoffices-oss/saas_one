import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FileText, Plus, CheckCircle2, User, Loader2, ShieldCheck, UserCheck, Search, ChevronDown, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { createClient } from '@/frontend/utils/supabase/client';

export default function ProcurementComparativeFlow({ 
    request, 
    isAdmin, 
    isProcurementUser, 
    onAction 
}: { 
    request: any; 
    isAdmin: boolean; 
    isProcurementUser: boolean; 
    onAction: () => void; 
}) {
    const [comparativeFile, setComparativeFile] = useState<File | null>(null);
    const [comparativePrice, setComparativePrice] = useState('');
    const [comparativeNotes, setComparativeNotes] = useState('');
    const [selectedApproverUid, setSelectedApproverUid] = useState('');
    const [approverOptions, setApproverOptions] = useState<any[]>([]);
    const [approverSearchQuery, setApproverSearchQuery] = useState('');
    const [isApproverDropdownOpen, setIsApproverDropdownOpen] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            if (data.user) setCurrentUserId(data.user.id);
        });

        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsApproverDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        fetchEligibleApprovers();
    }, [request.id]);

    const fetchEligibleApprovers = async () => {
        try {
            const orgId = request.organization_id || request.ticket?.organization_id;
            const propId = request.property_id || request.ticket?.property_id;
            if (!orgId) return;

            const res = await fetch(`/api/escalation/employees?organizationId=${orgId}${propId ? `&propertyId=${propId}` : ''}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setApproverOptions(data);
                if (data.length > 0 && !selectedApproverUid) {
                    setSelectedApproverUid(data[0].id);
                }
            }
        } catch (err) {
            console.error('Error fetching approvers:', err);
        }
    };

    const filteredApprovers = useMemo(() => {
        if (!approverSearchQuery.trim()) return approverOptions;
        const q = approverSearchQuery.toLowerCase();
        return approverOptions.filter(appr => 
            (appr.full_name || '').toLowerCase().includes(q) ||
            (appr.email || '').toLowerCase().includes(q) ||
            (appr.membership_role || '').toLowerCase().includes(q)
        );
    }, [approverOptions, approverSearchQuery]);

    const selectedApproverObj = useMemo(() => {
        return approverOptions.find(a => a.id === selectedApproverUid) || approverOptions[0];
    }, [approverOptions, selectedApproverUid]);

    const getStatusBadgeClass = (status: string) => {
        switch (status) {
            case 'pending_approval': return 'bg-amber-100 text-amber-600';
            case 'approved': return 'bg-emerald-100 text-emerald-600';
            case 'rejected':
            case 'negotiating': return 'bg-rose-100 text-rose-600';
            default: return 'bg-slate-100 text-slate-600';
        }
    };

    const handleUploadComparative = async () => {
        if (!comparativeFile || !comparativePrice) {
            setError('File and total cost are required');
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('file', comparativeFile);
            const uploadRes = await fetch(`/api/procurement/requests/${request.id}/upload`, {
                method: 'POST',
                body: formData
            });
            if (!uploadRes.ok) throw new Error('Failed to upload comparative file');
            const uploadData = await uploadRes.json();

            const res = await fetch(`/api/procurement/requests/${request.id}/comparatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_url: uploadData.url,
                    total_cost: parseFloat(comparativePrice),
                    notes: comparativeNotes,
                    approver_uid: selectedApproverUid || null
                })
            });
            if (res.ok) {
                setComparativeFile(null);
                setComparativePrice('');
                setComparativeNotes('');
                onAction();
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to upload comparative');
            }
        } catch (err: any) {
            setError(err.message || 'Network error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleApproveRejectComparative = async (comparativeId: string, actionStatus: string) => {
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`/api/procurement/requests/${request.id}/comparatives`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comparative_id: comparativeId, status: actionStatus })
            });
            if (res.ok) {
                setSuccessMsg(`Comparative ${actionStatus === 'approved' ? 'approved' : 'rejected'} successfully!`);
                setTimeout(() => setSuccessMsg(null), 3000);
                onAction();
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to update comparative');
            }
        } catch (err) {
            setError('Network error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-4 py-6 border-t border-slate-100 mt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                <span>Comparative History</span>
            </p>

            {error && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs font-medium border border-red-100 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    {error}
                </div>
            )}
            
            {successMsg && (
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-medium border border-emerald-100 flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {successMsg}
                </div>
            )}
            
            {request.comparatives && request.comparatives.length > 0 ? (
                <div className="space-y-3">
                    {request.comparatives.map((comp: any) => {
                        const isAssignedApprover = comp.approver_uid ? comp.approver_uid === currentUserId : true;
                        const canApproveThisComp = isAssignedApprover || isAdmin;
                        const isOverride = comp.approver_uid && comp.approver_uid !== currentUserId && isAdmin;

                        return (
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

                                {comp.approver_user && (
                                    <div className="mt-2 text-[10px] bg-blue-50/80 text-blue-700 px-2.5 py-1 rounded-md border border-blue-100 font-medium flex items-center gap-1.5 w-fit">
                                        <UserCheck className="w-3 h-3 text-blue-500" />
                                        <span>Assigned Approver: <b>{comp.approver_user.full_name}</b></span>
                                    </div>
                                )}

                                {comp.notes && <p className="text-[10px] text-slate-500 mt-2">{comp.notes}</p>}

                                <div className="flex flex-col gap-1 mt-3 pt-3 border-t border-slate-100">
                                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                                        <User className="w-3 h-3" /> Uploaded by {comp.created_by_user?.full_name || 'Procurement User'}
                                        {comp.created_at && (
                                            <span className="normal-case tracking-normal font-medium opacity-80">
                                                ({new Date(comp.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })})
                                            </span>
                                        )}
                                    </p>
                                    {comp.action_by_user && comp.action_at && (
                                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
                                            <CheckCircle2 className={`w-3 h-3 ${comp.status === 'rejected' ? 'text-red-400' : 'text-green-400'}`} /> 
                                            {comp.status === 'rejected' ? 'Rejected' : 'Approved'} by {comp.action_by_user.full_name}
                                            <span className="normal-case tracking-normal font-medium opacity-80">
                                                ({new Date(comp.action_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })})
                                            </span>
                                        </p>
                                    )}
                                </div>
                                
                                {comp.status === 'pending_approval' && canApproveThisComp && (
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
                                            className="flex-1 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-all font-black text-[9px] uppercase tracking-widest shadow-md flex items-center justify-center gap-1"
                                        >
                                            {isOverride && <ShieldCheck className="w-3 h-3 opacity-90" />}
                                            {isOverride ? 'Approve (Super Admin Override)' : 'Approve Cost'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-[10px] text-slate-400 font-medium">No comparatives uploaded yet.</p>
            )}

            {(() => {
                const reqStatus = (request.status || '').toLowerCase();
                const isUploadAllowedStatus = ['pending_quotation', 'pending', 'negotiating', 'quoted', 'requested'].includes(reqStatus);
                const isAssignedProcurementUser = currentUserId && request.assignee_uid === currentUserId;
                const canUploadComparative = isUploadAllowedStatus && (isProcurementUser || isAssignedProcurementUser);

                if (!canUploadComparative) return null;

                return (
                    <div className="mt-4 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 space-y-4">
                        <p className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                            <Plus className="w-3.5 h-3.5" /> Upload New Comparative
                        </p>

                        <div className="relative" ref={dropdownRef}>
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                                Assign Approver
                            </label>
                            
                            <button
                                type="button"
                                onClick={() => setIsApproverDropdownOpen(!isApproverDropdownOpen)}
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20 flex items-center justify-between shadow-sm"
                            >
                                <span className="truncate">
                                    {selectedApproverObj ? (
                                        `${selectedApproverObj.full_name} (${selectedApproverObj.email})${selectedApproverObj.membership_role ? ` - ${selectedApproverObj.membership_role}` : ''}`
                                    ) : (
                                        'Select Approver...'
                                    )}
                                </span>
                                <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" />
                            </button>

                            {isApproverDropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-hidden flex flex-col">
                                    <div className="p-2 border-b border-slate-100 bg-slate-50/50 sticky top-0">
                                        <div className="relative">
                                            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                                            <input
                                                type="text"
                                                autoFocus
                                                placeholder="Search approver by name or email..."
                                                value={approverSearchQuery}
                                                onChange={(e) => setApproverSearchQuery(e.target.value)}
                                                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                                            />
                                        </div>
                                    </div>

                                    <div className="overflow-y-auto max-h-48 p-1">
                                        {filteredApprovers.length > 0 ? (
                                            filteredApprovers.map((appr) => {
                                                const isSelected = appr.id === selectedApproverUid;
                                                return (
                                                    <button
                                                        key={appr.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedApproverUid(appr.id);
                                                            setIsApproverDropdownOpen(false);
                                                            setApproverSearchQuery('');
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                                                            isSelected ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-slate-50 text-slate-700 font-medium'
                                                        }`}
                                                    >
                                                        <div>
                                                            <div className="font-bold text-slate-800">{appr.full_name}</div>
                                                            <div className="text-[10px] text-slate-400">{appr.email} {appr.membership_role ? `• ${appr.membership_role}` : ''}</div>
                                                        </div>
                                                        {isSelected && <Check className="w-4 h-4 text-primary" />}
                                                    </button>
                                                );
                                            })
                                        ) : (
                                            <div className="p-3 text-center text-xs text-slate-400">No matching users found</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

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
                    {error && <p className="text-rose-500 text-xs font-bold">{error}</p>}
                    <button
                        onClick={handleUploadComparative}
                        disabled={isSubmitting || !comparativeFile || !comparativePrice}
                        className="w-full py-2.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-all font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Upload Comparative'}
                    </button>
                </div>
            );
        })()}
    </div>
);
}
