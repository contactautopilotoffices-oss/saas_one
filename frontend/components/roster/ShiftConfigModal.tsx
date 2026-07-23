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

const DEFAULT_SHIFTS: ShiftConfig[] = [
    { code: 'A', name: 'Morning', start_time: '07:00', end_time: '16:00', is_working_day: true, color: '#f1f5f9' },
    { code: 'B', name: 'Afternoon', start_time: '13:00', end_time: '22:00', is_working_day: true, color: '#f1f5f9' },
    { code: 'C', name: 'Night', start_time: '22:00', end_time: '07:00', is_working_day: true, color: '#f1f5f9' },
    { code: 'G', name: 'General', start_time: '10:00', end_time: '19:00', is_working_day: true, color: '#f1f5f9' },
    { code: 'WO', name: 'Weekly Off', start_time: null, end_time: null, is_working_day: false, color: '#f1f5f9' },
    { code: 'L', name: 'Leave', start_time: null, end_time: null, is_working_day: false, color: '#f1f5f9' }
];

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
        setConfigs([...configs, {
            code: '',
            name: '',
            start_time: '09:00',
            end_time: '18:00',
            is_working_day: true,
            color: '#f1f5f9'
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
            <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8">
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-bold">Manage Shift Configurations</h2>
                    <button onClick={() => onOpenChange(false)} className="text-gray-500 hover:bg-gray-100 rounded-full p-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    {configs.length === 0 && (
                        <p className="text-sm text-gray-500 text-center py-4">No shift codes defined. Add one below.</p>
                    )}
                    
                    {configs.map((config, index) => (
                        <div key={index} className="grid grid-cols-12 gap-4 items-center bg-gray-50 p-4 rounded-lg border">
                            <div className="col-span-2">
                                <Label className="text-xs">Code (e.g. A)</Label>
                                <Input 
                                    value={config.code} 
                                    onChange={e => handleUpdate(index, 'code', e.target.value.toUpperCase())}
                                    placeholder="A"
                                    maxLength={5}
                                />
                            </div>
                            <div className="col-span-3">
                                <Label className="text-xs">Name</Label>
                                <Input 
                                    value={config.name} 
                                    onChange={e => handleUpdate(index, 'name', e.target.value)}
                                    placeholder="Morning Shift"
                                />
                            </div>
                            <div className="col-span-2 text-center">
                                <Label className="text-xs">Working Day?</Label>
                                <div className="mt-2 flex justify-center">
                                    <input 
                                        type="checkbox"
                                        className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={config.is_working_day}
                                        onChange={e => handleUpdate(index, 'is_working_day', e.target.checked)}
                                    />
                                </div>
                            </div>
                            {config.is_working_day ? (
                                <>
                                    <div className="col-span-2">
                                        <Label className="text-xs">Start Time</Label>
                                        <Input 
                                            type="time" 
                                            value={config.start_time || ''} 
                                            onChange={e => handleUpdate(index, 'start_time', e.target.value)}
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <Label className="text-xs">End Time</Label>
                                        <Input 
                                            type="time" 
                                            value={config.end_time || ''} 
                                            onChange={e => handleUpdate(index, 'end_time', e.target.value)}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="col-span-4 flex items-center px-4">
                                    <span className="text-sm text-gray-500 italic">Off-duty / Leave</span>
                                </div>
                            )}
                            <div className="col-span-1 flex justify-end">
                                <Button variant="ghost" size="icon" onClick={() => handleRemove(index)} className="text-red-500">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}

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
