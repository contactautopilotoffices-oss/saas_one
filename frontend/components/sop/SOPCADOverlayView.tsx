'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    X,
    MapPin,
    Loader2,
    Eye,
    Maximize2,
    Minimize2,
    Sparkles,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Camera,
    Image as ImageIcon,
    Layers,
    ChevronLeft,
    ChevronRight,
    ShieldAlert,
    ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ImagePreviewModal from '@/frontend/components/shared/ImagePreviewModal';

interface CADArea {
    id: string;
    label: string;
    shape_type?: 'rectangle' | 'polygon' | 'freehand';
    coordinates: { x: number; y: number; width: number; height: number };
    points?: { x: number; y: number }[];
    linked_step_ids: string[];
}

export interface CompletionItemPhoto {
    id?: string;
    url: string;
    label?: string;
    captured_at?: string;
}

export interface ParameterScore {
    name: string;
    score?: number | null;
    status: 'pass' | 'fail' | 'warning' | 'unassessable';
    reason?: string;
    is_assessable?: boolean;
}

export interface PhotoMatch {
    benchmark_id?: string;
    benchmark_label?: string;
    matched_photo_url?: string;
    status: 'matched' | 'missing' | 'mismatch';
    confidence?: number;
    reason?: string;
}

export interface CompletionItemScore {
    id?: string;
    checklist_item_id: string;
    title: string;
    ai_cleanliness_score: number | null;
    ai_cleanliness_reason: string | null;
    photo_url: string | null;
    photos?: Array<CompletionItemPhoto | string>;
    reference_photo_url?: string | null;
    reference_photos?: Array<{ id?: string; label?: string; url: string }>;
    ai_parameter_scores?: ParameterScore[] | string;
    ai_photo_matches?: PhotoMatch[] | string;
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
    /** Only admins may view the clean reference photo (benchmark). Staff must not see it. */
    isAdmin?: boolean;
}

function scoreColors(score: number | null) {
    if (score === null || score === undefined) {
        return {
            fill: 'rgba(148,163,184,0.25)',
            stroke: '#94a3b8',
            badge: 'bg-slate-400',
            label: 'Not scored',
            textColor: 'text-slate-600',
            bgColor: 'bg-slate-50',
            borderColor: 'border-slate-200'
        };
    }
    if (score >= 80) {
        return {
            fill: 'rgba(16,185,129,0.30)',
            stroke: '#10b981',
            badge: 'bg-emerald-500',
            label: 'Excellent',
            textColor: 'text-emerald-700',
            bgColor: 'bg-emerald-50',
            borderColor: 'border-emerald-200'
        };
    }
    if (score >= 50) {
        return {
            fill: 'rgba(245,158,11,0.30)',
            stroke: '#f59e0b',
            badge: 'bg-amber-500',
            label: 'Needs attention',
            textColor: 'text-amber-700',
            bgColor: 'bg-amber-50',
            borderColor: 'border-amber-200'
        };
    }
    return {
        fill: 'rgba(244,63,94,0.30)',
        stroke: '#f43f5e',
        badge: 'bg-rose-500',
        label: 'Poor',
        textColor: 'text-rose-700',
        bgColor: 'bg-rose-50',
        borderColor: 'border-rose-200'
    };
}

// Helper to clean up raw filename labels like "WHATSAPP IMAGE 2026 10 22 AT 8.26.24 PM"
function cleanPhotoLabel(label?: string, fallback: string = 'Photo'): string {
    if (!label) return fallback;
    const trimmed = label.trim();
    if (
        /^whatsapp[\s_-]?image/i.test(trimmed) ||
        /^img[\s_-]?\d+/i.test(trimmed) ||
        /^p_\d+/i.test(trimmed) ||
        /\.(jpe?g|png|webp|heic|avif)$/i.test(trimmed) ||
        trimmed.length > 22
    ) {
        return fallback;
    }
    return trimmed;
}

// Helper to normalize execution photos array
function getExecutionPhotos(item: CompletionItemScore): CompletionItemPhoto[] {
    if (Array.isArray(item.photos) && item.photos.length > 0) {
        return item.photos
            .map((p, idx) => {
                if (typeof p === 'string') {
                    return { id: `p_${idx}`, url: p, label: `Proof #${idx + 1}` };
                }
                return {
                    id: p.id || `p_${idx}`,
                    url: p.url,
                    label: cleanPhotoLabel(p.label, `Proof #${idx + 1}`),
                    captured_at: p.captured_at,
                };
            })
            .filter((p) => Boolean(p.url));
    }
    if (item.photo_url) {
        return [{ id: 'p_1', url: item.photo_url, label: 'Proof #1' }];
    }
    return [];
}

// Helper to normalize benchmark reference photos array
function getBenchmarkPhotos(item: CompletionItemScore): Array<{ id: string; label: string; url: string }> {
    if (Array.isArray(item.reference_photos) && item.reference_photos.length > 0) {
        return item.reference_photos
            .map((r, idx) => ({
                id: r.id || `ref_${idx}`,
                label: cleanPhotoLabel(r.label, `Standard #${idx + 1}`),
                url: r.url,
            }))
            .filter((r) => Boolean(r.url));
    }
    if (item.reference_photo_url) {
        return [{ id: 'ref_1', label: 'Clean Standard Photo', url: item.reference_photo_url }];
    }
    return [];
}

// Helper to parse sub-parameter inspection scores
function parseParameterScores(scores: any): ParameterScore[] {
    if (Array.isArray(scores)) return scores;
    if (typeof scores === 'string') {
        try {
            const parsed = JSON.parse(scores);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

// Helper to parse AI photo matches
function parsePhotoMatches(matches: any): PhotoMatch[] {
    if (Array.isArray(matches)) return matches;
    if (typeof matches === 'string') {
        try {
            const parsed = JSON.parse(matches);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

const SOPCADOverlayView: React.FC<SOPCADOverlayViewProps> = ({
    isOpen,
    onClose,
    cadImageUrl,
    areas,
    items,
    templateTitle,
    onScorePhoto,
    isAdmin = false,
    aiScoring = {},
}) => {
    const [mounted, setMounted] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [previewImageTitle, setPreviewImageTitle] = useState<string | null>(null);

    // Active photo index selection per step
    const [activeExecIndex, setActiveExecIndex] = useState<Record<string, number>>({});
    const [activeBenchIndex, setActiveBenchIndex] = useState<Record<string, number>>({});

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
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-1 sm:p-3">
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 16 }}
                    className={`bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 border border-slate-200/80 ${
                        isMaximized ? 'w-[99vw] h-[98vh]' : 'w-[96vw] max-w-[1680px] h-[94vh]'
                    }`}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-slate-100 flex-shrink-0 bg-white">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                <MapPin size={18} />
                            </div>
                            <div>
                                <h2 className="font-black text-sm md:text-base text-slate-900 tracking-tight flex items-center gap-2">
                                    <span>CAD Cleanliness Report</span>
                                    {isAdmin && (
                                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                            Admin Audit View
                                        </span>
                                    )}
                                </h2>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    {templateTitle ? `${templateTitle} — ` : ''}Area cleanliness scores, multi-photo proofs & AI reviews
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                            {overallAvg !== null && (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Overall Score</span>
                                    <span className={`text-sm font-black ${
                                        overallAvg >= 80 ? 'text-emerald-600' : overallAvg >= 50 ? 'text-amber-600' : 'text-rose-600'
                                    }`}>
                                        {overallAvg}
                                    </span>
                                </div>
                            )}
                            <button
                                onClick={() => setIsMaximized(!isMaximized)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                                title={isMaximized ? 'Restore' : 'Maximize'}
                            >
                                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                                <span className="hidden sm:inline">{isMaximized ? 'Restore' : 'Maximize'}</span>
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-hidden p-3 sm:p-5 bg-slate-50/60">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
                            {/* CAD image with SVG overlay (7 cols on desktop) */}
                            <div className="lg:col-span-7 flex flex-col bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-xs h-full">
                                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950/5">
                                    <div className="relative cursor-pointer max-w-full my-auto">
                                        <img
                                            ref={imageRef}
                                            src={cadImageUrl}
                                            alt="CAD floor plan"
                                            className="w-full h-auto select-none rounded-lg block shadow-sm"
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
                                                    const hasPolygon = Array.isArray(area.points) && area.points.length > 2;

                                                    let badgeX = area.coordinates.x + area.coordinates.width / 2;
                                                    let badgeY = area.coordinates.y + area.coordinates.height / 2;
                                                    if (hasPolygon && area.points) {
                                                        const sumX = area.points.reduce((acc, p) => acc + p.x, 0);
                                                        const sumY = area.points.reduce((acc, p) => acc + p.y, 0);
                                                        badgeX = Math.round(sumX / area.points.length);
                                                        badgeY = Math.round(sumY / area.points.length);
                                                    }

                                                    return (
                                                        <g
                                                            key={area.id}
                                                            className="cursor-pointer"
                                                            onClick={() => setSelectedAreaId(isSelected ? null : area.id)}
                                                        >
                                                            {hasPolygon && area.points ? (
                                                                <polygon
                                                                    points={area.points.map((p) => `${p.x},${p.y}`).join(' ')}
                                                                    fill={colors.fill}
                                                                    stroke={colors.stroke}
                                                                    strokeWidth={isSelected ? 5 : 3}
                                                                    strokeLinejoin="round"
                                                                />
                                                            ) : (
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
                                                            )}
                                                            {/* Score badge */}
                                                            <g transform={`translate(${badgeX}, ${badgeY})`}>
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
                                <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-t border-slate-100 flex-wrap">
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">80+ Excellent</span></span>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">50-79 Attention</span></span>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">&lt;50 Poor</span></span>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Not scored</span></span>
                                </div>
                            </div>

                            {/* Area details panel (5 cols on desktop) */}
                            <div className="lg:col-span-5 flex flex-col bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs h-full overflow-hidden">
                                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 flex-shrink-0">
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Selected Area</p>
                                        <h3 className="font-black text-sm text-slate-900">
                                            {selected ? selected.area.label : 'Select an area from floor plan'}
                                        </h3>
                                    </div>
                                    {selected && (
                                        <div className="flex items-center gap-2">
                                            {onScorePhoto && selected.linked.some(i => (i.photo_url || (Array.isArray(i.photos) && i.photos.length > 0)) && (i.ai_cleanliness_score === null || i.ai_cleanliness_score === undefined)) && (
                                                <button
                                                    onClick={() => {
                                                        selected.linked.forEach(i => {
                                                            if (i.id || i.checklist_item_id) {
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
                                        <p className="text-[11px] font-medium text-slate-400">Click on any colored area or room on the CAD floor plan to inspect its cleanliness score, multi-photo benchmarks & AI review breakdown.</p>
                                    </div>
                                )}

                                {selected && selected.linked.length === 0 && (
                                    <div className="px-4 py-8 bg-slate-50 border border-slate-200 rounded-xl text-center my-auto">
                                        <p className="text-xs text-slate-500 font-medium">No checklist steps are linked to this area yet.</p>
                                    </div>
                                )}

                                {selected && selected.linked.length > 0 && (
                                    <div className="space-y-4 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                                        {selected.linked.map((item) => {
                                            const colors = scoreColors(item.ai_cleanliness_score);
                                            const targetId = item.id || item.checklist_item_id;
                                            const isScoring = Boolean(aiScoring[targetId] || aiScoring[item.checklist_item_id] || (item.id && aiScoring[item.id]));

                                            // Multi-photo lists
                                            const execPhotos = getExecutionPhotos(item);
                                            const benchPhotos = isAdmin ? getBenchmarkPhotos(item) : [];

                                            const curExecIdx = Math.min(activeExecIndex[item.checklist_item_id] || 0, Math.max(0, execPhotos.length - 1));
                                            const curBenchIdx = Math.min(activeBenchIndex[item.checklist_item_id] || 0, Math.max(0, benchPhotos.length - 1));

                                            const activeExecPhoto = execPhotos[curExecIdx] || null;
                                            const activeBenchPhoto = benchPhotos[curBenchIdx] || null;

                                            // AI parameter breakdown and photo matches
                                            const paramScores = parseParameterScores(item.ai_parameter_scores);
                                            const photoMatches = parsePhotoMatches(item.ai_photo_matches);

                                            // Detect critical compliance / root cause issues
                                            const reasonText = item.ai_cleanliness_reason || '';
                                            const isGalleryUpload = /gallery upload/i.test(reasonText) || /live camera capture required/i.test(reasonText);
                                            const isStaleWatermark = /stale/i.test(reasonText) || /watermark/i.test(reasonText);
                                            const hasFailedParams = paramScores.some(p => p.status === 'fail');
                                            const missingMatches = photoMatches.filter(m => m.status === 'missing');

                                            return (
                                                <div
                                                    key={item.checklist_item_id}
                                                    className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-3.5 shadow-xs hover:border-slate-300 transition-all"
                                                >
                                                    {/* Header: Title and Score Badge */}
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-black text-xs md:text-sm text-slate-900 leading-snug">{item.title}</p>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{colors.label}</span>
                                                                {execPhotos.length > 0 && (
                                                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200/60">
                                                                        {execPhotos.length} {execPhotos.length === 1 ? 'Proof' : 'Proofs'}
                                                                    </span>
                                                                )}
                                                                {isAdmin && benchPhotos.length > 0 && (
                                                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                                                        {benchPhotos.length} {benchPhotos.length === 1 ? 'Standard' : 'Standards'}
                                                                    </span>
                                                                )}
                                                            </div>
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

                                                    {/* ── AI Root Cause & Issue Callout ── */}
                                                    {item.ai_cleanliness_score !== null && (
                                                        <>
                                                            {/* Critical Compliance Issue: Gallery Upload / Stale Photo */}
                                                            {isGalleryUpload && (
                                                                <div className="bg-rose-50 border border-rose-200/90 rounded-xl p-3 flex items-start gap-2.5">
                                                                    <ShieldAlert size={16} className="text-rose-600 flex-shrink-0 mt-0.5" />
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-[9px] font-black text-rose-700 uppercase tracking-wider">
                                                                                Compliance Violation · Anti-Fraud Penalty
                                                                            </span>
                                                                            <span className="text-[10px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.2 rounded">
                                                                                Cap: 20/100
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-xs font-black text-rose-950 mt-0.5">
                                                                            Live Camera Capture Required
                                                                        </p>
                                                                        <p className="text-[11px] text-rose-700 mt-0.5 font-medium leading-relaxed">
                                                                            The photo proof was uploaded from the device gallery rather than taken live on-site with camera watermark. Score penalized to 20/100.
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Stale Photo / Watermark Alert (if not gallery upload) */}
                                                            {!isGalleryUpload && isStaleWatermark && (
                                                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
                                                                    <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                                                    <div className="min-w-0 flex-1">
                                                                        <span className="text-[9px] font-black text-amber-700 uppercase tracking-wider block">
                                                                            Timestamp Alert
                                                                        </span>
                                                                        <p className="text-xs font-black text-amber-950 mt-0.5">
                                                                            Photo Taken Outside Scheduled Window
                                                                        </p>
                                                                        <p className="text-[11px] text-amber-700 mt-0.5 font-medium">
                                                                            {reasonText}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Missing Benchmark Standard Areas */}
                                                            {missingMatches.length > 0 && (
                                                                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-2.5 flex items-start gap-2">
                                                                    <AlertCircle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                                                    <div className="text-[11px] text-amber-800">
                                                                        <span className="font-bold">Missing Clean Standard Areas ({missingMatches.length}): </span>
                                                                        <span>{missingMatches.map(m => m.benchmark_label || 'Area').join(', ')} were not photographed in the submitted proofs.</span>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* AI Reason / Evaluation Summary Card */}
                                                            {reasonText && (
                                                                <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-2xs">
                                                                    <div className="flex items-center gap-1.5 mb-1.5 text-primary">
                                                                        <Sparkles size={13} className="text-primary" />
                                                                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-800">
                                                                            AI Inspection Review
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                                                                        {reasonText}
                                                                    </p>
                                                                </div>
                                                            )}

                                                            {/* Sub-Parameters Inspection Breakdown (from vision audit) */}
                                                            {paramScores.length > 0 && (
                                                                <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-2xs">
                                                                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
                                                                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                                                            <Layers size={11} className="text-slate-400" />
                                                                            Sub-Check Inspection ({paramScores.length})
                                                                        </span>
                                                                        <span className="text-[9px] font-semibold text-slate-400">
                                                                            Vision Verified
                                                                        </span>
                                                                    </div>
                                                                    <div className="space-y-1.5">
                                                                        {paramScores.map((param, pIdx) => {
                                                                            const isPass = param.status === 'pass';
                                                                            const isFail = param.status === 'fail';
                                                                            const isWarning = param.status === 'warning';
                                                                            return (
                                                                                <div
                                                                                    key={pIdx}
                                                                                    className={`p-2 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] ${
                                                                                        isFail
                                                                                            ? 'bg-rose-50/70 border-rose-200/80'
                                                                                            : isPass
                                                                                            ? 'bg-emerald-50/50 border-emerald-100'
                                                                                            : 'bg-slate-50 border-slate-100'
                                                                                    }`}
                                                                                >
                                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                                        {isPass && <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />}
                                                                                        {isFail && <XCircle size={13} className="text-rose-600 flex-shrink-0" />}
                                                                                        {isWarning && <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />}
                                                                                        <span className={`font-bold truncate ${isFail ? 'text-rose-950' : 'text-slate-800'}`}>
                                                                                            {param.name}
                                                                                        </span>
                                                                                        <span
                                                                                            className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded ${
                                                                                                isPass
                                                                                                    ? 'bg-emerald-100 text-emerald-800'
                                                                                                    : isFail
                                                                                                    ? 'bg-rose-200 text-rose-900 font-extrabold'
                                                                                                    : 'bg-slate-200 text-slate-700'
                                                                                            }`}
                                                                                        >
                                                                                            {isPass ? 'Pass' : isFail ? 'Failed' : 'Warning'}
                                                                                        </span>
                                                                                        {param.score !== null && param.score !== undefined && (
                                                                                            <span className="text-[10px] font-black text-slate-600">
                                                                                                {param.score}/100
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                    {param.reason && (
                                                                                        <span className={`text-[10px] sm:max-w-[55%] sm:text-right font-medium leading-tight ${
                                                                                            isFail ? 'text-rose-700 font-semibold' : 'text-slate-500'
                                                                                        }`}>
                                                                                            {param.reason}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* ── Multi-Photo Comparison Boxes (Clean Standard vs Uploaded Proofs) ── */}
                                                    <div className={`grid grid-cols-1 gap-3 pt-1 ${isAdmin ? 'sm:grid-cols-2' : ''}`}>
                                                        {/* Clean Standard Reference Photos — visible to admins only */}
                                                        {isAdmin && (
                                                            <div className="flex flex-col gap-2">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-[9px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                                                                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                                                        Clean Standard
                                                                        {benchPhotos.length > 1 && (
                                                                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800">
                                                                                {curBenchIdx + 1} of {benchPhotos.length}
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    {benchPhotos.length > 1 && (
                                                                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">
                                                                            {benchPhotos.length} Standards Configured
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {activeBenchPhoto ? (
                                                                    <div className="space-y-2">
                                                                        {/* Main Benchmark Image Card with Carousel Controls */}
                                                                        <div
                                                                            className="relative w-full h-44 md:h-48 rounded-xl overflow-hidden border border-emerald-200 cursor-pointer group bg-slate-900 shadow-xs select-none"
                                                                            onClick={() => {
                                                                                setPreviewImageUrl(activeBenchPhoto.url);
                                                                                setPreviewImageTitle(`${item.title} — ${activeBenchPhoto.label}`);
                                                                            }}
                                                                        >
                                                                            <img
                                                                                src={activeBenchPhoto.url}
                                                                                alt="Clean Ref"
                                                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                                            />
                                                                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                                                                <Eye size={22} className="text-white drop-shadow" />
                                                                            </div>

                                                                            {/* Previous Photo Button */}
                                                                            {benchPhotos.length > 1 && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setActiveBenchIndex(prev => ({
                                                                                            ...prev,
                                                                                            [item.checklist_item_id]: (curBenchIdx - 1 + benchPhotos.length) % benchPhotos.length
                                                                                        }));
                                                                                    }}
                                                                                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition-all shadow-md backdrop-blur-xs hover:scale-110 active:scale-95 cursor-pointer"
                                                                                    title="Previous Standard Photo"
                                                                                >
                                                                                    <ChevronLeft size={16} />
                                                                                </button>
                                                                            )}

                                                                            {/* Next Photo Button */}
                                                                            {benchPhotos.length > 1 && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setActiveBenchIndex(prev => ({
                                                                                            ...prev,
                                                                                            [item.checklist_item_id]: (curBenchIdx + 1) % benchPhotos.length
                                                                                        }));
                                                                                    }}
                                                                                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition-all shadow-md backdrop-blur-xs hover:scale-110 active:scale-95 cursor-pointer"
                                                                                    title="Next Standard Photo"
                                                                                >
                                                                                    <ChevronRight size={16} />
                                                                                </button>
                                                                            )}

                                                                            {/* Photo Counter Pill (Top-Right) */}
                                                                            {benchPhotos.length > 1 && (
                                                                                <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/65 backdrop-blur-xs rounded-full text-[9px] text-white font-bold tracking-wider flex items-center gap-1 shadow-xs pointer-events-none">
                                                                                    <Camera size={10} />
                                                                                    <span>{curBenchIdx + 1} / {benchPhotos.length}</span>
                                                                                </div>
                                                                            )}

                                                                            {/* Label Pill (Bottom-Left) */}
                                                                            <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-emerald-950/85 backdrop-blur-xs rounded-md text-[8px] text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-1 pointer-events-none max-w-[80%] truncate shadow-xs">
                                                                                <span className="truncate">{activeBenchPhoto.label || 'Standard Clean'}</span>
                                                                            </div>
                                                                        </div>

                                                                        {/* Benchmark Thumbnails Strip */}
                                                                        {benchPhotos.length > 1 && (
                                                                            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
                                                                                {benchPhotos.map((bm, bIdx) => (
                                                                                    <button
                                                                                        key={bm.id || bIdx}
                                                                                        type="button"
                                                                                        onClick={() => setActiveBenchIndex(prev => ({ ...prev, [item.checklist_item_id]: bIdx }))}
                                                                                        className={`relative w-12 h-12 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 group cursor-pointer ${
                                                                                            curBenchIdx === bIdx
                                                                                                ? 'border-emerald-500 ring-2 ring-emerald-400/50 shadow-xs scale-105'
                                                                                                : 'border-slate-200 opacity-60 hover:opacity-100 hover:border-slate-300'
                                                                                        }`}
                                                                                        title={bm.label || `Standard #${bIdx + 1}`}
                                                                                    >
                                                                                        <img src={bm.url} alt={`Standard ${bIdx + 1}`} className="w-full h-full object-cover" />
                                                                                        <span className={`absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded ${
                                                                                            curBenchIdx === bIdx ? 'bg-emerald-600 text-white' : 'bg-black/70 text-white'
                                                                                        }`}>
                                                                                            #{bIdx + 1}
                                                                                        </span>
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="w-full h-44 md:h-48 rounded-xl border border-dashed border-slate-200 bg-white flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                                                                        <Eye size={20} className="mb-1 opacity-30" />
                                                                        <span className="text-[10px] font-bold">No Clean Ref Photo Configured</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Uploaded Execution Proofs (Supports Multi-Photos) */}
                                                        <div className="flex flex-col gap-2">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[9px] font-black text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
                                                                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                                                                    Uploaded Execution Proof
                                                                    {execPhotos.length > 1 && (
                                                                        <span className="text-[8px] font-black px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800">
                                                                            {curExecIdx + 1} of {execPhotos.length}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                {execPhotos.length > 1 && (
                                                                    <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">
                                                                        {execPhotos.length} Proofs Captured
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {activeExecPhoto ? (
                                                                <div className="space-y-2">
                                                                    {/* Main Execution Image Card with Carousel Controls */}
                                                                    <div
                                                                        className="relative w-full h-44 md:h-48 rounded-xl overflow-hidden border border-blue-200 cursor-pointer group bg-slate-900 shadow-xs select-none"
                                                                        onClick={() => {
                                                                            setPreviewImageUrl(activeExecPhoto.url);
                                                                            setPreviewImageTitle(`${item.title} — ${activeExecPhoto.label || 'Uploaded Proof'}`);
                                                                        }}
                                                                    >
                                                                        <img
                                                                            src={activeExecPhoto.url}
                                                                            alt="Uploaded Proof"
                                                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                                        />
                                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                                                            <Eye size={22} className="text-white drop-shadow" />
                                                                        </div>

                                                                        {/* Previous Photo Button */}
                                                                        {execPhotos.length > 1 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setActiveExecIndex(prev => ({
                                                                                        ...prev,
                                                                                        [item.checklist_item_id]: (curExecIdx - 1 + execPhotos.length) % execPhotos.length
                                                                                    }));
                                                                                }}
                                                                                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition-all shadow-md backdrop-blur-xs hover:scale-110 active:scale-95 cursor-pointer"
                                                                                title="Previous Proof Photo"
                                                                            >
                                                                                <ChevronLeft size={16} />
                                                                            </button>
                                                                        )}

                                                                        {/* Next Photo Button */}
                                                                        {execPhotos.length > 1 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setActiveExecIndex(prev => ({
                                                                                        ...prev,
                                                                                        [item.checklist_item_id]: (curExecIdx + 1) % execPhotos.length
                                                                                    }));
                                                                                }}
                                                                                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition-all shadow-md backdrop-blur-xs hover:scale-110 active:scale-95 cursor-pointer"
                                                                                title="Next Proof Photo"
                                                                            >
                                                                                <ChevronRight size={16} />
                                                                            </button>
                                                                        )}

                                                                        {/* Photo Counter Pill (Top-Right) */}
                                                                        {execPhotos.length > 1 && (
                                                                            <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/65 backdrop-blur-xs rounded-full text-[9px] text-white font-bold tracking-wider flex items-center gap-1 shadow-xs pointer-events-none">
                                                                                <Camera size={10} />
                                                                                <span>{curExecIdx + 1} / {execPhotos.length}</span>
                                                                            </div>
                                                                        )}

                                                                        {/* Label Pill (Bottom-Left) */}
                                                                        <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-blue-950/85 backdrop-blur-xs rounded-md text-[8px] text-blue-300 font-bold uppercase tracking-wider pointer-events-none max-w-[70%] truncate shadow-xs">
                                                                            <span className="truncate">{activeExecPhoto.label || 'Uploaded Proof'}</span>
                                                                        </div>

                                                                        {/* Timestamp Pill (Top-Left) */}
                                                                        {activeExecPhoto.captured_at && (
                                                                            <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/65 backdrop-blur-xs rounded text-[8px] text-slate-200 font-mono shadow-xs pointer-events-none">
                                                                                {new Date(activeExecPhoto.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Proof Thumbnails Strip */}
                                                                    {execPhotos.length > 1 && (
                                                                        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
                                                                            {execPhotos.map((ep, eIdx) => (
                                                                                <button
                                                                                    key={ep.id || eIdx}
                                                                                    type="button"
                                                                                    onClick={() => setActiveExecIndex(prev => ({ ...prev, [item.checklist_item_id]: eIdx }))}
                                                                                    className={`relative w-12 h-12 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 group cursor-pointer ${
                                                                                        curExecIdx === eIdx
                                                                                            ? 'border-blue-500 ring-2 ring-blue-400/50 shadow-xs scale-105'
                                                                                            : 'border-slate-200 opacity-60 hover:opacity-100 hover:border-slate-300'
                                                                                    }`}
                                                                                    title={ep.label || `Proof #${eIdx + 1}`}
                                                                                >
                                                                                    <img src={ep.url} alt={`Proof ${eIdx + 1}`} className="w-full h-full object-cover" />
                                                                                    <span className={`absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded ${
                                                                                        curExecIdx === eIdx ? 'bg-blue-600 text-white' : 'bg-black/70 text-white'
                                                                                    }`}>
                                                                                        #{eIdx + 1}
                                                                                    </span>
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <div className="w-full h-44 md:h-48 rounded-xl border border-dashed border-slate-200 bg-white flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                                                                    <Eye size={20} className="mb-1 opacity-30" />
                                                                    <span className="text-[10px] font-bold">No Photo Uploaded</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* On-Demand AI Audit Button */}
                                                    {execPhotos.length > 0 && (
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
                                                                            <Sparkles size={12} />
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
                        isOpen={Boolean(previewImageUrl)}
                        imageUrl={previewImageUrl}
                        title={previewImageTitle || 'Photo Inspection'}
                        onClose={() => {
                            setPreviewImageUrl(null);
                            setPreviewImageTitle(null);
                        }}
                    />
                )}
            </div>
        </AnimatePresence>
    );

    return createPortal(modalContent, document.body);
};

export default SOPCADOverlayView;
