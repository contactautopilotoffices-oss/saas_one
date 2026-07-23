import React, { useState } from 'react';
import { Button } from '@/frontend/components/ui/button';
import { X } from 'lucide-react';

interface CustomTimeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (startTime: string, endTime: string) => void;
    title?: string;
}

export function CustomTimeModal({ isOpen, onClose, onSubmit, title = "Add Custom Shift Time" }: CustomTimeModalProps) {
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('18:00');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Time input values are in HH:MM format
        if (startTime && endTime) {
            onSubmit(startTime, endTime);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                    <h3 className="font-semibold text-lg text-gray-800">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-white rounded-full p-1 border">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Start Time</label>
                                <input
                                    type="time"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    required
                                    className="w-full border-slate-200 rounded-xl focus:ring-primary focus:border-primary text-slate-900"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">End Time</label>
                                <input
                                    type="time"
                                    value={endTime}
                                    onChange={(e) => setEndTime(e.target.value)}
                                    required
                                    className="w-full border-slate-200 rounded-xl focus:ring-primary focus:border-primary text-slate-900"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="primary">
                                Save
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
