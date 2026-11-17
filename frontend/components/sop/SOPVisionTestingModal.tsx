'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Sparkles, FlaskConical, CheckCircle2, AlertCircle, RefreshCw, Plus, Trash2, Calendar, ShieldCheck, ArrowRight, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ParameterItem {
    name: string;
}

interface SOPVisionTestingModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
}

const DEFAULT_PRESETS: Record<string, string[]> = {
    'Meeting Room': [
        'Tabletop cleared of all laptops and personal items',
        'Cables & power cords tucked away neatly',
        'Chairs pushed in and aligned uniformly',
        'Floor clean with zero trash or paper debris',
    ],
    'Cafeteria': [
        'Dining tables sanitized with no food crumbs or stains',
        'Floor mopped and shiny',
        'Trash bins emptied with fresh liners',
        'Chairs arranged neatly around tables',
    ],
    'Restroom': [
        'Countertop and mirrors dry and spotless',
        'Washbasins sanitized with no soap scum',
        'Soap & tissue paper dispensers stocked',
        'Floor dry and free of water puddles',
    ],
};

export const SOPVisionTestingModal: React.FC<SOPVisionTestingModalProps> = ({
    isOpen,
    onClose,
    propertyId,
}) => {
    // Images (Data URLs)
    const [referenceImage, setReferenceImage] = useState<string | null>(null);
    const [fieldImage, setFieldImage] = useState<string | null>(null);
    const [fieldFileName, setFieldFileName] = useState<string | null>(null);
    const [fieldFileLastModified, setFieldFileLastModified] = useState<number | null>(null);

    // Inspection Configuration
    const [stepTitle, setStepTitle] = useState('Meeting Room Conference Table Inspection');
    const [expectedDate, setExpectedDate] = useState(() => {
        const today = new Date();
        const d = String(today.getDate()).padStart(2, '0');
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const y = today.getFullYear();
        return `${d}/${m}/${y}`;
    });

    // Parameters
    const [parameters, setParameters] = useState<ParameterItem[]>([
        { name: 'Tabletop surface cleared of all laptops and items' },
        { name: 'Chairs tucked in and aligned uniformly' },
        { name: 'Floor clean with zero debris' },
    ]);
    const [newParamText, setNewParamText] = useState('');

    // Execution & Results State
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    // File readers
    const handleFileRead = (file: File, setter: (val: string) => void) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                setter(reader.result);
                setResult(null);
                setError(null);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleAddParam = () => {
        if (!newParamText.trim()) return;
        setParameters(prev => [...prev, { name: newParamText.trim() }]);
        setNewParamText('');
    };

    const handleRemoveParam = (index: number) => {
        setParameters(prev => prev.filter((_, idx) => idx !== index));
    };

    const handleApplyPreset = (presetKey: string) => {
        const presetItems = DEFAULT_PRESETS[presetKey] || [];
        setParameters(presetItems.map(p => ({ name: p })));
        setStepTitle(`${presetKey} Cleanliness Inspection`);
    };

    const handleRunTest = async () => {
        if (!referenceImage || !fieldImage) {
            setError('Please upload both the Clean Reference Image and the Test Field Image.');
            return;
        }

        setIsRunning(true);
        setError(null);
        setResult(null);

        try {
            const res = await fetch(`/api/properties/${propertyId}/sop/test-vision`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    referenceImage,
                    fieldImage,
                    parameters,
                    stepTitle,
                    expectedDate,
                    fieldFileName,
                    fieldFileLastModified,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to analyze vision images');
            }

            setResult(data);
        } catch (err: any) {
            setError(err.message || 'Vision scoring request failed');
        } finally {
            setIsRunning(false);
        }
    };

    const modalContent = (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-4xl my-auto overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                            <FlaskConical size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-black text-slate-800 tracking-tight">AI Vision Testing Lab</h3>
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-violet-100 text-violet-800">
                                    Qwen 3.8 27B
                                </span>
                            </div>
                            <p className="text-xs text-slate-500">
                                Upload a clean benchmark photo and test image to preview scoring, timestamp verification, and feedback.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    {/* Error Banner */}
                    {error && (
                        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
                            <AlertCircle size={16} className="flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* 1. Image Upload Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Reference Image Box */}
                        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-4 bg-slate-50/50 flex flex-col items-center justify-center text-center relative group min-h-[220px]">
                            {referenceImage ? (
                                <div className="relative w-full h-48 rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center">
                                    <img src={referenceImage} alt="Clean Reference" className="w-full h-full object-contain" />
                                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[9px] font-black uppercase tracking-wider">
                                        Image 1 · Clean Benchmark
                                    </div>
                                    <button
                                        onClick={() => setReferenceImage(null)}
                                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white hover:bg-rose-500 flex items-center justify-center transition-all"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-4">
                                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-2 shadow-xs">
                                        <Upload size={20} />
                                    </div>
                                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider">Upload Clean Benchmark Photo</span>
                                    <span className="text-[10px] text-slate-400 mt-1">
                                        The ideal standard photo (cleared surfaces, clean, ready for use)
                                    </span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => e.target.files?.[0] && handleFileRead(e.target.files[0], setReferenceImage)}
                                    />
                                </label>
                            )}
                        </div>

                        {/* Field Image Box */}
                        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-4 bg-slate-50/50 flex flex-col items-center justify-center text-center relative group min-h-[220px]">
                            {fieldImage ? (
                                <div className="relative w-full h-48 rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center">
                                    <img src={fieldImage} alt="Test Field Capture" className="w-full h-full object-contain" />
                                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[9px] font-black uppercase tracking-wider">
                                        Image 2 · Test Field Photo
                                    </div>
                                    {fieldFileName && (
                                        <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-xs text-white text-[10px] font-mono truncate text-left border border-white/10">
                                            📁 {fieldFileName}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            setFieldImage(null);
                                            setFieldFileName(null);
                                            setFieldFileLastModified(null);
                                        }}
                                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white hover:bg-rose-500 flex items-center justify-center transition-all"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-4">
                                    <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mb-2 shadow-xs">
                                        <Upload size={20} />
                                    </div>
                                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider">Upload Test Field Photo</span>
                                    <span className="text-[10px] text-slate-400 mt-1">
                                        Upload a messy, clean, or old photo to test classification
                                    </span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                setFieldFileName(file.name);
                                                setFieldFileLastModified(file.lastModified);
                                                handleFileRead(file, setFieldImage);
                                            }
                                        }}
                                    />
                                </label>
                            )}
                        </div>
                    </div>

                    {/* 2. Step Title & Scheduled Date */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80">
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1 block">Checklist Step Name</label>
                            <input
                                type="text"
                                value={stepTitle}
                                onChange={(e) => setStepTitle(e.target.value)}
                                className="w-full px-3 py-2 text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-primary"
                                placeholder="e.g. Conference Table Clearance & Sanitization"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1 block">Scheduled Date (DD/MM/YYYY)</label>
                            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5">
                                <Calendar size={13} className="text-slate-400" />
                                <input
                                    type="text"
                                    value={expectedDate}
                                    onChange={(e) => setExpectedDate(e.target.value)}
                                    className="w-full text-xs font-bold text-slate-800 focus:outline-none"
                                    placeholder="DD/MM/YYYY"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 3. Parameter Configuration */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                                    Configured Parameters ({parameters.length})
                                </h4>
                                <span className="text-[10px] text-slate-400 font-medium">Checked individually by AI</span>
                            </div>
                            {/* Preset Buttons */}
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">Presets:</span>
                                {Object.keys(DEFAULT_PRESETS).map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => handleApplyPreset(key)}
                                        className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"
                                    >
                                        {key}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Parameter list */}
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {parameters.map((param, idx) => (
                                <div key={idx} className="flex items-center justify-between px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <span className="w-5 h-5 rounded-md bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-black">
                                            {idx + 1}
                                        </span>
                                        <span className="text-xs font-bold text-slate-700">{param.name}</span>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveParam(idx)}
                                        className="text-slate-400 hover:text-rose-500 p-1 transition-all"
                                        title="Remove parameter"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Add parameter input */}
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={newParamText}
                                onChange={(e) => setNewParamText(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddParam()}
                                placeholder="Add custom parameter (e.g. 'Trash can emptied', 'Lights switched off')"
                                className="flex-1 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-primary"
                            />
                            <button
                                type="button"
                                onClick={handleAddParam}
                                className="px-3 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-900 transition-all flex items-center gap-1 flex-shrink-0"
                            >
                                <Plus size={14} />
                                <span>Add</span>
                            </button>
                        </div>
                    </div>

                    {/* 4. Action Button */}
                    <div className="pt-2">
                        <button
                            onClick={handleRunTest}
                            disabled={isRunning || !referenceImage || !fieldImage}
                            className="w-full py-3.5 bg-primary text-white rounded-2xl font-black uppercase tracking-wider text-xs hover:opacity-95 transition-all shadow-lg shadow-primary/20 disabled:opacity-40 flex items-center justify-center gap-2"
                        >
                            {isRunning ? (
                                <>
                                    <RefreshCw size={15} className="animate-spin" />
                                    <span>AI Vision Analyzing Images & Parameters...</span>
                                </>
                            ) : (
                                <>
                                    <Sparkles size={15} />
                                    <span>Run AI Vision Audit Test</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* 5. Results Panel */}
                    {result && (
                        <motion.div
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`p-5 rounded-2xl border ${
                                result.pass
                                    ? 'bg-emerald-50/70 border-emerald-200'
                                    : 'bg-rose-50/70 border-rose-200'
                            } space-y-4`}
                        >
                            {/* Score & Status Header */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`w-12 h-12 rounded-2xl ${
                                            result.pass ? 'bg-emerald-500' : 'bg-rose-500'
                                        } text-white flex items-center justify-center shadow-md`}
                                    >
                                        <span className="text-xl font-black">{result.score}</span>
                                    </div>
                                    <div>
                                        <span
                                            className={`text-xs font-black uppercase tracking-wider block ${
                                                result.pass ? 'text-emerald-800' : 'text-rose-800'
                                            }`}
                                        >
                                            {result.pass ? 'Audit Passed · Cleanliness Verified' : 'Action Required · Audit Failed'}
                                        </span>
                                        <span className="text-[10px] text-slate-500 font-medium block">
                                            Model: {result.modelUsed || 'Qwen Vision'}
                                        </span>
                                        {result.timestamp_detected && (
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Timestamp:</span>
                                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                                                    result.is_stale_image
                                                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                                        : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                                }`}>
                                                    {result.timestamp_detected}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span
                                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                            result.pass
                                                ? 'bg-emerald-200/80 text-emerald-900'
                                                : 'bg-rose-200/80 text-rose-900'
                                        }`}
                                    >
                                        {result.pass ? 'Pass (Score >= 70)' : 'Fail / Veto Triggered'}
                                    </span>
                                </div>
                            </div>

                            {/* Human Explanation: What was detected */}
                            <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/80 space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                    AI Observation & Guidance:
                                </p>
                                <p className="text-xs text-slate-700 font-medium leading-relaxed">
                                    {result.reason}
                                </p>
                            </div>

                            {/* Parameter Breakdown */}
                            {Array.isArray(result.parameters) && result.parameters.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                        Parameter-by-Parameter Inspection Results:
                                    </p>
                                    <div className="space-y-1.5">
                                        {result.parameters.map((p: any, idx: number) => {
                                            const pPass = p.status === 'pass';
                                            const pFail = p.status === 'fail';
                                            return (
                                                <div
                                                    key={idx}
                                                    className="p-3 rounded-xl bg-white/95 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                                                pPass ? 'bg-emerald-500' : pFail ? 'bg-rose-500' : 'bg-slate-400'
                                                            }`}
                                                        />
                                                        <span className="text-xs font-bold text-slate-800">{p.name}</span>
                                                        <span
                                                            className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                                                                pPass
                                                                    ? 'bg-emerald-100 text-emerald-800'
                                                                    : pFail
                                                                        ? 'bg-rose-100 text-rose-800'
                                                                        : 'bg-slate-100 text-slate-600'
                                                            }`}
                                                        >
                                                            {pPass ? 'Pass' : pFail ? 'Fail' : 'N/A'}
                                                        </span>
                                                        {typeof p.score === 'number' && (
                                                            <span className="text-[10px] font-black text-slate-600">
                                                                {p.score}/100
                                                            </span>
                                                        )}
                                                    </div>
                                                    {p.reason && (
                                                        <p className="text-[11px] text-slate-500 font-medium sm:text-right sm:max-w-[55%]">
                                                            {p.reason}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                </div>
            </motion.div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
};

export default SOPVisionTestingModal;
