'use client';

import React, { useState } from 'react';
import { X, Store, Mail, Lock, User, Percent } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { createClient } from '@/frontend/utils/supabase/client';

interface VendorManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    onSuccess: () => void;
    vendorToEdit?: any | null;
    isVendorMode?: boolean;
    currentUserId?: string;
}

export default function VendorManagementModal({
    isOpen,
    onClose,
    propertyId,
    onSuccess,
    vendorToEdit,
    isVendorMode = false,
    currentUserId
}: VendorManagementModalProps) {
    const isEditing = !!vendorToEdit;

    const [shopName, setShopName] = useState(vendorToEdit?.shop_name || '');
    const [commissionRate, setCommissionRate] = useState(vendorToEdit?.commission_rate || 10);
    
    // Auth fields (only shown when creating a new vendor to optionally create their login)
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            let userId = vendorToEdit?.user_id || currentUserId || null;

            // 1. Create Login Account if requested (and not editing, and not in vendor self-serve mode)
            if (!isEditing && !isVendorMode && email && password) {
                // Fetch organization_id for the current property
                const supabase = createClient();
                const { data: propData, error: propErr } = await supabase
                    .from('properties')
                    .select('organization_id')
                    .eq('id', propertyId)
                    .single();
                
                if (propErr || !propData) {
                    throw new Error('Failed to resolve property organization details');
                }

                const userRes = await fetch('/api/users/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        password,
                        full_name: shopName,
                        role: 'vendor',
                        property_id: propertyId,
                        organization_id: propData.organization_id
                    })
                });
                
                const userData = await userRes.json();
                
                if (!userRes.ok) {
                    throw new Error(userData.error || 'Failed to create user account');
                }
                
                userId = userData.user?.id;
            }

            // 2. Create or Update Vendor Shop Record
            const url = `/api/properties/${propertyId}/vendors`;
            const method = isEditing ? 'PATCH' : 'POST';
            
            const payload: any = {
                shop_name: shopName,
                commission_rate: Number(commissionRate)
            };
            
            if (isEditing) {
                payload.id = vendorToEdit.id;
            } else {
                payload.user_id = userId;
            }

            const vendorRes = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!vendorRes.ok) {
                const errData = await vendorRes.json();
                throw new Error(errData.error || 'Failed to save vendor details');
            }

            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 sm:p-6">
            <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl shadow-slate-900/20 relative animate-in fade-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                <button 
                    onClick={onClose}
                    className="absolute top-6 right-6 p-2 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all z-10"
                >
                    <X className="w-5 h-5" />
                </button>
                
                <div className="p-8 sm:p-10 overflow-y-auto">
                    <h2 className="text-2xl font-black text-slate-900 mb-2">
                        {isVendorMode ? 'Add New Shop' : (isEditing ? 'Edit Vendor Shop' : 'Add New Vendor')}
                    </h2>
                    <p className="text-slate-500 text-sm font-medium mb-8">
                        {isVendorMode 
                            ? 'Register an additional shop under your existing vendor account.' 
                            : (isEditing 
                                ? 'Update the shop details and commission rates.' 
                                : 'Register a new cafeteria vendor and optionally generate their login credentials.')}
                    </p>
                    
                    {error && (
                        <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-bold mb-6">
                            {error}
                        </div>
                    )}
                    
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Shop Name</label>
                            <div className="relative group">
                                <Store className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                                <input 
                                    type="text" 
                                    required
                                    value={shopName}
                                    onChange={e => setShopName(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 text-sm font-bold text-slate-900 outline-none focus:bg-white focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-slate-400 placeholder:font-medium"
                                    placeholder="e.g. Chai Point"
                                />
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Commission Rate (%)</label>
                            <div className="relative group">
                                <Percent className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                                <input 
                                    type="number" 
                                    min="0"
                                    max="100"
                                    required
                                    value={commissionRate}
                                    onChange={e => setCommissionRate(Number(e.target.value))}
                                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 text-sm font-bold text-slate-900 outline-none focus:bg-white focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                                />
                            </div>
                        </div>

                        {!isEditing && !isVendorMode && (
                            <div className="mt-8 bg-slate-50 border border-slate-100 rounded-[24px] p-6 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 rounded-l-full"></div>
                                <h4 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-indigo-500" /> Vendor Login Account (Optional)
                                </h4>
                                <p className="text-xs text-slate-500 font-medium mb-5">
                                    If provided, a new vendor login account will be instantly created.
                                </p>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Email Address</label>
                                        <div className="relative group">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                                            <input 
                                                type="email" 
                                                value={email}
                                                onChange={e => setEmail(e.target.value)}
                                                className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-400 placeholder:font-medium"
                                                placeholder="vendor@example.com"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Password</label>
                                        <div className="relative group">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                                            <input 
                                                type="password" 
                                                value={password}
                                                onChange={e => setPassword(e.target.value)}
                                                minLength={6}
                                                className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-400 placeholder:font-medium"
                                                placeholder="Minimum 6 characters"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="pt-8">
                            <button 
                                type="submit" 
                                disabled={isLoading}
                                className="w-full py-4 text-sm rounded-2xl font-black bg-primary text-text-inverse hover:scale-[1.02] active:scale-[0.98] hover:shadow-xl hover:shadow-primary/20 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none flex items-center justify-center gap-2"
                            >
                                {isLoading ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    isVendorMode ? 'Add Shop' : (isEditing ? 'Save Changes' : 'Create Vendor')
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
