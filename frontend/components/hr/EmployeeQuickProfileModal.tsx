'use client';

import React, { useEffect } from 'react';
import { X, Mail, Phone, Building2, MapPin, Shield, UserCheck, Lock, ExternalLink, User } from 'lucide-react';

export interface EmployeeProfileModalData {
    isOpen: boolean;
    type: 'submitter' | 'handler';
    ticket: any;
    employee: {
        is_anonymous?: boolean;
        name: string;
        employee_code?: string;
        department?: string;
        location?: string;
        designation?: string;
        app_role?: string;
        email?: string;
        phone?: string;
        manager_name?: string;
        photo_url?: string | null;
        level?: number;
        level_status?: string;
    };
}

interface EmployeeQuickProfileModalProps {
    data: EmployeeProfileModalData | null;
    onClose: () => void;
    onViewTicketDetails?: (ticketId: string) => void;
}

const formatRole = (val?: string) => {
    if (!val || val === 'N/A') return '';
    const map: Record<string, string> = {
        'hr_head': 'HR Head',
        'hr_authority': 'HR Authority',
        'org_admin': 'Org Admin',
        'ops_super_admin': 'Ops Super Admin',
        'property_admin': 'Property Admin',
        'tenant': 'Tenant Occupant',
        'staff': 'Staff Technician',
        'mst': 'MST Technician'
    };
    if (map[val.toLowerCase()]) return map[val.toLowerCase()];
    return val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

export default function EmployeeQuickProfileModal({
    data,
    onClose,
    onViewTicketDetails
}: EmployeeQuickProfileModalProps) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (data?.isOpen) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [data?.isOpen, onClose]);

    if (!data || !data.isOpen) return null;

    const { type, ticket, employee } = data;
    const isAnonymous = Boolean(employee.is_anonymous || ticket.is_anonymous);

    const getInitials = (name: string) => {
        if (!name) return 'U';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.slice(0, 2).toUpperCase();
    };

    const roleTitle = formatRole(employee.designation) || formatRole(employee.app_role) || (type === 'handler' ? 'Designated Authority' : 'Employee Submitter');

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={onClose}
        >
            <div 
                className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-[#30363d] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header Gradient Strip */}
                <div className={`h-22 w-full ${
                    type === 'handler' 
                        ? 'bg-gradient-to-r from-teal-700 via-[#587e85] to-indigo-600' 
                        : isAnonymous 
                        ? 'bg-gradient-to-r from-amber-500 to-amber-700' 
                        : 'bg-gradient-to-r from-teal-600 via-[#587e85] to-emerald-600'
                } relative p-4 flex items-start justify-between`}
                >
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-white px-2.5 py-1 rounded-full bg-black/30 backdrop-blur-md border border-white/20 shadow-xs">
                            {type === 'handler' ? `Level ${employee.level || ticket.current_level} Owner` : 'Ticket Submitter'}
                        </span>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-7 h-7 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center transition-colors text-xs border border-white/20 cursor-pointer"
                            aria-label="Close"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Profile Card Body */}
                <div className="px-5 pt-0 pb-5 -mt-10">
                    {/* Circle Avatar */}
                    <div className="flex items-end justify-between">
                        <div className="relative">
                            {isAnonymous ? (
                                <div className="w-18 h-18 rounded-full bg-amber-100 dark:bg-amber-950 border-4 border-white dark:border-[#161b22] text-amber-700 dark:text-amber-300 flex items-center justify-center shadow-lg">
                                    <Lock className="w-8 h-8" />
                                </div>
                            ) : employee.photo_url ? (
                                <>
                                    <div className="w-18 h-18 rounded-full p-[2px] bg-gradient-to-tr from-teal-500 via-[#587e85] to-indigo-500 border-4 border-white dark:border-[#161b22] shadow-lg">
                                        <img
                                            src={employee.photo_url}
                                            alt={employee.name}
                                            referrerPolicy="no-referrer"
                                            onError={(e) => {
                                                e.currentTarget.parentElement?.classList.add('!hidden');
                                                const fallbackEl = e.currentTarget.parentElement?.nextElementSibling as HTMLElement;
                                                if (fallbackEl) fallbackEl.classList.remove('!hidden');
                                            }}
                                            className="w-full h-full rounded-full object-cover bg-white dark:bg-slate-800"
                                        />
                                    </div>
                                    <div className="!hidden w-18 h-18 rounded-full bg-[#587e85] border-4 border-white dark:border-[#161b22] text-white flex items-center justify-center font-black text-2xl shadow-lg">
                                        {getInitials(employee.name)}
                                    </div>
                                </>
                            ) : (
                                <div className="w-18 h-18 rounded-full bg-[#587e85] border-4 border-white dark:border-[#161b22] text-white flex items-center justify-center font-black text-2xl shadow-lg">
                                    {getInitials(employee.name)}
                                </div>
                            )}
                        </div>

                        {employee.employee_code && employee.employee_code !== 'N/A' && !isAnonymous && (
                            <span className="font-mono text-xs font-black px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#21262d] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#30363d] shadow-2xs">
                                #{employee.employee_code}
                            </span>
                        )}
                    </div>

                    {/* Name & Role */}
                    <div className="mt-3">
                        <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                            <span>{employee.name}</span>
                            {isAnonymous && <Lock className="w-4 h-4 text-amber-600 shrink-0" />}
                        </h3>
                        <p className="text-xs font-bold text-[#587e85] dark:text-[#7ba9b1] mt-0.5">
                            {roleTitle}
                        </p>
                    </div>

                    {/* Anonymous Alert Banner */}
                    {isAnonymous && (
                        <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                            <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                                <div className="font-extrabold text-xs">Identity Masked</div>
                                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 leading-tight">
                                    This ticket was submitted anonymously. Personal identifiers are protected.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Information Grid */}
                    <div className="mt-4 p-3.5 bg-slate-50 dark:bg-[#0d1117] rounded-2xl border border-slate-200 dark:border-[#30363d] space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-600 dark:text-slate-400 text-[11.5px] font-semibold flex items-center gap-1.5 shrink-0">
                                <Building2 className="w-3.5 h-3.5 text-[#587e85] dark:text-[#7ba9b1]" />
                                Department:
                            </span>
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-right truncate">
                                {isAnonymous ? 'Confidential' : (employee.department || 'Operations')}
                            </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-[#21262d]">
                            <span className="text-slate-600 dark:text-slate-400 text-[11.5px] font-semibold flex items-center gap-1.5 shrink-0">
                                <MapPin className="w-3.5 h-3.5 text-[#587e85] dark:text-[#7ba9b1]" />
                                Location:
                            </span>
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-right truncate">
                                {isAnonymous ? 'Hidden' : (employee.location || 'Site / HO')}
                            </span>
                        </div>

                        {type === 'submitter' && (
                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-[#21262d]">
                                <span className="text-slate-600 dark:text-slate-400 text-[11.5px] font-semibold flex items-center gap-1.5 shrink-0">
                                    <UserCheck className="w-3.5 h-3.5 text-[#587e85] dark:text-[#7ba9b1]" />
                                    Reporting Manager:
                                </span>
                                <span className="font-bold text-slate-900 dark:text-slate-100 text-right truncate">
                                    {isAnonymous ? 'Hidden' : (employee.manager_name || 'N/A')}
                                </span>
                            </div>
                        )}

                        {type === 'handler' && (
                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-[#21262d]">
                                <span className="text-slate-600 dark:text-slate-400 text-[11.5px] font-semibold flex items-center gap-1.5 shrink-0">
                                    <Shield className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                                    Authority Level:
                                </span>
                                <span className="font-bold text-indigo-600 dark:text-indigo-400 text-right truncate">
                                    Level {employee.level || ticket.current_level} ({employee.level_status || 'Active Owner'})
                                </span>
                            </div>
                        )}

                        {!isAnonymous && employee.email && employee.email !== 'N/A' && (
                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-[#21262d]">
                                <span className="text-slate-600 dark:text-slate-400 text-[11.5px] font-semibold flex items-center gap-1.5 shrink-0">
                                    <Mail className="w-3.5 h-3.5 text-[#587e85] dark:text-[#7ba9b1]" />
                                    Email:
                                </span>
                                <a 
                                    href={`mailto:${employee.email}`} 
                                    className="font-bold text-[#587e85] dark:text-teal-400 hover:underline truncate text-right max-w-[190px]"
                                    title={employee.email}
                                >
                                    {employee.email}
                                </a>
                            </div>
                        )}

                        {!isAnonymous && employee.phone && employee.phone !== 'N/A' && (
                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-[#21262d]">
                                <span className="text-slate-600 dark:text-slate-400 text-[11.5px] font-semibold flex items-center gap-1.5 shrink-0">
                                    <Phone className="w-3.5 h-3.5 text-[#587e85] dark:text-[#7ba9b1]" />
                                    Phone:
                                </span>
                                <a 
                                    href={`tel:${employee.phone}`} 
                                    className="font-bold text-[#587e85] dark:text-teal-400 hover:underline text-right"
                                    title={employee.phone}
                                >
                                    {employee.phone}
                                </a>
                            </div>
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="mt-4 flex items-center gap-2.5">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-[#30363d] bg-white dark:bg-[#21262d] text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-100 dark:hover:bg-[#30363d] transition-colors shadow-2xs cursor-pointer"
                        >
                            Close
                        </button>
                        {onViewTicketDetails && (
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    onViewTicketDetails(ticket.id);
                                }}
                                className="flex-1 py-2.5 rounded-xl bg-[#587e85] hover:bg-[#47686e] text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <span>Ticket Details</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
