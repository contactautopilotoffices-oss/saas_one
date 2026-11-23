'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Label } from '@/frontend/components/ui/label';
import { Plus, Trash2, X } from 'lucide-react';
import { Toast } from '@/frontend/components/ui/Toast';

export interface ShiftConfig {
    id?: string;
    property_id?: string;
    code: string;
    name: string;
    start_time: string | null;
    end_time: string | null;
    is_working_day: boolean;
    color: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    propertyId: string;
    onSaved: () => void;
}

export const DEFAULT_SHIFTS: ShiftConfig[] = [
    { code: 'A', name: 'Morning', start_time: '07:00', end_time: '16:00', is_working_day: true, color: '#38bdf8' },
    { code: 'B', name: 'Afternoon', start_time: '13:00', end_time: '22:00', is_working_day: true, color: '#f59e0b' },
    { code: 'C', name: 'Night', start_time: '22:00', end_time: '07:00', is_working_day: true, color: '#8b5cf6' },
    { code: 'G', name: 'General', start_time: '10:00', end_time: '19:00', is_working_day: true, color: '#10b981' },
    { code: 'WO', name: 'Weekly Off', start_time: null, end_time: null, is_working_day: false, color: '#60a5fa' },
    { code: 'L', name: 'Leave', start_time: null, end_time: null, is_working_day: false, color: '#ef4444' }
];

export const PRESET_SHIFT_COLORS = [
    { name: 'Sky Blue', hex: '#38bdf8' },
    { name: 'Blue', hex: '#3b82f6' },
    { name: 'Emerald', hex: '#10b981' },
    { name: 'Amber', hex: '#f59e0b' },
    { name: 'Red', hex: '#ef4444' },
    { name: 'Purple', hex: '#8b5cf6' },
    { name: 'Pink', hex: '#ec4899' },
    { name: 'Teal', hex: '#14b8a6' },
    { name: 'Slate Gray', hex: '#64748b' },
];

export function getContrastTextColor(hexColor?: string | null): string {
    if (!hexColor || hexColor === 'transparent') return '#0f172a';
    const hex = hexColor.replace('#', '').trim();
    if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#0f172a';
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 135 ? '#0f172a' : '#ffffff';
    }
    if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#0f172a';
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 135 ? '#0f172a' : '#ffffff';
    }
    return '#0f172a';
}

export function ShiftConfigModal({ open, onOpenChange, propertyId, onSaved }: Props) {
    const [configs, setConfigs] = useState<ShiftConfig[]>([]);
    const [loading, setLoading] = useState(false);
    const [notification, setNotification] = useState<{message: string, type: 'success'|'error'} | null>(null);

    useEffect(() => {
        if (open && propertyId) {
            fetchConfigs();
        }
    }, [open, propertyId]);

    const fetchConfigs = async () => {
        try {
            const res = await fetch(`/api/roster/config?propertyId=${propertyId}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            if (data.data && data.data.length > 0) {
                const existingCodes = new Set(data.data.map((c: any) => c.code));
                const missingDefaults = DEFAULT_SHIFTS.filter(d => !existingCodes.has(d.code));
                setConfigs([...data.data, ...missingDefaults]);
            } else {
                setConfigs(DEFAULT_SHIFTS);
            }
        } catch (error) {
            console.error('Failed to fetch configs', error);
        }
    };

    const handleAdd = () => {
        const nextColor = PRESET_SHIFT_COLORS[configs.length % PRESET_SHIFT_COLORS.length].hex;
        setConfigs([...configs, {
            code: '',
            name: '',
            start_time: '09:00',
            end_time: '18:00',
            is_working_day: true,
            color: nextColor
        }]);
    };

    const handleUpdate = (index: number, field: keyof ShiftConfig, value: any) => {
        const newConfigs = [...configs];
        newConfigs[index] = { ...newConfigs[index], [field]: value };
        setConfigs(newConfigs);
    };

    const handleRemove = (index: number) => {
        const newConfigs = [...configs];
        newConfigs.splice(index, 1);
        setConfigs(newConfigs);
    };

    const handleSave = async () => {
        // Validate
        for (const c of configs) {
            if (!c.code.trim() || !c.name.trim()) {
                setNotification({ message: 'Code and Name are required for all shifts', type: 'error' });
                return;
            }
        }

        setLoading(true);
        try {
            const res = await fetch('/api/roster/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ propertyId, configs })
            });

            if (!res.ok) throw new Error('Failed to save');
            
            setNotification({ message: 'Shift configurations saved', type: 'success' });
            onSaved();
            setTimeout(() => onOpenChange(false), 1000);
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Failed to save shift configurations', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto">
            <Toast 
                message={notification?.message || ''} 
                type={notification?.type || 'info'} 
                visible={!!notification} 
                onClose={() => setNotification(null)} 
            />
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-8">
                <div className="flex items-center justify-between p-4 border-b">
                    <div>
                        <h2 className="text-lg font-bold">Manage Shift Configurations</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Define shift codes, names, work hours, and color codes for the roster board.</p>
                    </div>
                    <button onClick={() => onOpenChange(false)} className="text-gray-500 hover:bg-gray-100 rounded-full p-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 space-y-3.5 max-h-[65vh] overflow-y-auto">
                    {configs.length === 0 && (
                        <p className="text-sm text-gray-500 text-center py-4">No shift codes defined. Add one below.</p>
                    )}
                    
                    {configs.map((config, index) => {
                        const shiftColor = config.color || '#3b82f6';
                        const textColor = getContrastTextColor(shiftColor);
                        return (
                            <div key={index} className="grid grid-cols-12 gap-3 items-center bg-gray-50 p-3.5 rounded-xl border border-gray-200">
                                <div className="col-span-2">
                                    <Label className="text-xs font-semibold">Code</Label>
                                    <Input 
                                        value={config.code} 
                                        onChange={e => handleUpdate(index, 'code', e.target.value.toUpperCase())}
                                        placeholder="A"
                                        maxLength={6}
                                        className="h-9 font-bold text-center uppercase"
                                    />
                                </div>
                                <div className="col-span-3">
                                    <Label className="text-xs font-semibold">Shift Name</Label>
                                    <Input 
                                        value={config.name} 
                                        onChange={e => handleUpdate(index, 'name', e.target.value)}
                                        placeholder="Morning Shift"
                                        className="h-9"
                                    />
                                </div>
                                <div className="col-span-3">
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="text-xs font-semibold">Color Code</Label>
                                        <span 
                                            className="text-[10px] font-bold px-1.5 py-0.5 rounded shadow-2xs border border-black/10"
                                            style={{ 
                                                backgroundColor: shiftColor, 
                                                color: textColor 
                                            }}
                                        >
                                            {config.code || 'Preview'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="relative shrink-0">
                                            <input 
                                                type="color" 
                                                value={config.color && /^#[0-9A-Fa-f]{6}$/.test(config.color) ? config.color : '#3b82f6'} 
                                                onChange={e => handleUpdate(index, 'color', e.target.value)}
                                                className="w-8 h-8 rounded-lg border border-gray-300 cursor-pointer p-0.5 bg-white shadow-xs"
                                                title="Pick custom color"
                                            />
                                        </div>
                                        <Input 
                                            value={config.color || '#3b82f6'} 
                                            onChange={e => handleUpdate(index, 'color', e.target.value)}
                                            placeholder="#3b82f6"
                                            className="h-8 text-xs font-mono uppercase px-2 w-22 shrink-0"
                                            maxLength={7}
                                        />
                                        <div className="flex items-center gap-1 flex-wrap">
                                            {PRESET_SHIFT_COLORS.slice(0, 4).map(p => (
                                                <button
                                                    key={p.hex}
                                                    type="button"
                                                    onClick={() => handleUpdate(index, 'color', p.hex)}
                                                    className={`w-3.5 h-3.5 rounded-full border transition-transform hover:scale-125 ${config.color?.toLowerCase() === p.hex.toLowerCase() ? 'ring-2 ring-primary ring-offset-1 scale-110' : 'border-black/15'}`}
                                                    style={{ backgroundColor: p.hex }}
                                                    title={p.name}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="col-span-1 text-center">
                                    <Label className="text-xs font-semibold block mb-1">Working?</Label>
                                    <div className="flex justify-center">
                                        <input 
                                            type="checkbox"
                                            className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                                            checked={config.is_working_day}
                                            onChange={e => handleUpdate(index, 'is_working_day', e.target.checked)}
                                        />
                                    </div>
                                </div>
                                {config.is_working_day ? (
                                    <div className="col-span-2 grid grid-cols-2 gap-1.5">
                                        <div>
                                            <Label className="text-[10px] font-semibold text-gray-500">Start</Label>
                                            <Input 
                                                type="time" 
                                                value={config.start_time || ''} 
                                                onChange={e => handleUpdate(index, 'start_time', e.target.value)}
                                                className="h-8 text-xs px-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-[10px] font-semibold text-gray-500">End</Label>
                                            <Input 
                                                type="time" 
                                                value={config.end_time || ''} 
                                                onChange={e => handleUpdate(index, 'end_time', e.target.value)}
                                                className="h-8 text-xs px-1"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="col-span-2 flex items-center justify-center">
                                        <span className="text-xs text-gray-400 italic">Off-duty / Leave</span>
                                    </div>
                                )}
                                <div className="col-span-1 flex justify-end">
                                    <Button variant="ghost" size="icon" onClick={() => handleRemove(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}

                    <Button variant="outline" className="w-full mt-4" onClick={handleAdd}>
                        <Plus className="h-4 w-4 mr-2" /> Add Shift Code
                    </Button>
                </div>

                <div className="flex items-center justify-end gap-3 p-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={loading}>
                        {loading ? 'Saving...' : 'Save Configurations'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
