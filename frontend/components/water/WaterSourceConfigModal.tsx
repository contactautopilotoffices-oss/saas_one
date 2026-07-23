import React, { useState, useEffect } from 'react';
import { X, Plus, Save, Trash2, Droplets } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';

interface Source {
    id: string;
    name: string;
    source_type: 'jar' | 'tanker';
    capacity_litres: number;
    water_tariffs: { id: string; rate_per_unit: number; effective_from: string }[];
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    sources: Source[];
    onSuccess: () => void;
    isDark?: boolean;
}

export default function WaterSourceConfigModal({ isOpen, onClose, propertyId, sources, onSuccess, isDark = false }: Props) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingSource, setEditingSource] = useState<Partial<Source> | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [sourceType, setSourceType] = useState<'jar' | 'tanker'>('jar');
    const [capacity, setCapacity] = useState('');
    const [initialRate, setInitialRate] = useState('');

    useEffect(() => {
        if (editingSource) {
            setName(editingSource.name || '');
            setSourceType(editingSource.source_type || 'jar');
            setCapacity(editingSource.capacity_litres ? editingSource.capacity_litres.toString() : '');
        } else {
            resetForm();
        }
    }, [editingSource]);

    const resetForm = () => {
        setName('');
        setSourceType('jar');
        setCapacity('');
        setInitialRate('');
    };

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!name) return;
        setIsSubmitting(true);
        try {
            if (editingSource?.id) {
                // Update existing
                const res = await fetch(`/api/properties/${propertyId}/water/sources/${editingSource.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        name, 
                        source_type: sourceType, 
                        capacity_litres: capacity ? Number(capacity) : null 
                    })
                });
                if (!res.ok) throw new Error('Failed to update');
            } else {
                // Create new
                const res = await fetch(`/api/properties/${propertyId}/water/sources`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        name, 
                        source_type: sourceType, 
                        capacity_litres: capacity ? Number(capacity) : null 
                    })
                });
                if (!res.ok) throw new Error('Failed to create');
                const newSrc = await res.json();
                
                if (initialRate) {
                    await fetch(`/api/properties/${propertyId}/water/tariffs`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source_id: newSrc.id, rate_per_unit: Number(initialRate) })
                    });
                }
            }
            onSuccess();
            setEditingSource(null);
        } catch (error) {
            console.error(error);
            alert('Failed to save source');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to remove this source? Historical data will be kept.')) return;
        try {
            const res = await fetch(`/api/properties/${propertyId}/water/sources/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');
            onSuccess();
        } catch (error) {
            alert('Failed to delete source');
        }
    };

    const bgClass = isDark ? 'bg-[#161b22]' : 'bg-white';
    const textClass = isDark ? 'text-white' : 'text-slate-800';
    const mutedTextClass = isDark ? 'text-slate-400' : 'text-slate-500';
    const borderClass = isDark ? 'border-[#30363d]' : 'border-slate-200';
    const inputBg = isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-white border-slate-300';
    const cardBg = isDark ? 'bg-[#0d1117]' : 'bg-slate-50';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className={`w-full max-w-lg rounded-2xl shadow-xl ${bgClass} overflow-hidden flex flex-col max-h-[90vh]`}>
                <div className={`p-6 border-b ${borderClass} flex justify-between items-center`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isDark ? 'bg-blue-900/20 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                            <Droplets className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className={`text-lg font-bold ${textClass}`}>Configure Water Sources</h2>
                            <p className={`text-sm ${mutedTextClass}`}>Manage tanks and jars</p>
                        </div>
                    </div>
                    <button onClick={onClose} className={`p-2 rounded-full hover:bg-slate-100/10 ${mutedTextClass}`}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {/* List of existing sources */}
                    {!editingSource && (
                        <div className="space-y-3">
                            <h3 className={`text-sm font-bold ${textClass}`}>Existing Sources</h3>
                            {sources.length === 0 ? (
                                <div className={`p-4 rounded-xl border border-dashed ${borderClass} text-center ${mutedTextClass}`}>
                                    No sources configured yet.
                                </div>
                            ) : (
                                sources.map(s => (
                                    <div key={s.id} className={`p-4 rounded-xl border ${borderClass} ${cardBg} flex justify-between items-center`}>
                                        <div>
                                            <div className={`font-bold ${textClass}`}>{s.name}</div>
                                            <div className={`text-xs ${mutedTextClass} uppercase`}>{s.source_type}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" onClick={() => setEditingSource(s)}>Edit</Button>
                                            <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(s.id)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                            <Button className="w-full mt-4" onClick={() => setEditingSource({})}>
                                <Plus className="w-4 h-4 mr-2" /> Add New Source
                            </Button>
                        </div>
                    )}

                    {/* Editor Form */}
                    {editingSource && (
                        <div className="space-y-4">
                            <h3 className={`text-sm font-bold ${textClass}`}>{editingSource.id ? 'Edit Source' : 'New Source'}</h3>
                            
                            <div>
                                <label className={`block text-xs font-bold mb-1 ${mutedTextClass}`}>Name</label>
                                <input 
                                    className={`w-full p-2.5 rounded-lg border ${inputBg}`}
                                    placeholder="e.g. 20L Bisleri Jar"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className={`block text-xs font-bold mb-1 ${mutedTextClass}`}>Type</label>
                                    <select 
                                        className={`w-full p-2.5 rounded-lg border ${inputBg}`}
                                        value={sourceType}
                                        onChange={e => setSourceType(e.target.value as any)}
                                    >
                                        <option value="jar">Drinking Jar</option>
                                        <option value="tanker">Water Tanker</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={`block text-xs font-bold mb-1 ${mutedTextClass}`}>Capacity (Liters)</label>
                                    <input 
                                        type="number"
                                        className={`w-full p-2.5 rounded-lg border ${inputBg}`}
                                        placeholder="Optional"
                                        value={capacity}
                                        onChange={e => setCapacity(e.target.value)}
                                    />
                                </div>
                            </div>

                            {!editingSource.id && (
                                <div>
                                    <label className={`block text-xs font-bold mb-1 ${mutedTextClass}`}>Initial Rate (₹ per unit)</label>
                                    <input 
                                        type="number"
                                        className={`w-full p-2.5 rounded-lg border ${inputBg}`}
                                        placeholder="e.g. 40"
                                        value={initialRate}
                                        onChange={e => setInitialRate(e.target.value)}
                                    />
                                </div>
                            )}

                            <div className="flex gap-3 pt-4">
                                <Button variant="outline" className="flex-1" onClick={() => setEditingSource(null)}>Cancel</Button>
                                <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={handleSubmit} disabled={isSubmitting || !name}>
                                    <Save className="w-4 h-4 mr-2" /> Save Source
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
