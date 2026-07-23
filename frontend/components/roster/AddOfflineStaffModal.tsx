'use client';
import React, { useState } from 'react';
import { Pencil, Trash2, Check, X, UserPlus, Loader2 } from 'lucide-react';

interface StaffMember {
    user_id: string;
    role: string;
    custom_designation?: string;
    users: {
        id: string;
        full_name: string;
        designation: string;
    };
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSave: (fullName: string, designation: string) => Promise<void>;
    offlineStaff?: StaffMember[];
    onRename?: (userId: string, newName: string) => Promise<void>;
    onUpdateDesignation?: (userId: string, designation: string) => Promise<void>;
    onDelete?: (userId: string) => Promise<void>;
}

const ROLES = [
    "ASSISTANT MANAGER - TECHNICAL",
    "EXECUTIVE - TECHNICAL",
    "BMS OPERATOR",
    "MST",
    "ASSISTANT MANAGER - OPERATIONS",
    "FACILITY EXECUTIVE - OPERATIONS",
    "TRAINEE - OPERATIONS",
    "HOUSEKEEPING - OPERATIONS",
    "PANTRY - OPERATIONS",
    "SECURITY - OPERATIONS"
];

export function AddOfflineStaffModal({ isOpen, onClose, onSave, offlineStaff = [], onRename, onUpdateDesignation, onDelete }: Props) {
    const [fullName, setFullName] = useState('');
    const [designation, setDesignation] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await onSave(fullName, designation);
            setFullName('');
            setDesignation('');
        } catch (err: any) {
            setError(err.message || 'Failed to add offline staff');
        } finally {
            setLoading(false);
        }
    };

    const handleStartEdit = (staff: StaffMember) => {
        setEditingId(staff.user_id);
        setEditName(staff.users.full_name);
        setEditRole(staff.custom_designation || staff.role || '');
    };

    const handleSaveEdit = async (id: string) => {
        if (!onRename || !onUpdateDesignation) return;
        setActionLoading(id);
        try {
            await onRename(id, editName);
            await onUpdateDesignation(id, editRole);
            setEditingId(null);
        } catch (err) {
            console.error(err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (id: string) => {
        if (!onDelete) return;
        setActionLoading(id);
        try {
            await onDelete(id);
        } catch (err) {
            console.error(err);
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                    <h3 className="font-semibold text-lg text-gray-800">Manage Offline Staff</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-white rounded-full p-1 border">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-8">
                    
                    {/* LEFT COLUMN: List of Staff */}
                    <div className="flex-1">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Current Offline Staff ({offlineStaff.length})</h4>
                        
                        {offlineStaff.length === 0 ? (
                            <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed">
                                <p className="text-gray-500 text-sm">No offline staff added yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {offlineStaff.map(staff => (
                                    <div key={staff.user_id} className="flex items-center justify-between p-3 border rounded-lg hover:border-blue-300 transition-colors bg-white shadow-sm">
                                        {editingId === staff.user_id ? (
                                            <div className="flex-1 flex gap-2">
                                                <input 
                                                    className="flex-1 text-sm border rounded p-1.5 focus:ring-1 focus:outline-none" 
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    placeholder="Name"
                                                />
                                                <select 
                                                    className="flex-1 text-sm border rounded p-1.5 focus:ring-1 focus:outline-none bg-white"
                                                    value={editRole}
                                                    onChange={e => setEditRole(e.target.value)}
                                                >
                                                    <option value="">-- Role --</option>
                                                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                                </select>
                                                <button 
                                                    onClick={() => handleSaveEdit(staff.user_id)}
                                                    disabled={actionLoading === staff.user_id}
                                                    className="p-1.5 bg-green-50 text-green-600 rounded hover:bg-green-100"
                                                >
                                                    {actionLoading === staff.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                                </button>
                                                <button onClick={() => setEditingId(null)} className="p-1.5 bg-gray-50 text-gray-600 rounded hover:bg-gray-100">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="overflow-hidden">
                                                    <div className="font-medium text-sm text-gray-900 truncate">{staff.users.full_name}</div>
                                                    <div className="text-xs text-gray-500 truncate">{staff.custom_designation || staff.role}</div>
                                                </div>
                                                <div className="flex items-center gap-1 ml-2">
                                                    <button 
                                                        onClick={() => handleStartEdit(staff)}
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                                        title="Edit Staff"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(staff.user_id)}
                                                        disabled={actionLoading === staff.user_id}
                                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                        title="Delete Staff"
                                                    >
                                                        {actionLoading === staff.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* RIGHT COLUMN: Add New Form */}
                    <div className="w-full md:w-72 shrink-0">
                        <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                            <h4 className="text-sm font-semibold text-blue-900 flex items-center gap-2 mb-4">
                                <UserPlus className="w-4 h-4" /> Add New Staff
                            </h4>
                            
                            <form onSubmit={handleSubmit}>
                                {error && (
                                    <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-xs border border-red-100">
                                        {error}
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">
                                            Full Name <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white shadow-sm"
                                            value={fullName}
                                            onChange={e => setFullName(e.target.value)}
                                            placeholder="e.g. John Doe"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">
                                            Designation / Role <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            required
                                            className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white shadow-sm"
                                            value={designation}
                                            onChange={e => setDesignation(e.target.value)}
                                        >
                                            <option value="">-- Select Role --</option>
                                            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    className="w-full mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 font-medium disabled:opacity-50 flex justify-center items-center gap-2 shadow-sm"
                                    disabled={loading || !fullName || !designation}
                                >
                                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {loading ? 'Adding...' : 'Add Offline Staff'}
                                </button>
                            </form>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
