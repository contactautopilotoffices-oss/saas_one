'use client';

import React, { useState } from 'react';
import { AlertCircle, Check, Loader2, ThumbsUp, ThumbsDown, Eye, GraduationCap, Crosshair } from 'lucide-react';
import ImagePreviewModal, { DefectBox } from '@/frontend/components/shared/ImagePreviewModal';
import { maskStorageUrl } from '@/frontend/utils/storageUrl';

/**
 * Per-parameter AI verdicts for one checklist step, with checker correction controls.
 * Corrections are saved to /ai-feedback and fed back to the AI as standing rules
 * for this step and for same-named parameters on other checklists in the organization.
 */

type ParamStatus = 'pass' | 'needs_attention' | 'fail' | 'not_visible';

const STATUS_META: Record<string, { label: string; dot: string; pill: string }> = {
    pass: { label: 'Pass', dot: 'bg-emerald-500', pill: 'bg-emerald-100 text-emerald-800' },
    needs_attention: { label: 'Needs Attention', dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800' },
    fail: { label: 'Fail', dot: 'bg-rose-500', pill: 'bg-rose-100 text-rose-800' },
    not_visible: { label: 'Not visible · Flagged', dot: 'bg-rose-500', pill: 'bg-rose-50 text-rose-700 border border-rose-300' },
};

const CORRECTION_OPTIONS: Array<{ value: ParamStatus; label: string }> = [
    { value: 'pass', label: 'Pass' },
    { value: 'needs_attention', label: 'Needs Attention' },
    { value: 'fail', label: 'Fail' },
    { value: 'not_visible', label: 'Not visible' },
];

function normalizeStatus(param: any): ParamStatus {
    const s = String(param?.status || '').toLowerCase();
    if (s === 'pass' || s === 'needs_attention' || s === 'fail') return s;
    if (s === 'warning') return 'needs_attention';
    return 'not_visible'; // not_visible, not_in_frame, unassessable
}

interface Props {
    item: any;
    propertyId: string;
    completionId: string;
    canReview: boolean;
    formatReason?: (text: string) => string;
    onPreviewImage?: (url: string) => void;
    onUpdated: (itemId: string, parameters: any[], needsReview: boolean) => void;
    onToast?: (message: string, type: 'success' | 'error') => void;
}

const SOPAIParameterReview: React.FC<Props> = ({
    item, propertyId, completionId, canReview, formatReason, onPreviewImage, onUpdated, onToast,
}) => {
    const [openEditor, setOpenEditor] = useState<string | null>(null);
    const [draftStatus, setDraftStatus] = useState<ParamStatus | null>(null);
    const [draftNote, setDraftNote] = useState('');
    const [saving, setSaving] = useState<string | null>(null);
    const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
    const [previewTitle, setPreviewTitle] = useState('');
    const [defectBoxes, setDefectBoxes] = useState<DefectBox[]>([]);
    const [isLoadingBoxes, setIsLoadingBoxes] = useState(false);
    const [activeBoxLabel, setActiveBoxLabel] = useState<string | undefined>(undefined);
    const [defectCache, setDefectCache] = useState<Record<string, DefectBox[]>>({});
    const [activeParam, setActiveParam] = useState<any>(null);
    const [activeAngleIndex, setActiveAngleIndex] = useState<number>(0);

    const allPhotos: Array<{ index: number; id: string; url: string; label: string }> = React.useMemo(() => {
        if (Array.isArray(item.photos) && item.photos.length > 0) {
            return item.photos.map((p: any, idx: number) => ({
                index: idx,
                id: p.id || `photo_${idx + 1}`,
                url: typeof p === 'string' ? p : p.url,
                label: p.angle_label || `Angle #${idx + 1}`,
            }));
        }
        if (item.photo_url) {
            return [{ index: 0, id: 'photo_1', url: item.photo_url, label: 'Angle #1' }];
        }
        return [];
    }, [item.photos, item.photo_url]);

    const paramScores: any[] = Array.isArray(item.ai_parameter_scores)
        ? item.ai_parameter_scores
        : typeof item.ai_parameter_scores === 'string'
            ? (() => { try { return JSON.parse(item.ai_parameter_scores); } catch { return []; } })()
            : [];

    if (paramScores.length === 0) return null;

    const flaggedCount = paramScores.filter((p: any) => !p.system && normalizeStatus(p) === 'not_visible' && !p.reviewer_status).length;

    const submit = async (param: any, verdict: 'correct' | 'incorrect', correctedStatus: ParamStatus | null, note: string) => {
        if (verdict === 'incorrect' && !correctedStatus) return;
        setSaving(param.name);
        try {
            const res = await fetch(`/api/properties/${propertyId}/sop/completions/${completionId}/ai-feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    completionItemId: item.id,
                    parameterName: param.name,
                    verdict,
                    correctedStatus: verdict === 'incorrect' ? correctedStatus : null,
                    guidance: note.trim() || undefined,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not save');
            onUpdated(item.id, data.parameters || paramScores, Boolean(data.needs_review));
            onToast?.(verdict === 'correct' ? 'Marked AI as correct' : 'Correction saved. The AI will use it next time.', 'success');
            setOpenEditor(null);
            setDraftStatus(null);
            setDraftNote('');
        } catch (err: any) {
            onToast?.(err.message || 'Could not save correction', 'error');
        } finally {
            setSaving(null);
        }
    };

    const fetchBoxesForPhoto = async (photoUrl: string, param: any): Promise<DefectBox[]> => {
        const safePhoto = maskStorageUrl(photoUrl) || photoUrl;
        const cacheKey = `${safePhoto}:${param.name}`;
        if (defectCache[cacheKey]) {
            return defectCache[cacheKey];
        }

        try {
            const res = await fetch(`/api/properties/${propertyId}/sop/completions/${completionId}/locate-defect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageUrl: photoUrl,
                    parameterName: param.name,
                    defectDescription: param.reason || param.name,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                const boxes: DefectBox[] = data.boxes || [];
                setDefectCache(prev => ({ ...prev, [cacheKey]: boxes }));
                return boxes;
            }
        } catch (err) {
            console.error('[Locate Defect] Failed:', err);
        }
        return [];
    };

    const handleLocateDefect = async (param: any) => {
        if (allPhotos.length === 0) {
            onToast?.('No photo available for this parameter', 'error');
            return;
        }

        setActiveParam(param);

        // Pre-populate cache if param already has pre-computed boxes from score-photo
        if (Array.isArray(param.boxes) && param.boxes.length > 0) {
            const targetUrl = param.found_in_photo_url || allPhotos[0]?.url;
            if (targetUrl) {
                const safeUrl = maskStorageUrl(targetUrl) || targetUrl;
                setDefectCache(prev => ({ ...prev, [`${safeUrl}:${param.name}`]: param.boxes }));
            }
        }

        // Determine initial photo to show
        let initialIndex = 0;
        if (param.found_in_photo_url) {
            const idx = allPhotos.findIndex(p => p.url === param.found_in_photo_url);
            if (idx >= 0) initialIndex = idx;
        } else if (typeof param.found_in_photo === 'number' && param.found_in_photo >= 1 && param.found_in_photo <= allPhotos.length) {
            initialIndex = param.found_in_photo - 1;
        } else if (param.expected_angle) {
            const exp = String(param.expected_angle).toLowerCase();
            const idx = allPhotos.findIndex(p => p.label.toLowerCase().includes(exp));
            if (idx >= 0) initialIndex = idx;
        }

        setActiveAngleIndex(initialIndex);
        const initialPhoto = allPhotos[initialIndex];
        const safeInitialPhoto = maskStorageUrl(initialPhoto.url) || initialPhoto.url;
        setPreviewPhotoUrl(safeInitialPhoto);
        setPreviewTitle(`${item.checklist_item?.title || 'Checklist Step'} — ${param.name}`);
        setActiveBoxLabel(`${param.name} (${normalizeStatus(param).toUpperCase()})`);

        const initialCacheKey = `${safeInitialPhoto}:${param.name}`;
        if (defectCache[initialCacheKey]) {
            setDefectBoxes(defectCache[initialCacheKey]);
            setIsLoadingBoxes(false);
            return;
        }

        setDefectBoxes([]);
        setIsLoadingBoxes(true);

        try {
            // When multiple photos exist and the parameter location was uncertain (or marked not_visible),
            // check all angle photos in parallel so marks across all angles are discovered!
            if (allPhotos.length > 1 && (!param.found_in_photo_url || param.status === 'not_visible')) {
                const results = await Promise.all(
                    allPhotos.map(async (p, pIdx) => {
                        const boxes = await fetchBoxesForPhoto(p.url, param);
                        return { pIdx, photoUrl: p.url, boxes };
                    })
                );

                // Find if an angle actually found the parameter/defect
                const matchedAngle = results.find(r => r.boxes.length > 0);
                if (matchedAngle) {
                    setActiveAngleIndex(matchedAngle.pIdx);
                    setPreviewPhotoUrl(maskStorageUrl(matchedAngle.photoUrl) || matchedAngle.photoUrl);
                    setDefectBoxes(matchedAngle.boxes);
                } else {
                    const initialRes = results.find(r => r.pIdx === initialIndex);
                    setDefectBoxes(initialRes?.boxes || []);
                }
            } else {
                const boxes = await fetchBoxesForPhoto(initialPhoto.url, param);
                setDefectBoxes(boxes);
            }
        } finally {
            setIsLoadingBoxes(false);
        }
    };

    const handleSwitchAngle = async (newIndex: number) => {
        if (newIndex < 0 || newIndex >= allPhotos.length || !activeParam) return;
        setActiveAngleIndex(newIndex);
        const targetPhoto = allPhotos[newIndex];
        const safePhoto = maskStorageUrl(targetPhoto.url) || targetPhoto.url;
        setPreviewPhotoUrl(safePhoto);

        const cacheKey = `${safePhoto}:${activeParam.name}`;
        if (defectCache[cacheKey]) {
            setDefectBoxes(defectCache[cacheKey]);
            setIsLoadingBoxes(false);
            return;
        }

        setDefectBoxes([]);
        setIsLoadingBoxes(true);
        try {
            const boxes = await fetchBoxesForPhoto(targetPhoto.url, activeParam);
            setDefectBoxes(boxes);
        } finally {
            setIsLoadingBoxes(false);
        }
    };

    return (
        <div className="mt-2.5 bg-white/90 rounded-xl border border-slate-200/90 p-3 shadow-2xs">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                    Parameter Inspection Breakdown ({paramScores.length})
                </p>
                {item.ai_needs_review ? (
                    <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 flex items-center gap-1">
                        <AlertCircle size={10} /> Needs checker review{flaggedCount > 0 ? ` · ${flaggedCount} not verified` : ''}
                    </span>
                ) : (
                    <span className="text-slate-400 text-[8px] font-semibold lowercase">ai vision verified</span>
                )}
            </div>

            <div className="space-y-1.5">
                {paramScores.map((param: any, pIdx: number) => {
                    const status = normalizeStatus(param);
                    const meta = STATUS_META[status];
                    const reviewed = Boolean(param.reviewer_status);
                    const reviewedMeta = reviewed ? STATUS_META[param.reviewer_status] || STATUS_META.not_visible : null;
                    const editorKey = `${item.id}:${param.name}`;
                    const isEditing = openEditor === editorKey;
                    const isSaving = saving === param.name;

                    return (
                        <div key={pIdx} className={`p-2 rounded-lg border ${param.flagged && !reviewed ? 'bg-rose-50/60 border-rose-200' : 'bg-slate-50 border-slate-100'}`}>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                                    <span className="text-xs font-bold text-slate-800">{param.name}</span>
                                    <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.pill}`}>
                                        {meta.label}
                                    </span>
                                    {status !== 'not_visible' && typeof param.score === 'number' && (
                                        <span className="text-[10px] font-black text-slate-600">{param.score}/100</span>
                                    )}
                                </div>
                                {param.reason && (
                                    <p className="text-[10px] text-slate-500 font-medium sm:text-right sm:max-w-[50%] leading-tight">
                                        {formatReason ? formatReason(param.reason) : param.reason}
                                    </p>
                                )}
                            </div>

                            {(param.expected_angle || param.found_in_photo_url || (Array.isArray(item.photos) && item.photos.length > 0) || item.photo_url) && (
                                <div className="mt-1 flex items-center gap-2 flex-wrap text-[9px] text-slate-500 font-semibold">
                                    {param.expected_angle && <span>Expected angle: <span className="text-slate-700">{param.expected_angle}</span></span>}
                                    {param.found_in_photo_url && (
                                        <button
                                            type="button"
                                            onClick={() => onPreviewImage?.(param.found_in_photo_url)}
                                            className="flex items-center gap-1 text-primary hover:underline cursor-pointer"
                                        >
                                            <Eye size={10} /> Seen in photo
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleLocateDefect(param)}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-2xs border ${
                                            status !== 'pass'
                                                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                        }`}
                                        title="Locate defect and view AI bounding box marks on photo"
                                    >
                                        <Crosshair size={10} className={status !== 'pass' ? 'text-rose-500' : 'text-slate-400'} />
                                        <span>Show Marks</span>
                                    </button>
                                </div>
                            )}

                            {reviewed && reviewedMeta && (
                                <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-slate-700">
                                    <GraduationCap size={11} className="text-primary mt-[1px] flex-shrink-0" />
                                    <span>
                                        <span className="font-bold">Checker: </span>
                                        {param.reviewer_verdict === 'correct' ? 'AI was right' : <>should be <span className={`text-[8px] font-black uppercase px-1 py-0.5 rounded ${reviewedMeta.pill}`}>{reviewedMeta.label}</span></>}
                                        {param.reviewer_note ? ` · ${param.reviewer_note}` : ''}
                                    </span>
                                </div>
                            )}

                            {canReview && !param.system && !isEditing && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => submit(param, 'correct', null, '')}
                                        className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wider hover:bg-emerald-100 disabled:opacity-40 cursor-pointer"
                                    >
                                        {isSaving ? <Loader2 size={10} className="animate-spin" /> : <ThumbsUp size={10} />} AI is right
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => { setOpenEditor(editorKey); setDraftStatus(null); setDraftNote(param.reviewer_note || ''); }}
                                        className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-[9px] font-black uppercase tracking-wider hover:bg-rose-100 disabled:opacity-40 cursor-pointer"
                                    >
                                        <ThumbsDown size={10} /> AI is wrong
                                    </button>
                                </div>
                            )}

                            {canReview && isEditing && (
                                <div className="mt-2 p-2 rounded-lg bg-white border border-slate-200 space-y-2">
                                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-wider">This should be classified as</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {CORRECTION_OPTIONS.filter(o => o.value !== status).map(o => (
                                            <button
                                                key={o.value}
                                                type="button"
                                                onClick={() => setDraftStatus(o.value)}
                                                className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border cursor-pointer ${
                                                    draftStatus === o.value ? 'bg-primary text-white border-transparent' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                                }`}
                                            >
                                                {o.label}
                                            </button>
                                        ))}
                                    </div>
                                    <textarea
                                        value={draftNote}
                                        onChange={(e) => setDraftNote(e.target.value.slice(0, 500))}
                                        rows={2}
                                        placeholder='Tell the AI how to judge this next time, e.g. "Water marks on the tap count as Fail"'
                                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            disabled={!draftStatus || isSaving}
                                            onClick={() => submit(param, 'incorrect', draftStatus, draftNote)}
                                            className="flex items-center gap-1 px-3 py-1 rounded-lg bg-primary text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-40 cursor-pointer"
                                        >
                                            {isSaving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save correction
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setOpenEditor(null); setDraftStatus(null); setDraftNote(''); }}
                                            className="px-3 py-1 rounded-lg text-slate-500 text-[9px] font-black uppercase tracking-wider hover:bg-slate-100 cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* AI Defect Marks Photo Preview Modal with Multi-Angle support */}
            {(() => {
                const angleTabs = allPhotos.map((p) => {
                    const safeUrl = maskStorageUrl(p.url) || p.url;
                    const key = `${safeUrl}:${activeParam?.name}`;
                    const cached = defectCache[key];
                    return {
                        index: p.index,
                        label: p.label,
                        url: p.url,
                        boxCount: cached ? cached.length : undefined,
                        hasMarks: Boolean(cached && cached.length > 0),
                    };
                });

                return (
                    <ImagePreviewModal
                        isOpen={Boolean(previewPhotoUrl)}
                        onClose={() => {
                            setPreviewPhotoUrl(null);
                            setDefectBoxes([]);
                            setIsLoadingBoxes(false);
                            setActiveBoxLabel(undefined);
                            setActiveParam(null);
                        }}
                        imageUrl={maskStorageUrl(previewPhotoUrl) || ''}
                        title={previewTitle}
                        boxes={defectBoxes}
                        isLoadingBoxes={isLoadingBoxes}
                        activeBoxLabel={activeBoxLabel}
                        angles={angleTabs}
                        activeAngleIndex={activeAngleIndex}
                        onSelectAngle={handleSwitchAngle}
                    />
                );
            })()}
        </div>
    );
};

export default SOPAIParameterReview;
