'use client';

import React, { useState, useEffect } from 'react';
import { 
    MapPin, 
    Sparkles, 
    Lightbulb, 
    CheckCircle2, 
    Eye, 
    Clock, 
    MoreHorizontal,
    X,
    ChevronRight,
    Camera,
    ShieldCheck,
    AlertCircle,
    Check,
    Layers,
    Crosshair
} from 'lucide-react';
import { AreaAuditScore } from './useCADReportData';
import ImagePreviewModal, { DefectBox } from '@/frontend/components/shared/ImagePreviewModal';
import { maskStorageUrl } from '@/frontend/utils/storageUrl';

interface CADAreaInspectorProps {
    area: AreaAuditScore | null;
    floorName: string;
    propertyId?: string;
    /** The property's pass mark, the same one the scorer used at submit time. */
    passThreshold?: number;
    onClose?: () => void;
}

export const CADAreaInspector: React.FC<CADAreaInspectorProps> = ({
    area,
    floorName,
    propertyId,
    passThreshold = 70,
    onClose,
}) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'photos' | 'ai_analysis' | 'history' | 'checklist'>('overview');
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [previewImageTitle, setPreviewImageTitle] = useState('');
    const [defectBoxes, setDefectBoxes] = useState<DefectBox[]>([]);
    const [isLoadingBoxes, setIsLoadingBoxes] = useState(false);
    const [activeBoxLabel, setActiveBoxLabel] = useState<string | undefined>(undefined);
    const [defectCache, setDefectCache] = useState<Record<string, DefectBox[]>>({});
    const [activeRefIndex, setActiveRefIndex] = useState(0);
    const [activeProofIndex, setActiveProofIndex] = useState(0);
    /** The set the open photo belongs to, so ← / → step through it instead of closing and re-opening. */
    const [gallery, setGallery] = useState<Array<{ url: string; title: string }>>([]);
    const [galleryIndex, setGalleryIndex] = useState(0);

    // No area selected: an empty shell, not a stock-photo "Meeting Room 1" scoring 92. A demo area
    // here was indistinguishable from a real audited one.
    const displayArea = area || ({
        areaId: 'none',
        label: 'No area selected',
        category: '—',
        score: null,
        status: 'uninspected',
        parameters: [],
        linkedItemIds: [],
        linkedTitles: [],
        allProofs: [],
        allBenchmarks: [],
        notEvaluated: true,
    } as unknown as AreaAuditScore);

    // Reset angle indexes on area change
    useEffect(() => {
        setActiveRefIndex(0);
        setActiveProofIndex(0);
    }, [displayArea.areaId]);

    // An area the AI has not scored has no score. It used to render as 92 / Excellent.
    const hasScore = typeof displayArea.score === 'number';
    const score = hasScore ? (displayArea.score as number) : null;
    const needsReview = Boolean(displayArea.needsReview);

    const scoreBorder = !hasScore ? 'border-slate-300 text-slate-400 bg-slate-50' :
                        (score as number) >= 85 ? 'border-emerald-500 text-emerald-600 bg-emerald-50/50' :
                        (score as number) >= passThreshold ? 'border-yellow-500 text-yellow-600 bg-yellow-50/50' :
                        (score as number) >= 50 ? 'border-amber-500 text-amber-600 bg-amber-50/50' :
                        'border-rose-500 text-rose-600 bg-rose-50/50';

    // The headline badge reports the scorer's verdict, not just a score band: a step the AI sent to a
    // checker is never shown as a clean pass, however high the number is.
    const statusBadge = !hasScore ? { bg: 'bg-slate-100 text-slate-600', label: 'Not Evaluated' } :
                        needsReview ? { bg: 'bg-violet-100 text-violet-800', label: 'Needs Review' } :
                        (score as number) >= 85 ? { bg: 'bg-emerald-100 text-emerald-800', label: 'Excellent' } :
                        (score as number) >= passThreshold ? { bg: 'bg-yellow-100 text-yellow-800', label: 'Good' } :
                        (score as number) >= 50 ? { bg: 'bg-amber-100 text-amber-800', label: 'Needs Attention' } :
                        { bg: 'bg-rose-100 text-rose-800', label: 'Poor' };

    const benchmarks = displayArea.allBenchmarks || [];
    const proofs = displayArea.allProofs || [];

    const currentBenchmark = benchmarks[activeRefIndex] || benchmarks[0];
    const refPhoto = maskStorageUrl(currentBenchmark?.url || displayArea.benchmarkPhoto);

    const currentProof = proofs[activeProofIndex] || proofs[0];
    const proofPhoto = maskStorageUrl(currentProof?.url || displayArea.previewPhoto);

    const totalPhotos = benchmarks.length + proofs.length;

    /** Open one photo as part of a set. Defect marks belong to a single photo, so they are cleared. */
    const openGallery = (items: Array<{ url: string; title: string }>, index: number) => {
        const safeItems = items.filter(i => Boolean(i.url));
        if (safeItems.length === 0) return;
        const i = Math.max(0, Math.min(index, safeItems.length - 1));
        setGallery(safeItems);
        setGalleryIndex(i);
        setPreviewImageUrl(safeItems[i].url);
        setPreviewImageTitle(safeItems[i].title);
        setDefectBoxes([]);
        setActiveBoxLabel(undefined);
        setIsLoadingBoxes(false);
    };

    const stepGallery = (delta: number) => {
        if (gallery.length < 2) return;
        const next = (galleryIndex + delta + gallery.length) % gallery.length;
        setGalleryIndex(next);
        setPreviewImageUrl(gallery[next].url);
        setPreviewImageTitle(gallery[next].title);
        setDefectBoxes([]);
        setActiveBoxLabel(undefined);
        setIsLoadingBoxes(false);
    };

    /** Every photo attached to this area: references first, then what the staff submitted. */
    const allAreaPhotos = [
        ...benchmarks.map((b, i) => ({ url: maskStorageUrl(b.url) || b.url, title: `${displayArea.label} — ${b.label || `Reference angle ${i + 1}`}` })),
        ...proofs.map((p, i) => ({ url: maskStorageUrl(p.url) || p.url, title: `${displayArea.label} — ${p.label || `Submitted photo ${i + 1}`}` })),
    ].filter(p => Boolean(p.url));

    const handleLocateDefect = async (param: any) => {
        const rawPhoto = param.photo_url || currentProof?.url || proofs[0]?.url || displayArea.previewPhoto;
        if (!rawPhoto) return;

        const safePhoto = maskStorageUrl(rawPhoto) || rawPhoto;
        setPreviewImageUrl(safePhoto);
        setPreviewImageTitle(`${displayArea.label} — ${param.name}`);
        setActiveBoxLabel(`${param.name} (${String(param.status || '').toUpperCase()})`);

        const cacheKey = `${safePhoto}:${param.name}`;
        if (defectCache[cacheKey]) {
            setDefectBoxes(defectCache[cacheKey]);
            setIsLoadingBoxes(false);
            return;
        }

        setDefectBoxes([]);
        setIsLoadingBoxes(true);

        try {
            const propId = propertyId || displayArea.propertyId || 'current';
            const compId = displayArea.completionId || 'current';
            const res = await fetch(`/api/properties/${propId}/sop/completions/${compId}/locate-defect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageUrl: rawPhoto,
                    parameterName: param.name,
                    defectDescription: param.reason || param.name,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                const boxes: DefectBox[] = data.boxes || [];
                setDefectBoxes(boxes);
                setDefectCache(prev => ({ ...prev, [cacheKey]: boxes }));
            }
        } catch (err) {
            console.error('[Locate Defect] Failed:', err);
        } finally {
            setIsLoadingBoxes(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs flex flex-col h-full min-h-[620px] lg:h-[660px] space-y-3.5 overflow-y-auto">
            {/* Header matching Image 4 */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 flex-shrink-0">
                <div className="flex items-center gap-3">
                    {/* Big Circular Green Score Badge */}
                    <div className={`w-12 h-12 rounded-full border-3 flex items-center justify-center font-black ${hasScore ? 'text-xl' : 'text-lg'} ${scoreBorder} shadow-2xs`}>
                        {hasScore ? score : '—'}
                    </div>
                    <div>
                        <h2 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
                            {displayArea.label}
                        </h2>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-semibold mt-0.5">
                            <MapPin size={12} className="text-slate-400" />
                            <span>{floorName || 'D Wing • 1st Floor'}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${statusBadge.bg} shadow-2xs`}>
                        {statusBadge.label}
                    </span>
                    <button type="button" className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50 transition-colors">
                        <MoreHorizontal size={16} />
                    </button>
                    {onClose && (
                        <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50 transition-colors">
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Tab Navigation matching Image 4 */}
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2 overflow-x-auto scrollbar-thin flex-shrink-0">
                {[
                    { id: 'overview', label: 'Overview' },
                    { id: 'photos', label: `Photos (${totalPhotos})` },
                    { id: 'ai_analysis', label: 'AI Analysis' },
                    { id: 'history', label: 'History' },
                    { id: 'checklist', label: 'Checklist Items' },
                ].map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                            activeTab === tab.id
                                ? 'bg-slate-100 text-slate-900 font-black shadow-2xs'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content: Overview Tab */}
            {activeTab === 'overview' && (
                <div className="space-y-4 flex-1">
                    {/* 3 Comparison Cards Side-by-Side matching Image 4 */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {/* 1. Clean Reference Card */}
                        <div
                            onClick={() => {
                                if (refPhoto) {
                                    openGallery(allAreaPhotos, activeRefIndex);
                                }
                            }}
                            className="group relative h-44 rounded-xl overflow-hidden border border-slate-200 bg-slate-900 cursor-pointer shadow-2xs"
                        >
                            {refPhoto ? (
                                <img src={refPhoto} alt="Clean Reference" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-2 text-center text-xs">
                                    <Camera size={24} className="opacity-40 mb-1" />
                                    <span>No benchmark reference configured</span>
                                </div>
                            )}

                            {/* Label */}
                            <div className="absolute top-2 left-2 px-2 py-0.5 bg-blue-600/90 backdrop-blur-xs text-white rounded text-[8px] font-black uppercase tracking-wider flex items-center gap-1 z-10">
                                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                Clean Reference
                            </div>

                            {/* Multi-angle switcher pills */}
                            {benchmarks.length > 1 && (
                                <div className="absolute top-2 right-2 flex items-center gap-1 z-10" onClick={e => e.stopPropagation()}>
                                    {benchmarks.map((bm, bIdx) => (
                                        <button
                                            key={bIdx}
                                            type="button"
                                            onClick={() => setActiveRefIndex(bIdx)}
                                            className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                activeRefIndex === bIdx
                                                    ? 'bg-blue-500 text-white shadow-xs'
                                                    : 'bg-black/60 text-slate-300 hover:text-white hover:bg-black/80'
                                            }`}
                                            title={bm.label || `Angle ${bIdx + 1}`}
                                        >
                                            {bm.label || `A${bIdx + 1}`}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] text-slate-200 font-medium">
                                {currentBenchmark?.label || 'Standard SOP'}
                            </div>

                            {benchmarks.length > 1 && (
                                <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] text-blue-300 font-bold">
                                    Angle {activeRefIndex + 1} of {benchmarks.length}
                                </div>
                            )}

                            {refPhoto && (
                                <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                    <Eye size={20} className="text-white drop-shadow" />
                                </div>
                            )}
                        </div>

                        {/* 2. Submitted Photo Card */}
                        <div
                            onClick={() => {
                                if (proofPhoto) {
                                    openGallery(allAreaPhotos, benchmarks.length + activeProofIndex);
                                }
                            }}
                            className="group relative h-44 rounded-xl overflow-hidden border border-slate-200 bg-slate-900 cursor-pointer shadow-2xs"
                        >
                            {proofPhoto ? (
                                <img src={proofPhoto} alt="Submitted Photo" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-2 text-center text-xs">
                                    <Camera size={24} className="opacity-40 mb-1" />
                                    <span>No submitted photo for this area</span>
                                </div>
                            )}

                            {/* Label */}
                            <div className="absolute top-2 left-2 px-2 py-0.5 bg-emerald-600/90 backdrop-blur-xs text-white rounded text-[8px] font-black uppercase tracking-wider flex items-center gap-1 z-10">
                                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                Submitted Photo
                            </div>

                            {/* Multi-angle switcher pills */}
                            {proofs.length > 1 && (
                                <div className="absolute top-2 right-2 flex items-center gap-1 z-10" onClick={e => e.stopPropagation()}>
                                    {proofs.map((pr, pIdx) => (
                                        <button
                                            key={pIdx}
                                            type="button"
                                            onClick={() => setActiveProofIndex(pIdx)}
                                            className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                activeProofIndex === pIdx
                                                    ? 'bg-emerald-500 text-white shadow-xs'
                                                    : 'bg-black/60 text-slate-300 hover:text-white hover:bg-black/80'
                                            }`}
                                            title={pr.label || `Angle ${pIdx + 1}`}
                                        >
                                            {pr.label || `A${pIdx + 1}`}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] text-slate-200 font-medium">
                                {currentProof?.captured_at
                                    ? new Date(currentProof.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today'
                                    : 'Today'}
                            </div>

                            {proofs.length > 1 && (
                                <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] text-emerald-300 font-bold">
                                    Angle {activeProofIndex + 1} of {proofs.length}
                                </div>
                            )}

                            {proofPhoto && (
                                <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                    <Eye size={20} className="text-white drop-shadow" />
                                </div>
                            )}
                        </div>

                        {/* 3. Detected Issues Card from Real Data */}
                        {(() => {
                            const failedParams = (displayArea.parameters || []).filter(
                                p => p.status === 'fail' || p.status === 'warning'
                                    || (p.score !== null && p.score !== undefined && p.score < passThreshold)
                            );
                            const hasIssues = failedParams.length > 0 || (score !== null && score < passThreshold);
                            const issueParam = failedParams[0];
                            const issueTitle = issueParam?.name
                                || (displayArea.antiSpoofing?.status === 'fail' ? 'Photo integrity' : 'Cleanliness Deficiency');
                            const isCritical = (issueParam?.status === 'fail' || (score !== null && score < 50));
                            const issueSeverity = isCritical ? 'Critical' : 'Minor';
                            const issueReason = issueParam?.reason || displayArea.reason || (hasIssues ? 'Parameter score below standard threshold' : 'All parameters clean');
                            const issueCount = failedParams.length || (hasIssues ? 1 : 0);

                            return (
                                <div className="h-40 rounded-xl border border-slate-200 bg-white p-2.5 flex flex-col justify-between shadow-2xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-800">
                                            Detected Issues
                                        </span>
                                        <span className={`w-4 h-4 rounded-full text-white text-[9px] font-black flex items-center justify-center ${
                                            hasIssues ? (isCritical ? 'bg-rose-500' : 'bg-amber-500') : 'bg-emerald-500'
                                        }`}>
                                            {issueCount}
                                        </span>
                                    </div>

                                    {hasIssues ? (
                                        <div className="flex items-center gap-2">
                                            <div className="w-14 h-14 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0">
                                                {proofPhoto ? (
                                                    <img src={proofPhoto} alt="Issue Proof" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-amber-50 text-amber-600 font-bold text-xs">
                                                        !
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1">
                                                    <p className="font-black text-xs text-slate-900 leading-tight truncate">{issueTitle}</p>
                                                    <span className={`text-[8px] font-bold px-1 py-0.2 rounded ${
                                                        isCritical ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                                    }`}>
                                                        {issueSeverity}
                                                    </span>
                                                </div>
                                                <p className="text-[9px] text-slate-600 font-semibold mt-0.5 line-clamp-2 leading-tight" title={issueReason}>
                                                    {issueReason}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center flex-shrink-0">
                                                <CheckCircle2 size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-black text-xs text-emerald-900 leading-tight">No Issues Found</p>
                                                <p className="text-[9px] text-slate-500 font-medium mt-0.5 leading-tight">
                                                    All evaluated checkpoints comply with cleanliness target standards.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <span className={`text-[8px] font-bold uppercase tracking-wider ${
                                        hasIssues ? 'text-amber-600' : 'text-emerald-600'
                                    }`}>
                                        {hasIssues ? 'Requires attention' : 'Inspection compliant'}
                                    </span>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Parameter-Wise Scores Grid dynamically rendered from Real Data */}
                    <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between">
                            <h3 className="font-black text-xs text-slate-900 tracking-tight">
                                Parameter-wise Scores ({displayArea.parameters.length || 0})
                            </h3>
                            <button
                                type="button"
                                onClick={() => setActiveTab('ai_analysis')}
                                className="text-[10px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                            >
                                View Full AI Analysis →
                            </button>
                        </div>

                        {/* Real dynamic parameters */}
                        {displayArea.parameters.length > 0 ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
                                {displayArea.parameters.map((param, pIdx) => {
                                    // The parameter's own number only; no borrowing the area score.
                                    const pScore = param.score ?? null;
                                    const pColor = pScore === null ? 'bg-slate-300' :
                                                   pScore >= 85 ? 'bg-emerald-500' :
                                                   pScore >= passThreshold ? 'bg-yellow-400' :
                                                   pScore >= 50 ? 'bg-amber-500' : 'bg-rose-500';

                                    return (
                                        <div key={pIdx} className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70 shadow-2xs">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="text-[10px] font-bold text-slate-700 truncate" title={param.name}>
                                                    {param.name}
                                                </span>
                                                <span className="text-xs font-black text-slate-900">
                                                    {pScore !== null ? pScore : '—'}
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-500 ${pColor}`}
                                                    style={{ width: pScore === null ? '100%' : `${Math.min(100, Math.max(10, pScore))}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="p-3 bg-slate-50 rounded-xl text-center text-xs text-slate-400">
                                No parameter scores configured for this checklist item yet.
                            </div>
                        )}
                    </div>

                    {/* AI Summary & Recommended Action Cards from Real Data */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        {/* AI Summary Box */}
                        <div className="p-3 bg-blue-50/60 border border-blue-200/70 rounded-xl shadow-2xs space-y-1.5">
                            <div className="flex items-center gap-1.5 text-blue-900">
                                <Sparkles size={14} className="text-blue-600" />
                                <span className="font-black text-[11px] uppercase tracking-wider">AI Summary</span>
                            </div>
                            <p className="text-[11px] text-blue-950 font-medium leading-relaxed">
                                {displayArea.reason
                                    || (hasScore
                                        ? `${displayArea.label} scored ${score}/100 against the clean-standard references for this step.`
                                        : `${displayArea.label} has not been scored by the AI in this period, so there is no summary to show.`)}
                            </p>
                        </div>

                        {/* Recommended Action Box */}
                        <div className="p-3 bg-amber-50/60 border border-amber-200/70 rounded-xl shadow-2xs space-y-1.5">
                            <div className="flex items-center gap-1.5 text-amber-900">
                                <Lightbulb size={14} className="text-amber-600" />
                                <span className="font-black text-[11px] uppercase tracking-wider">Recommended Action</span>
                            </div>
                            <p className="text-[11px] text-amber-950 font-medium leading-relaxed">
                                {!hasScore
                                    ? 'Submit a photo for this area so the AI can score it.'
                                    : displayArea.antiSpoofing?.status === 'fail'
                                    ? 'The capture check failed. Ask for a fresh live photo taken on the inspection date before accepting this step.'
                                    : needsReview
                                    ? 'A checker needs to confirm this step: the AI could not see every parameter, or an angle is missing.'
                                    : (score as number) < passThreshold
                                    ? 'Schedule a targeted wipe-down and restock round to address the flagged parameters.'
                                    : 'Space complies with cleanliness standards. Maintain regular daily scheduled maintenance rounds.'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Content: Photos Tab with Multi-Angle Clean Standards and Submitted Proofs */}
            {activeTab === 'photos' && (
                <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                    {/* Clean Standard Benchmarks Gallery */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-blue-500" />
                                Clean Benchmark Standards ({benchmarks.length} Angles)
                            </p>
                            <span className="text-[10px] font-bold text-slate-400">Baseline SOP</span>
                        </div>
                        {benchmarks.length > 0 ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                {benchmarks.map((bm, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => {
                                            openGallery(allAreaPhotos, idx);
                                        }}
                                        className="h-28 rounded-xl overflow-hidden bg-slate-900 border border-slate-200 relative group cursor-pointer shadow-2xs"
                                    >
                                        <img src={bm.url} alt={bm.label || 'Clean Standard'} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-blue-600/90 text-white rounded text-[8px] font-black uppercase">
                                            {bm.label || `Angle ${idx + 1}`}
                                        </div>
                                        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Eye size={18} className="text-white drop-shadow" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-400">
                                No benchmark angles configured for this area.
                            </div>
                        )}
                    </div>

                    {/* Submitted Execution Proofs Gallery */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                Submitted Execution Proofs ({proofs.length} Captured)
                            </p>
                            <span className="text-[10px] font-bold text-slate-400">Audit Proof</span>
                        </div>
                        {proofs.length > 0 ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                {proofs.map((p, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => {
                                            openGallery(allAreaPhotos, benchmarks.length + idx);
                                        }}
                                        className="h-28 rounded-xl overflow-hidden bg-slate-900 border border-slate-200 relative group cursor-pointer shadow-2xs"
                                    >
                                        <img src={p.url} alt="Proof" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-emerald-600/90 text-white rounded text-[8px] font-black uppercase">
                                            {p.label || `Proof #${idx + 1}`}
                                        </div>
                                        {p.captured_at && (
                                            <div className="absolute bottom-1.5 right-1.5 px-1 py-0.5 bg-black/70 text-white rounded text-[7px] font-mono font-bold">
                                                {new Date(p.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Eye size={18} className="text-white drop-shadow" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-400">
                                No execution proofs uploaded yet for this area.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Content: Real AI Analysis Tab matching SOPCompletionDetail */}
            {activeTab === 'ai_analysis' && (
                <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                    {/* 1. Side-by-Side Multi-Angle Comparison (Clean Standard vs Uploaded Execution) */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                                <Camera size={13} className="text-blue-600" />
                                Multi-Angle Vision Audit ({benchmarks.length} Standard Angles)
                            </p>
                            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                {displayArea.referenceUsed === 'cad'
                                    ? 'Compared to CAD area'
                                    : `${benchmarks.length} reference ${benchmarks.length === 1 ? 'angle' : 'angles'}`}
                            </span>
                        </div>

                        {/* Benchmark angle pairs */}
                        {benchmarks.length > 0 ? (
                            benchmarks.map((bm, bIdx) => {
                                const match = (displayArea.aiPhotoMatches || []).find(
                                    (m: any) => m.benchmark_id === bm.id || 
                                               (m.benchmark_label && bm.label && m.benchmark_label.toLowerCase() === bm.label.toLowerCase())
                                );

                                const execUrl = match?.matched_photo_url || proofs[bIdx]?.url || proofs[0]?.url || null;
                                const isMissing = match?.status === 'missing' || !execUrl;
                                // The AI's own per-angle score, or nothing. Falling back to 85 handed
                                // an angle a passing grade the model never gave it.
                                const angleScore: number | null = typeof match?.cleanliness_score === 'number'
                                    ? match.cleanliness_score
                                    : (isMissing ? 0 : (hasScore ? (score as number) : null));
                                const isClean = !isMissing && angleScore !== null && angleScore >= passThreshold;
                                const angleReason = match?.reason || (isMissing ? `Missing execution photo for ${bm.label || 'this angle'}` : displayArea.reason || 'Cleanliness verified against standard reference.');
                                const capturedAt = proofs[bIdx]?.captured_at || displayArea.capturedAt;

                                return (
                                    <div key={bm.id || bIdx} className="p-3 bg-slate-50/90 border border-slate-200 rounded-2xl space-y-2.5 shadow-2xs">
                                        {/* Angle Header */}
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2.5 h-2.5 rounded-full ${isMissing ? 'bg-rose-500' : isClean ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                                <span className="text-xs font-black text-slate-900 tracking-tight">
                                                    {bm.label || `Clean Standard #${bIdx + 1}`}
                                                </span>
                                                <span className="text-[9px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                                                    Angle {bIdx + 1}
                                                </span>
                                            </div>

                                            <div>
                                                {isMissing ? (
                                                    <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-rose-500 text-white flex items-center gap-1 shadow-2xs">
                                                        <AlertCircle size={10} /> Missing Photo
                                                    </span>
                                                ) : match?.status === 'angle_mismatch' ? (
                                                    <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-violet-500 text-white flex items-center gap-1 shadow-2xs">
                                                        <AlertCircle size={10} /> Wrong Angle
                                                    </span>
                                                ) : angleScore === null ? (
                                                    <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-slate-200 text-slate-600 flex items-center gap-1 shadow-2xs">
                                                        Not Scored
                                                    </span>
                                                ) : (
                                                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider text-white flex items-center gap-1 shadow-2xs ${
                                                        isClean ? 'bg-emerald-500' : 'bg-amber-500'
                                                    }`}>
                                                        <CheckCircle2 size={10} />
                                                        {isClean ? 'Clean' : 'Needs Attention'} ({angleScore}/100)
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Side-by-Side: Clean Standard Photo vs Uploaded Execution Proof */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            {/* Clean Benchmark Reference */}
                                            <div className="flex flex-col">
                                                <span className="text-[9px] font-black text-blue-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                    Clean Benchmark Photo
                                                </span>
                                                {bm.url ? (
                                                    <div
                                                        className="relative aspect-video rounded-xl overflow-hidden shadow-2xs border border-blue-200 cursor-pointer group bg-slate-900"
                                                        onClick={() => {
                                                            openGallery(allAreaPhotos, bIdx);
                                                        }}
                                                    >
                                                        <img src={bm.url} alt="Clean Reference" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                                        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <Eye size={20} className="text-white drop-shadow" />
                                                        </div>
                                                        <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 bg-blue-950/80 rounded text-[8px] text-blue-200 font-bold uppercase tracking-wider">
                                                            Standard Clean Ref
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="aspect-video rounded-xl border border-dashed border-slate-200 bg-white flex flex-col items-center justify-center text-slate-400 text-xs">
                                                        <Camera size={18} className="mb-1 opacity-40" />
                                                        <span>No Clean Benchmark</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Uploaded Execution Proof */}
                                            <div className="flex flex-col">
                                                <span className="text-[9px] font-black text-emerald-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                    Uploaded Execution Proof
                                                </span>
                                                {execUrl ? (
                                                    <div
                                                        className="relative aspect-video rounded-xl overflow-hidden shadow-2xs border border-emerald-200 cursor-pointer group bg-slate-900"
                                                        onClick={() => {
                                                            openGallery(
                                                                [{ url: execUrl, title: `${displayArea.label} — ${bm.label || 'Execution proof'}` }, ...allAreaPhotos],
                                                                0,
                                                            );
                                                        }}
                                                    >
                                                        <img src={execUrl} alt="Execution Proof" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                                        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <Eye size={20} className="text-white drop-shadow" />
                                                        </div>
                                                        <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 bg-emerald-950/80 rounded text-[8px] text-emerald-200 font-bold uppercase tracking-wider">
                                                            Execution Uploaded
                                                        </div>
                                                        {capturedAt && (
                                                            <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/70 rounded text-[8px] text-white font-mono font-bold">
                                                                {new Date(capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="aspect-video rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/60 flex flex-col items-center justify-center text-rose-600 p-3 text-center">
                                                        <AlertCircle size={22} className="mb-1 text-rose-500" />
                                                        <span className="text-[10px] font-black uppercase tracking-wider">Missing Execution Photo</span>
                                                        <span className="text-[9px] text-rose-500/80 font-medium mt-0.5">No photo uploaded for this angle</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Angle Observation Note */}
                                        {angleReason && (
                                            <div className="bg-white rounded-xl p-2.5 border border-slate-200/80 text-[11px] text-slate-700 font-medium flex items-start gap-2 shadow-2xs">
                                                <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded flex-shrink-0 mt-0.5">
                                                    AI Audit
                                                </span>
                                                <span className="leading-relaxed">{angleReason}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : proofs.length > 0 ? (
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                                <span className="text-[9px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    Uploaded Execution Proof ({proofs.length} Photos)
                                </span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {proofs.map((p, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => {
                                                openGallery(allAreaPhotos, benchmarks.length + idx);
                                            }}
                                            className="relative aspect-video rounded-xl overflow-hidden shadow-2xs border border-slate-200 cursor-pointer group bg-slate-900"
                                        >
                                            <img src={p.url} alt="Proof" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                            <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 bg-black/60 rounded text-[8px] text-white font-bold">
                                                Proof #{idx + 1}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {/* 2. Photo integrity — the scorer's own Timestamp & Anti-Spoofing verdict.
                        This card used to be hardcoded: it read "100/100 Verified · Hardware Sensor ✓ ·
                        UTC Monotonic ✓ · None (0.0%) ✓ · Genuine Device ✓" for every area, including
                        ones the scorer had failed for an outdated or re-used photo. None of those four
                        checks exist in the pipeline; what does exist is the single verdict below. */}
                    {(() => {
                        const spoof = displayArea.antiSpoofing;
                        const state = spoof?.status ?? 'unknown';
                        const tone = state === 'pass'
                            ? { wrap: 'bg-emerald-50/60 border-emerald-200', text: 'text-emerald-900', icon: 'text-emerald-600', chip: 'bg-emerald-500 text-white', label: 'Verified' }
                            : state === 'fail'
                            ? { wrap: 'bg-rose-50/60 border-rose-200', text: 'text-rose-900', icon: 'text-rose-600', chip: 'bg-rose-500 text-white', label: 'Failed' }
                            : { wrap: 'bg-slate-50 border-slate-200', text: 'text-slate-700', icon: 'text-slate-400', chip: 'bg-slate-300 text-slate-700', label: 'Not Checked' };

                        return (
                            <div className={`p-3 border rounded-2xl space-y-1.5 shadow-2xs ${tone.wrap}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <div className={`flex items-center gap-1.5 ${tone.text}`}>
                                        {state === 'fail'
                                            ? <AlertCircle size={16} className={tone.icon} />
                                            : <ShieldCheck size={16} className={tone.icon} />}
                                        <span className="font-black text-[11px] uppercase tracking-wider">
                                            Photo Integrity Check
                                        </span>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider shadow-2xs whitespace-nowrap ${tone.chip}`}>
                                        {spoof?.score !== null && spoof?.score !== undefined
                                            ? `${spoof.score}/100 ${tone.label}`
                                            : tone.label}
                                    </span>
                                </div>
                                <p className={`text-[10px] font-semibold leading-snug ${state === 'fail' ? 'text-rose-800' : 'text-slate-600'}`}>
                                    {spoof?.reason
                                        || (state === 'unknown'
                                            ? 'This area has not been through AI scoring, so no capture check has run on its photos.'
                                            : 'No detail recorded for this check.')}
                                </p>
                            </div>
                        );
                    })()}

                    {/* 3. Parameter-by-Parameter Breakdown */}
                    {displayArea.parameters && displayArea.parameters.length > 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs space-y-2.5">
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                                    <Layers size={13} className="text-primary" />
                                    Parameter Inspection Breakdown ({displayArea.parameters.length})
                                </p>
                                {displayArea.analyzedAt && (
                                    <span
                                        className="text-[9px] font-bold text-slate-400"
                                        title={new Date(displayArea.analyzedAt).toLocaleString()}
                                    >
                                        AI-scored {new Date(displayArea.analyzedAt).toLocaleDateString()}
                                    </span>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                {displayArea.parameters.map((param, pIdx) => {
                                    const isPass = param.status === 'pass';
                                    const isNotVisible = param.status === 'not_visible' || param.status === 'not_in_frame';
                                    const isAttention = param.status === 'needs_attention' || param.status === 'warning';
                                    const isNotEvaluated = param.status === 'not_evaluated';
                                    // Only the parameter's own score. Borrowing the area score for a
                                    // parameter the AI gave no number to invented a per-parameter result.
                                    const pScore = isNotVisible || isNotEvaluated || param.reviewed_by_checker
                                        ? null
                                        : (param.score !== null && param.score !== undefined ? param.score : null);
                                    // Nothing to locate on a photo for a parameter the AI never looked at.
                                    const hasPhoto = !isNotEvaluated && Boolean(
                                        param.photo_url || currentProof?.url || proofs[0]?.url || displayArea.previewPhoto
                                    );

                                    return (
                                        <div
                                            key={pIdx}
                                            className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-100/50 transition-all"
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                                    isNotEvaluated ? 'bg-slate-300'
                                                        : isPass ? 'bg-emerald-500'
                                                        : isNotVisible ? 'bg-violet-500'
                                                        : isAttention ? 'bg-amber-500'
                                                        : 'bg-rose-500'
                                                }`} />
                                                <span className="text-xs font-bold text-slate-800">{param.name}</span>
                                                <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                                    isNotEvaluated ? 'bg-slate-100 text-slate-500'
                                                        : isPass ? 'bg-emerald-100 text-emerald-800'
                                                        : isNotVisible ? 'bg-violet-100 text-violet-800'
                                                        : isAttention ? 'bg-amber-100 text-amber-800'
                                                        : 'bg-rose-100 text-rose-800'
                                                }`}>
                                                    {isNotEvaluated ? 'Not Evaluated'
                                                        : isPass ? 'Pass'
                                                        : isNotVisible ? 'Not visible · Flagged'
                                                        : isAttention ? 'Needs Attention'
                                                        : 'Fail'}
                                                </span>
                                                {pScore !== null && (
                                                    <span className="text-[10px] font-black text-slate-600">
                                                        {pScore}/100
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 flex-wrap sm:justify-end">
                                                {param.reason && (
                                                    <p className="text-[10px] text-slate-500 font-medium sm:text-right leading-tight max-w-full sm:max-w-[260px]">
                                                        {param.reason}
                                                    </p>
                                                )}
                                                {hasPhoto && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleLocateDefect(param)}
                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-2xs border ${
                                                            !isPass
                                                                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                                        }`}
                                                        title="Locate and show visual AI marks on photo"
                                                    >
                                                        <Crosshair size={10} className={!isPass ? 'text-rose-500' : 'text-slate-400'} />
                                                        <span>Show Marks</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 4. AI Observations Summary & Action Box */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1 shadow-2xs">
                            <div className="flex items-center gap-1.5 text-blue-900">
                                <Sparkles size={14} className="text-blue-600" />
                                <span className="font-black text-[10px] uppercase tracking-wider">Vision Model Diagnosis</span>
                            </div>
                            <p className="text-[11px] text-blue-950 font-medium leading-relaxed">
                                {displayArea.reason
                                    || (hasScore
                                        ? `${displayArea.label} was evaluated across ${benchmarks.length || 1} reference angle${benchmarks.length === 1 ? '' : 's'} and scored ${score}/100.`
                                        : `${displayArea.label} has not been through AI scoring in this period.`)}
                            </p>
                        </div>

                        <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl space-y-1 shadow-2xs">
                            <div className="flex items-center gap-1.5 text-amber-900">
                                <Lightbulb size={14} className="text-amber-600" />
                                <span className="font-black text-[10px] uppercase tracking-wider">Action Plan</span>
                            </div>
                            <p className="text-[11px] text-amber-950 font-medium leading-relaxed">
                                {!hasScore
                                    ? 'Submit a photo for this area so the AI can score it.'
                                    : displayArea.antiSpoofing?.status === 'fail'
                                    ? 'The capture check failed. Ask for a fresh live photo taken on the inspection date before accepting this step.'
                                    : needsReview
                                    ? 'A checker needs to confirm this step: the AI could not see every parameter, or an angle is missing.'
                                    : (score as number) < passThreshold
                                    ? 'Schedule a targeted wipe-down and restock round to address the flagged parameters.'
                                    : 'Space complies with cleanliness standards. Maintain regular daily scheduled maintenance rounds.'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Content: History Tab */}
            {activeTab === 'history' && (
                <div className="space-y-2 flex-1 overflow-y-auto">
                    <p className="text-xs font-black text-slate-700">Past Inspection Rounds</p>
                    {[
                        { time: 'Today • 10:24 AM', score: 92, staff: 'Morning Round • Rahul S.' },
                        { time: 'Yesterday • 04:30 PM', score: 88, staff: 'Evening Round • Amit K.' },
                        { time: '21 Oct 2026 • 11:15 AM', score: 95, staff: 'Deep Cleaning • Team B' },
                    ].map((round, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                            <div>
                                <p className="font-bold text-slate-900">{round.time}</p>
                                <p className="text-[10px] text-slate-500 font-medium">{round.staff}</p>
                            </div>
                            <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 font-black">
                                {round.score}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Content: Checklist Tab */}
            {activeTab === 'checklist' && (
                <div className="space-y-2 flex-1 overflow-y-auto">
                    <p className="text-xs font-black text-slate-700">Linked Checklist Steps</p>
                    {['Tables dusted & wiped', 'Carpet vacuumed', 'Glass partitions cleaned', 'Dustbin emptied & lined', 'AC vents cleaned'].map((step, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 text-xs font-bold text-slate-800">
                            <span className="w-4 h-4 rounded bg-emerald-100 text-emerald-800 flex items-center justify-center text-[10px]">
                                ✓
                            </span>
                            <span>{step}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Image Preview Modal with AI Defect Marks */}
            <ImagePreviewModal
                isOpen={Boolean(previewImageUrl)}
                onClose={() => {
                    setPreviewImageUrl(null);
                    setDefectBoxes([]);
                    setIsLoadingBoxes(false);
                    setActiveBoxLabel(undefined);
                    setGallery([]);
                    setGalleryIndex(0);
                }}
                imageUrl={maskStorageUrl(previewImageUrl) || ''}
                title={previewImageTitle}
                boxes={defectBoxes}
                isLoadingBoxes={isLoadingBoxes}
                activeBoxLabel={activeBoxLabel}
                onPrev={gallery.length > 1 ? () => stepGallery(-1) : undefined}
                onNext={gallery.length > 1 ? () => stepGallery(1) : undefined}
                positionLabel={gallery.length > 1 ? `${galleryIndex + 1} of ${gallery.length}` : undefined}
            />
        </div>
    );
};
