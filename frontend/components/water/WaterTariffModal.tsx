import React, { useState, useEffect } from 'react';
import { X, Plus, Save, IndianRupee, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { format } from 'date-fns';

interface Source {
    id: string;
    name: string;
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

export default function WaterTariffModal({ isOpen, onClose, propertyId, sources, onSuccess, isDark = false }: Props) {
    const [selectedSourceId, setSelectedSourceId] = useState<string>('');
    const [rate, setRate] = useState('');
    const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingTariffId, setDeletingTariffId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && sources.length > 0 && !selectedSourceId) {
            setSelectedSourceId(sources[0].id);
        }
    }, [isOpen, sources]);

    if (!isOpen) return null;

    const activeSource = sources.find(s => s.id === selectedSourceId);
    
    // Sort tariffs descending by date
    const sortedTariffs = activeSource?.water_tariffs?.slice().sort((a, b) => 
        new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime()
    ) || [];

    const handleSubmit = async () => {
        if (!selectedSourceId || !rate) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/properties/${propertyId}/water/tariffs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    source_id: selectedSourceId, 
                    rate_per_unit: Number(rate),
                    effective_from: effectiveDate
                })
            });
            if (!res.ok) throw new Error('Failed to update tariff');
            
            setRate('');
            onSuccess();
        } catch (error) {
            console.error(error);
            alert('Failed to save tariff');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteTariff = async (tariffId: string) => {
        if (!confirm('Are you sure you want to delete this pricing?')) return;
        setDeletingTariffId(tariffId);
        try {
            const res = await fetch(`/api/properties/${propertyId}/water/tariffs/${tariffId}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete tariff');
            onSuccess();
        } catch (error) {
            console.error(error);
            alert('Failed to delete tariff');
        } finally {
            setDeletingTariffId(null);
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
                        <div className={`p-2 rounded-lg ${isDark ? 'bg-emerald-900/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                            <IndianRupee className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className={`text-lg font-bold ${textClass}`}>Update Water Pricing</h2>
                            <p className={`text-sm ${mutedTextClass}`}>Manage vendor rates</p>
                        </div>
                    </div>
                    <button onClick={onClose} className={`p-2 rounded-full hover:bg-slate-100/10 ${mutedTextClass}`}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {/* Source Selector */}
                    <div>
                        <label className={`block text-xs font-bold mb-2 ${mutedTextClass}`}>Select Water Source</label>
                        <select 
                            className={`w-full p-2.5 rounded-lg border ${inputBg} font-medium`}
                            value={selectedSourceId}
                            onChange={e => setSelectedSourceId(e.target.value)}
                        >
                            {sources.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Active Tariffs History */}
                    {activeSource && (
                        <div className="space-y-2">
                            <h3 className={`text-xs font-bold uppercase tracking-wider ${mutedTextClass}`}>Price History</h3>
                            {sortedTariffs.length === 0 ? (
                                <p className={`text-sm ${mutedTextClass} italic`}>No pricing configured.</p>
                            ) : (
                                <div className={`border ${borderClass} rounded-xl overflow-hidden`}>
                                    {sortedTariffs.map((t, i) => (
                                        <div key={t.id} className={`flex justify-between items-center p-3 ${i % 2 === 0 ? cardBg : bgClass} ${i !== sortedTariffs.length - 1 ? `border-b ${borderClass}` : ''}`}>
                                            <div>
                                                <div className={`text-sm font-medium ${textClass}`}>
                                                    ₹{t.rate_per_unit} / unit
                                                </div>
                                                <div className={`text-xs ${mutedTextClass} mt-0.5`}>
                                                    From {format(new Date(t.effective_from), 'dd/MM/yyyy')} {i === 0 && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">ACTIVE</span>}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteTariff(t.id)}
                                                disabled={deletingTariffId === t.id}
                                                className={`p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-50`}
                                                title="Delete Pricing"
                                            >
                                                {deletingTariffId === t.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* New Tariff Form */}
                    <div className={`p-4 rounded-xl border border-blue-200 bg-blue-50/50 space-y-4`}>
                        <h3 className="text-sm font-bold text-blue-900">Set New Price</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold mb-1 text-blue-800">New Rate (₹)</label>
                                <input 
                                    type="number"
                                    className="w-full p-2.5 rounded-lg border border-blue-200 bg-white"
                                    placeholder="0.00"
                                    value={rate}
                                    onChange={e => setRate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold mb-1 text-blue-800">Effective From</label>
                                <input 
                                    type="date"
                                    className="w-full p-2.5 rounded-lg border border-blue-200 bg-white"
                                    value={effectiveDate}
                                    onChange={e => setEffectiveDate(e.target.value)}
                                />
                            </div>
                        </div>
                        <Button 
                            className="w-full bg-blue-600 hover:bg-blue-700" 
                            onClick={handleSubmit} 
                            disabled={isSubmitting || !rate}
                        >
                            {isSubmitting ? 'Saving...' : 'Apply New Rate'}
                        </Button>
                    </div>

                </div>
            </div>
        </div>
    );
}
