'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Loader2, Eye, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ImagePreviewModal from '@/frontend/components/shared/ImagePreviewModal';

interface CADArea {
    id: string;
    label: string;
    coordinates: { x: number; y: number; width: number; height: number };
    linked_step_ids: string[];
}

interface CompletionItemScore {
    id?: string;
    checklist_item_id: string;
    title: string;
    ai_cleanliness_score: number | null;
    ai_cleanliness_reason: string | null;
    photo_url: string | null;
    reference_photo_url?: string | null;
}

interface SOPCADOverlayViewProps {
    isOpen: boolean;
    onClose: () => void;
    cadImageUrl: string;
    areas: CADArea[];
    /** Scored completion items for the current completion session */
    items: CompletionItemScore[];
    templateTitle?: string;
    /** On-demand AI scoring handler */
    onScorePhoto?: (completionItemId: string) => void;
    /** Map of completionItemId -> loading boolean */
    aiScoring?: Record<string, boolean>;
}

function scoreColors(score: number | null) {
    if (score === null || score === undefined) {
        return { fill: 'rgba(148,163,184,0.25)', stroke: '#94a3b8', badge: 'bg-slate-400', label: 'Not scored' };
    }
    if (score >= 80) {
        return { fill: 'rgba(16,185,129,0.30)', stroke: '#10b981', badge: 'bg-emerald-500', label: 'Excellent' };
    }
    if (score >= 50) {
        return { fill: 'rgba(245,158,11,0.30)', stroke: '#f59e0b', badge: 'bg-amber-500', label: 'Needs attention' };
    }
    return { fill: 'rgba(244,63,94,0.30)', stroke: '#f43f5e', badge: 'bg-rose-500', label: 'Poor' };
}

const SOPCADOverlayView: React.FC<SOPCADOverlayViewProps> = ({
    isOpen,
    onClose,
    cadImageUrl,
    areas,
    items,
    templateTitle,
    onScorePhoto,
    aiScoring = {},
}) => {
    const [mounted, setMounted] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Map checklist_item_id → score data
    const itemScoreMap = useMemo(() => {
        const map: Record<string, CompletionItemScore> = {};
        for (const it of items) map[it.checklist_item_id] = it;
        return map;
    }, [items]);

    // Per-area aggregate: worst (minimum) score among linked, scored steps
    const areaData = useMemo(() => {
        return areas.map((area) => {
            const linked = area.linked_step_ids
                .map((id) => itemScoreMap[id])
                .filter(Boolean) as CompletionItemScore[];
            const scored = linked.filter((l) => l.ai_cleanliness_score !== null && l.ai_cleanliness_score !== undefined);
            const worst = scored.length > 0
                ? Math.min(...scored.map((l) => l.ai_cleanliness_score as number))
                : null;
            return { area, linked, worst };
        });
    }, [areas, itemScoreMap]);

    const selected = areaData.find((d) => d.area.id === selectedAreaId) || null;

    const handleImageLoad = () => {
        if (imageRef.current) {
            setImageSize({
                width: imageRef.current.naturalWidth,
                height: imageRef.current.naturalHeight,
            });
        }
    };

    // Reset selection when reopened
    useEffect(() => {
        if (isOpen) setSelectedAreaId(null);
    }, [isOpen]);

    if (!isOpen || !mounted) return null;

    const overall = areaData.filter((d) => d.worst !== null);
    const overallAvg = overall.length > 0
        ? Math.round(overall.reduce((sum, d) => sum + (d.worst as number), 0) / overall.length)
        : null;

    const modalContent = (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[9999] flex items-center justify-center p-1 sm:p-3">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className={`bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ${
                        isMaximized ? 'w-[99vw] h-[98vh]' : 'w-[96vw] max-w-[1650px] h-[94vh]'
                    }`}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100 flex-shrink-0 bg-white">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                                <MapPin size={18} className="text-primary" />
                            </div>
                            <div>
                                <h2 className="font-black text-sm md:text-base text-slate-900 tracking-tight">CAD Cleanliness Report</h2>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    {templateTitle ? `${templateTitle} — ` : ''}Area cleanliness scores & photo proofs
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {overallAvg !== null && (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Overall Score</span>
                                    <span className={`text-sm font-black ${overallAvg >= 80 ? 'text-emerald-600' : overallAvg >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                                        {overallAvg}
                                    </span>
                                </div>
                            )}
                            <button
                                onClick={() => setIsMaximized(!isMaximized)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                            >
                                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                                <span>{isMaximized ? 'Restore' : 'Maximize'}</span>
                            </button>
                            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all">
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-hidden p-4 md:p-6 bg-slate-50/50">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
                            {/* CAD image with SVG overlay (7 of 12 cols on desktop) */}
                            <div className="lg:col-span-7 flex flex-col bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-xs h-full">
                                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-900/5">
                                    <div className="relative cursor-pointer max-w-full my-auto">
                                        <img
                                            ref={imageRef}
                                            src={cadImageUrl}
                                            alt="CAD floor plan"
                                            className="w-full h-auto select-none rounded-lg block"
                                            onLoad={handleImageLoad}
                                            draggable={false}
                                        />
                                        {imageSize.width > 0 && (
                                            <svg
                                                className="absolute top-0 left-0 w-full h-full pointer-events-auto"
                                                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                                                preserveAspectRatio="none"
                                            >
                                                {areaData.map(({ area, worst }) => {
                                                    const colors = scoreColors(worst);
                                                    const isSelected = selectedAreaId === area.id;
                                                    return (
                                                        <g
                                                            key={area.id}
                                                            className="cursor-pointer"
                                                            onClick={() => setSelectedAreaId(isSelected ? null : area.id)}
                                                        >
                                                            <rect
                                                                x={area.coordinates.x}
                                                                y={area.coordinates.y}
                                                                width={area.coordinates.width}
                                                                height={area.coordinates.height}
                                                                fill={colors.fill}
                                                                stroke={colors.stroke}
                                                                strokeWidth={isSelected ? 5 : 3}
                                                                rx={4}
                                                            />
                                                            {/* Score badge */}
                                                            <g transform={`translate(${area.coordinates.x + area.coordinates.width / 2}, ${area.coordinates.y + area.coordinates.height / 2})`}>
                                                                <rect
                                                                    x={-28}
                                                                    y={-16}
                                                                    width={56}
                                                                    height={32}
                                                                    rx={8}
                                                                    fill={colors.stroke}
                                                                />
                                                                <text
                                                                    textAnchor="middle"
                                                                    dominantBaseline="central"
                                                                    fill="#ffffff"
                                                                    fontSize={18}
                                                                    fontWeight={900}
                                                                >
                                                                    {worst !== null ? worst : '—'}
                                                                </text>
                                                            </g>
                                                        </g>
                                                    );
                                                })}
                                            </svg>
                                        )}
                                    </div>
                                </div>

                                {/* Legend */}
                                <div className="flex items-center gap-3 px-3 py-2 bg-white border-t border-slate-100 flex-wrap">
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">80+ Excellent</span></span>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">50-79 Attention</span></span>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">&lt;50 Poor</span></span>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Not scored</span></span>
                                </div>
                            </div>

                            {/* Area details panel (5 of 12 cols on desktop) */}
                            <div className="lg:col-span-5 flex flex-col bg-white rounded-2xl p-5 border border-slate-200 shadow-xs h-full overflow-hidden">
                                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 flex-shrink-0">
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Selected Area</p>
                                        <h3 className="font-black text-sm text-slate-900">
                                            {selected ? selected.area.label : 'Select an area from floor plan'}
                                        </h3>
                                    </div>
                                    {selected && (
                                        <div className="flex items-center gap-2">
                                            {onScorePhoto && selected.linked.some(i => i.photo_url && (i.ai_cleanliness_score === null || i.ai_cleanliness_score === undefined)) && (
                                                <button
                                                    onClick={() => {
                                                        selected.linked.forEach(i => {
                                                            if (i.photo_url && (i.id || i.checklist_item_id)) {
                                                                onScorePhoto(i.id || i.checklist_item_id);
                                                            }
                                                        });
                                                    }}
                                                    className="flex items-center gap-1 px-2.5 py-1 bg-primary text-white text-[8px] font-black uppercase tracking-wider rounded-lg shadow-xs hover:bg-primary/90 transition-all cursor-pointer"
                                                >
                                                    <Eye size={10} />
                                                    <span>Audit Area</span>
                                                </button>
                                            )}
                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                                                {selected.linked.length} {selected.linked.length === 1 ? 'Step' : 'Steps'}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {!selected && (
                                    <div className="text-center py-16 text-slate-400 my-auto bg-slate-50 rounded-xl border border-dashed border-slate-200 p-6">
                                        <MapPin size={32} className="mx-auto mb-2 text-primary/40" />
                                        <p className="text-xs font-black text-slate-700 mb-1">No Area Selected</p>
                                        <p className="text-[11px] font-medium text-slate-400">Click on any colored area/zone on the floor plan to inspect its cleanliness score and photo proofs.</p>
                                    </div>
                                )}

                                {selected && selected.linked.length === 0 && (
                                    <div className="px-4 py-8 bg-slate-50 border border-slate-200 rounded-xl text-center my-auto">
                                        <p className="text-xs text-slate-500 font-medium">No checklist steps are linked to this area yet.</p>
                                    </div>
                                )}

                                {selected && selected.linked.length > 0 && (
                                    <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                                        {selected.linked.map((item) => {
                                            const colors = scoreColors(item.ai_cleanliness_score);
                                            const targetId = item.id || item.checklist_item_id;
                                            const isScoring = Boolean(aiScoring[targetId] || aiScoring[item.checklist_item_id] || (item.id && aiScoring[item.id]));

                                            return (
                                                <div key={item.checklist_item_id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-3 shadow-xs hover:border-slate-300 transition-all">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-black text-xs md:text-sm text-slate-900 truncate">{item.title}</p>
                                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{colors.label}</p>
                                                        </div>
                                                        <div className="flex items-center gap-2 flex-shrink-0">
                                                            <div className={`px-2.5 py-1 rounded-xl ${colors.badge} flex items-center gap-1.5 shadow-xs`}>
                                                                <span className="text-[9px] font-black text-white uppercase tracking-wider">Score</span>
                                                                <span className="text-xs font-black text-white">
                                                                    {item.ai_cleanliness_score !== null && item.ai_cleanliness_score !== undefined ? item.ai_cleanliness_score : '—'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {item.ai_cleanliness_reason && (
                                                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed bg-white p-2.5 rounded-xl border border-slate-200/80">
                                                            {item.ai_cleanliness_reason}
                                                        </p>
                                                    )}

                                                    {/* Side-by-Side Large Photo Comparison Boxes */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                                        {/* Clean Standard Reference Photo */}
                                                        <div className="flex flex-col gap-1.5">
                                                            <span className="text-[9px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                                                                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                                                Clean Standard Photo
                                                            </span>
                                                            {item.reference_photo_url ? (
                                                                <div
                                                                    className="relative w-full h-36 md:h-40 rounded-xl overflow-hidden border border-emerald-200 cursor-pointer group bg-slate-900 shadow-xs"
                                                                    onClick={() => setPreviewImageUrl(item.reference_photo_url!)}
                                                                >
                                                                    <img src={item.reference_photo_url} alt="Clean Ref" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                                                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                        <Eye size={18} className="text-white" />
                                                                    </div>
                                                                    <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 bg-emerald-950/80 rounded text-[8px] text-emerald-300 font-bold uppercase tracking-wider">
                                                                        Standard Clean
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="w-full h-36 md:h-40 rounded-xl border border-dashed border-slate-200 bg-white flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                                                                    <Eye size={18} className="mb-1 opacity-30" />
                                                                    <span className="text-[10px] font-bold">No Clean Ref Photo</span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Uploaded Execution Photo */}
                                                        <div className="flex flex-col gap-1.5">
                                                            <span className="text-[9px] font-black text-blue-700 uppercase tracking-wider flex items-center gap-1">
                                                                <span className="w-2 h-2 rounded-full bg-blue-500" />
                                                                Uploaded Execution Photo
                                                            </span>
                                                            {item.photo_url ? (
                                                                <div
                                                                    className="relative w-full h-36 md:h-40 rounded-xl overflow-hidden border border-blue-200 cursor-pointer group bg-slate-900 shadow-xs"
                                                                    onClick={() => setPreviewImageUrl(item.photo_url!)}
                                                                >
                                                                    <img src={item.photo_url} alt="Uploaded Proof" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                                                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                        <Eye size={18} className="text-white" />
                                                                    </div>
                                                                    <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 bg-blue-950/80 rounded text-[8px] text-blue-300 font-bold uppercase tracking-wider">
                                                                        Uploaded Proof
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="w-full h-36 md:h-40 rounded-xl border border-dashed border-slate-200 bg-white flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                                                                    <Eye size={18} className="mb-1 opacity-30" />
                                                                    <span className="text-[10px] font-bold">No Photo Uploaded</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* On-Demand AI Audit Button for this step */}
                                                    {item.photo_url && (
                                                        <div className="pt-2 flex items-center justify-between border-t border-slate-200/60">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                                                {item.ai_cleanliness_score !== null && item.ai_cleanliness_score !== undefined
                                                                    ? `Evaluated: ${item.ai_cleanliness_score}/100`
                                                                    : 'Ready for AI Cleanliness Audit'}
                                                            </span>
                                                            {onScorePhoto && (
                                                                <button
                                                                    disabled={isScoring}
                                                                    onClick={() => onScorePhoto(targetId)}
                                                                    className="flex items-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-xs cursor-pointer"
                                                                >
                                                                    {isScoring ? (
                                                                        <>
                                                                            <Loader2 size={12} className="animate-spin text-white" />
                                                                            <span>Auditing...</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Eye size={12} />
                                                                            <span>{item.ai_cleanliness_score !== null && item.ai_cleanliness_score !== undefined ? 'Re-Audit AI Score' : 'Audit Cleanliness (AI)'}</span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {previewImageUrl && (
                    <ImagePreviewModal
                        isOpen={!!previewImageUrl}
                        imageUrl={previewImageUrl}
                        onClose={() => setPreviewImageUrl(null)}
                    />
                )}
            </div>
        </AnimatePresence>
    );

    return createPortal(modalContent, document.body);
};

export default SOPCADOverlayView;
