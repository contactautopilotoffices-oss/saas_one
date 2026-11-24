'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, ExternalLink, Eye, EyeOff, Crosshair, Loader2, AlertCircle, ChevronLeft, ChevronRight, Camera } from 'lucide-react';
import { maskStorageUrl } from '@/frontend/utils/storageUrl';

export interface DefectBox {
    box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
    label?: string;
}

export interface PreviewAngleTab {
    index: number;
    label: string;
    url: string;
    boxCount?: number;
    hasMarks?: boolean;
}

interface ImagePreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageUrl: string | null;
    title?: string;
    boxes?: DefectBox[];
    isLoadingBoxes?: boolean;
    activeBoxLabel?: string;
    onLocateDefect?: () => void;
    /** Step through the set this image belongs to, with ← / → or the on-image arrows. */
    onPrev?: () => void;
    onNext?: () => void;
    /** e.g. "Proof 2 of 3" — shown next to the arrows. */
    positionLabel?: string;
    /** Multi-angle tabs for steps with multiple photo angles */
    angles?: PreviewAngleTab[];
    activeAngleIndex?: number;
    onSelectAngle?: (index: number) => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
    isOpen,
    onClose,
    imageUrl,
    title,
    boxes = [],
    isLoadingBoxes = false,
    activeBoxLabel,
    onLocateDefect,
    onPrev,
    onNext,
    positionLabel,
    angles,
    activeAngleIndex,
    onSelectAngle,
}) => {
    // Marks are on by default for every image. Tracking the one image the viewer has turned them
    // off for derives the toggle from props instead of resetting state inside an effect, which
    // triggered a second render pass every time the modal opened.
    const [marksHiddenFor, setMarksHiddenFor] = useState<string | null>(null);

    // Escape closes, arrows step through the set, so comparing photos does not mean
    // closing the modal and hunting for the next thumbnail.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowLeft') onPrev?.();
            else if (e.key === 'ArrowRight') onNext?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose, onPrev, onNext]);

    if (!imageUrl) return null;

    const safeUrl = maskStorageUrl(imageUrl) || imageUrl;
    const showMarks = marksHiddenFor !== safeUrl;
    const toggleMarks = () => setMarksHiddenFor(showMarks ? safeUrl : null);

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = safeUrl;
        link.download = `checklist-audit-proof-${Date.now()}.webp`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const hasBoxes = boxes && boxes.length > 0;
    const isDefect = Boolean(
        activeBoxLabel && (
            activeBoxLabel.toUpperCase().includes('FAIL') ||
            activeBoxLabel.toUpperCase().includes('DEFECT') ||
            activeBoxLabel.toUpperCase().includes('NEEDS_ATTENTION') ||
            activeBoxLabel.toUpperCase().includes('NEEDS ATTENTION')
        )
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 md:p-6">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm"
                    />

                    {/* Content */}
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="relative w-full max-w-5xl bg-white rounded-2xl md:rounded-[2rem] overflow-hidden shadow-2xl flex flex-col max-h-[96vh] sm:max-h-[92vh]"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-3 sm:p-4 md:p-5 border-b border-slate-100 flex-wrap gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-sm md:text-base font-black text-slate-900 tracking-tight truncate">
                                        {title || 'Photo Preview'}
                                    </h3>
                                    {activeBoxLabel && (
                                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                            isDefect
                                                ? 'bg-rose-100 text-rose-700 border-rose-200'
                                                : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                        }`}>
                                            {activeBoxLabel}
                                        </span>
                                    )}
                                </div>
                                <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                    Checklist Visual Proof {hasBoxes ? `· ${boxes.length} ${isDefect ? 'Issue' : 'Visual'} Mark${boxes.length > 1 ? 's' : ''}` : ''}
                                </p>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-1.5 sm:gap-2">
                                {/* Toggle AI Marks Button */}
                                {(hasBoxes || isLoadingBoxes) && (
                                    <button
                                        type="button"
                                        onClick={toggleMarks}
                                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border cursor-pointer ${
                                            showMarks
                                                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                                        }`}
                                        title={showMarks ? 'Hide defect marks' : 'Show defect marks'}
                                    >
                                        {showMarks ? <Eye size={13} /> : <EyeOff size={13} />}
                                        <span className="hidden sm:inline">Marks:</span> {showMarks ? 'ON' : 'OFF'}
                                    </button>
                                )}

                                {/* Manual Locate Trigger if available and not yet loaded */}
                                {onLocateDefect && !hasBoxes && !isLoadingBoxes && (
                                    <button
                                        type="button"
                                        onClick={onLocateDefect}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-wider hover:bg-primary/20 transition-all cursor-pointer"
                                    >
                                        <Crosshair size={13} />
                                        <span>Show AI Marks</span>
                                    </button>
                                )}

                                <a
                                    href={safeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-all"
                                    title="Open image in new tab"
                                >
                                    <ExternalLink size={17} />
                                </a>
                                <button
                                    onClick={handleDownload}
                                    className="p-2 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-all"
                                    title="Download Image"
                                >
                                    <Download size={17} />
                                </button>
                                <button
                                    onClick={onClose}
                                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                                    title="Close"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Multi-Angle Switcher Tabs: when step has multiple photo angles */}
                        {angles && angles.length > 1 && (
                            <div className="flex items-center gap-2 px-3 sm:px-5 py-2.5 bg-slate-50 border-b border-slate-200/80 overflow-x-auto scrollbar-thin">
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 mr-1 flex items-center gap-1.5 flex-shrink-0">
                                    <Camera size={12} className="text-primary" />
                                    Photo Angles ({angles.length}):
                                </span>
                                {angles.map((ang) => {
                                    const isSelected = ang.index === activeAngleIndex || ang.url === imageUrl;
                                    const hasMarks = (ang.boxCount !== undefined && ang.boxCount > 0) || ang.hasMarks;
                                    return (
                                        <button
                                            key={ang.index}
                                            type="button"
                                            onClick={() => onSelectAngle?.(ang.index)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex-shrink-0 border ${
                                                isSelected
                                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm ring-2 ring-blue-300'
                                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                                            }`}
                                            title={`Switch to ${ang.label || `Angle #${ang.index + 1}`}`}
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : hasMarks ? 'bg-rose-500' : 'bg-blue-500'}`} />
                                            <span>{ang.label || `Angle #${ang.index + 1}`}</span>
                                            {ang.boxCount !== undefined && ang.boxCount > 0 && (
                                                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${
                                                    isSelected ? 'bg-white/25 text-white' : 'bg-rose-100 text-rose-700 border border-rose-200'
                                                }`}>
                                                    {ang.boxCount} {ang.boxCount === 1 ? 'mark' : 'marks'}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* Image Viewer Container */}
                        <div className="flex-1 overflow-auto bg-slate-950/95 flex items-center justify-center p-2 sm:p-4 min-h-0 relative">
                            {/* Step through the set without leaving the viewer (← / → work too) */}
                            {onPrev && (
                                <button
                                    type="button"
                                    onClick={onPrev}
                                    aria-label="Previous photo"
                                    className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-sm transition-colors cursor-pointer"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                            )}
                            {onNext && (
                                <button
                                    type="button"
                                    onClick={onNext}
                                    aria-label="Next photo"
                                    className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-sm transition-colors cursor-pointer"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            )}
                            {positionLabel && (
                                <span className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-2.5 py-1 rounded-full bg-black/60 text-white text-[10px] font-bold backdrop-blur-sm">
                                    {positionLabel}
                                </span>
                            )}
                            {/* Inner wrapper matching exact rendered image bounds */}
                            <div className="relative inline-block max-w-full max-h-[62vh] sm:max-h-[72vh] select-none">
                                <motion.img
                                    layoutId="preview-image"
                                    src={safeUrl}
                                    alt="Preview"
                                    className="block max-w-full max-h-[62vh] sm:max-h-[72vh] w-auto h-auto object-contain rounded-lg shadow-2xl border border-white/20"
                                />

                                {/* Glowing Scanning laser line while locating defect */}
                                {isLoadingBoxes && (
                                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg">
                                        <motion.div
                                            initial={{ top: '0%' }}
                                            animate={{ top: ['0%', '98%', '0%'] }}
                                            transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                                            className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-rose-500 to-transparent shadow-[0_0_15px_rgba(244,63,94,1)] z-30"
                                        />
                                        <div className="absolute inset-0 bg-rose-500/5 backdrop-blur-[0.5px] z-20 flex items-center justify-center">
                                            <div className="px-3 py-1.5 rounded-full bg-slate-900/90 border border-rose-500/40 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 shadow-2xl">
                                                <Loader2 size={13} className="text-rose-400 animate-spin" />
                                                Locating defect with AI vision...
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Bounding Box Overlays */}
                                {showMarks && !isLoadingBoxes && hasBoxes && boxes.map((box, bIdx) => {
                                    const [ymin, xmin, ymax, xmax] = box.box_2d;
                                    const topPct = (ymin / 10).toFixed(2);
                                    const leftPct = (xmin / 10).toFixed(2);
                                    const widthPct = ((xmax - xmin) / 10).toFixed(2);
                                    const heightPct = ((ymax - ymin) / 10).toFixed(2);

                                    return (
                                        <div
                                            key={bIdx}
                                            style={{
                                                top: `${topPct}%`,
                                                left: `${leftPct}%`,
                                                width: `${widthPct}%`,
                                                height: `${heightPct}%`,
                                            }}
                                            className={`absolute border-2 sm:border-[2.5px] rounded-md sm:rounded-lg pointer-events-none transition-all duration-300 z-20 ${
                                                isDefect
                                                    ? 'border-rose-500 bg-rose-500/20 shadow-[0_0_18px_rgba(244,63,94,0.7)]'
                                                    : 'border-emerald-500 bg-emerald-500/20 shadow-[0_0_18px_rgba(16,185,129,0.7)]'
                                            }`}
                                        >
                                            {/* Corner brackets */}
                                            <span className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-white rounded-tl" />
                                            <span className="absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2 border-white rounded-tr" />
                                            <span className="absolute -bottom-1 -left-1 w-2 h-2 border-b-2 border-l-2 border-white rounded-bl" />
                                            <span className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-white rounded-br" />

                                            {/* Tag Badge */}
                                            <div className={`absolute -top-6 sm:-top-7 left-0 text-white text-[8px] sm:text-[10px] font-black uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded shadow-lg whitespace-nowrap flex items-center gap-1 border ${
                                                isDefect
                                                    ? 'bg-rose-600 border-rose-400/50'
                                                    : 'bg-emerald-600 border-emerald-400/50'
                                            }`}>
                                                {isDefect ? <AlertCircle size={9} /> : <Crosshair size={9} />}
                                                <span>{box.label || activeBoxLabel || (isDefect ? `Defect #${bIdx + 1}` : `Item #${bIdx + 1}`)}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Footer Info Bar */}
                        <div className="p-3 bg-white border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                {hasBoxes ? (
                                    <div className="flex items-center gap-1.5 text-xs text-slate-700">
                                        <span className={`w-2 h-2 rounded-full ${isDefect ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                                        <span className="font-bold">{isDefect ? 'Detected Defect:' : 'Verified / Located Feature:'}</span>
                                        <span className="text-slate-600 font-medium">
                                            {boxes.map(b => b.label).filter(Boolean).join(', ') || activeBoxLabel || (isDefect ? 'Defect flagged' : 'Feature located')}
                                        </span>
                                    </div>
                                ) : isLoadingBoxes ? (
                                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                                        <Loader2 size={12} className="animate-spin text-rose-500" />
                                        Scanning image coordinates...
                                    </div>
                                ) : (
                                    <span className="text-[11px] text-slate-400 font-medium">
                                        Inspection photo captured during floor audit
                                    </span>
                                )}
                            </div>

                            <button
                                onClick={onClose}
                                className="w-full sm:w-auto px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default ImagePreviewModal;
