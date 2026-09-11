'use client';

import React, { useState } from 'react';
import { X, Building2, MapPin, Users, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Property {
    id: string;
    code: string;
    name: string;
    address?: string;
    city: string;
    total_seats?: number;
    is_active: boolean;
}

interface Props {
    organizationId: string;
    onClose: () => void;
    onSuccess: (property: Property) => void;
}

const CreatePropertyModal: React.FC<Props> = ({ organizationId, onClose, onSuccess }) => {
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        city: '',
        capacity: '',
        image_url: '',
        is_active: true
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');

    const cities = [
        'Bangalore',
        'Mumbai',
        'Delhi',
        'Hyderabad',
        'Chennai',
        'Pune',
        'Kolkata',
        'Ahmedabad'
    ];

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        setError('');
        try {
            const body = new FormData();
            body.append('file', file);
            const res = await fetch('/api/properties/upload-image', {
                method: 'POST',
                body,
            });
            const data = await res.json();
            if (res.ok && data.url) {
                setFormData(prev => ({ ...prev, image_url: data.url }));
            } else {
                setError('Failed to upload image: ' + (data.error || 'Unknown error'));
            }
        } catch (err: any) {
            console.error('Image upload error:', err);
            setError('Image upload failed: ' + err.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            const response = await fetch('/api/properties', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: organizationId,
                    name: formData.name,
                    address: formData.address || null,
                    city: formData.city || null,
                    capacity: formData.capacity ? parseInt(formData.capacity) : null,
                    image_url: formData.image_url || null,
                    is_active: formData.is_active
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create property');
            }

            const data = await response.json();
            onSuccess(data.property);
            onClose();
        } catch (err: any) {
            console.error('Error creating property:', err);
            setError(err.message || 'Failed to create property');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-3xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center">
                                <Building2 className="w-6 h-6 text-indigo-600" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black text-slate-900">Create New Property</h3>
                                <p className="text-sm text-slate-500">Add a property to this organization</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-400" />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Property Name */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                                Property Name *
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g., SS Plaza Tower A"
                                required
                                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 text-sm font-medium"
                            />
                        </div>

                        {/* Address */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                                Address
                            </label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    value={formData.address}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    placeholder="e.g., Koramangala, 5th Block"
                                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 text-sm font-medium"
                                />
                            </div>
                        </div>

                        {/* City */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                                City
                            </label>
                            <select
                                value={formData.city}
                                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 bg-white text-sm font-medium"
                            >
                                <option value="">Select City</option>
                                {cities.map((city) => (
                                    <option key={city} value={city}>{city}</option>
                                ))}
                            </select>
                        </div>

                        {/* Capacity */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                                Capacity
                            </label>
                            <div className="relative">
                                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="number"
                                    value={formData.capacity}
                                    onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                                    placeholder="e.g., 150"
                                    min="1"
                                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 text-sm font-medium"
                                />
                            </div>
                        </div>

                        {/* Property Image */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                                Property Image
                            </label>
                            <div className="relative h-36 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center overflow-hidden bg-slate-50">
                                {isUploading ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Uploading photo...</p>
                                    </div>
                                ) : formData.image_url ? (
                                    <>
                                        <img src={formData.image_url} alt="Preview" className="w-full h-full object-cover" />
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, image_url: '' }))}
                                            className="absolute top-2 right-2 p-1.5 bg-rose-500 text-white rounded-full shadow-lg hover:bg-rose-600 transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center gap-2 pointer-events-none">
                                        <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-slate-400">
                                            <Building2 className="w-5 h-5" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">Upload Property Photo</p>
                                            <p className="text-[9px] text-slate-400 font-medium">PNG, JPG, WebP up to 10MB</p>
                                        </div>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                    disabled={isUploading}
                                    className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                                />
                            </div>
                        </div>

                        {/* Active Status */}
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                            <div>
                                <label className="text-sm font-bold text-slate-700">Active Status</label>
                                <p className="text-xs text-slate-500">Property is active and available for use</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-emerald-500' : 'bg-slate-300'
                                    }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                />
                            </button>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="p-3 bg-red-50 text-red-600 text-sm font-bold rounded-xl border border-red-100">
                                {error}
                            </div>
                        )}

                        {/* Buttons */}
                        <div className="flex gap-3 pt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-3 px-4 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="flex-1 py-3 px-4 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    'Creating...'
                                ) : (
                                    <>
                                        <CheckCircle2 className="w-4 h-4" />
                                        Create Property
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default CreatePropertyModal;
