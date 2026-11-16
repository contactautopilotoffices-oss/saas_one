'use client';

import React, { useState, useRef, useMemo } from 'react';
import { Layers, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaAuditScore } from './useCADReportData';

interface CADFloorPlanViewportProps {
    cadImageUrl?: string;
    areas: any[];
    areaAudits: AreaAuditScore[];
    selectedAreaId: string | null;
    onSelectArea: (areaId: string) => void;
    selectedFloor?: string;
    onSelectFloor?: (floor: string) => void;
    /** The property's pass mark, so the map bands match the scorer's verdict. */
    passThreshold?: number;
}

export const CADFloorPlanViewport: React.FC<CADFloorPlanViewportProps> = ({
    cadImageUrl,
    areas,
    areaAudits,
    selectedAreaId,
    onSelectArea,
    passThreshold = 70,
}) => {
    const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 4967, height: 3509 });
    const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // Map areaId -> Audit Score
    const auditMap = useMemo(() => {
        const map = new Map<string, AreaAuditScore>();
        areaAudits.forEach(a => map.set(a.areaId, a));
        return map;
    }, [areaAudits]);

    const handleImageLoad = () => {
        if (imageRef.current) {
            const w = imageRef.current.naturalWidth || 4967;
            const h = imageRef.current.naturalHeight || 3509;
            setImageSize({ width: w, height: h });
        }
    };

    // Color definitions based on real score
    const getAreaStyles = (audit?: AreaAuditScore) => {
        if (!audit || audit.score === null) {
            return {
                fill: 'rgba(148, 163, 184, 0.22)',
                stroke: '#94a3b8',
                badgeBg: '#94a3b8',
            };
        }
        if (audit.score >= 85) {
            return {
                fill: 'rgba(34, 197, 94, 0.38)',
                stroke: '#16a34a',
                badgeBg: '#16a34a',
            };
        }
        if (audit.score >= passThreshold) {
            return {
                fill: 'rgba(234, 179, 8, 0.38)',
                stroke: '#ca8a04',
                badgeBg: '#ca8a04',
            };
        }
        if (audit.score >= 50) {
            return {
                fill: 'rgba(249, 115, 22, 0.42)',
                stroke: '#ea580c',
                badgeBg: '#ea580c',
            };
        }
        return {
            fill: 'rgba(239, 68, 68, 0.45)',
            stroke: '#dc2626',
            badgeBg: '#dc2626',
        };
    };

    /** Centroid of an area in SVG units, used both for the map badge and to anchor the tooltip. */
    const centroidOf = (area: {
        points?: Array<{ x: number; y: number }>;
        coordinates?: { x: number; y: number; width: number; height: number };
    }) => {
        if (Array.isArray(area?.points) && area.points.length > 2) {
            const sumX = area.points.reduce((acc: number, p: { x: number }) => acc + p.x, 0);
            const sumY = area.points.reduce((acc: number, p: { y: number }) => acc + p.y, 0);
            return { x: Math.round(sumX / area.points.length), y: Math.round(sumY / area.points.length) };
        }
        return {
            x: (area?.coordinates?.x || 0) + (area?.coordinates?.width || 0) / 2,
            y: (area?.coordinates?.y || 0) + (area?.coordinates?.height || 0) / 2,
        };
    };

    /**
     * The hover card follows the pointer's area and disappears when the pointer leaves.
     * It used to fall back to the selected area and sit in a fixed top-left box, so it stayed on
     * screen covering the plan and swapped content every time the pointer crossed a room.
     */
    const hoverTarget = useMemo(() => {
        if (!hoveredAreaId) return null;
        const area = areas.find(a => a.id === hoveredAreaId) || null;
        if (!area) return null;
        const c = centroidOf(area);
        return {
            area,
            audit: auditMap.get(area.id) || null,
            // Percentages of the image box, so the card tracks the plan at any render size.
            leftPct: imageSize.width ? (c.x / imageSize.width) * 100 : 50,
            topPct: imageSize.height ? (c.y / imageSize.height) * 100 : 50,
        };
    }, [hoveredAreaId, areas, auditMap, imageSize]);

    return (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs flex flex-col h-full min-h-[620px] lg:h-[660px] relative">
            {/* Top Toolbar: View Mode Tabs & Score Legend */}
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-white z-20 flex-shrink-0">
                {/* Floor Plan Header Badge */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-black shadow-xs">
                        <Layers size={13} />
                        <span>Floor Plan</span>
                    </div>
                    <span className="text-[11px] font-bold text-slate-400">
                        {areas.length} {areas.length === 1 ? 'Area' : 'Areas'} Mapped
                    </span>
                </div>

                {/* Cleanliness Score Legend */}
                <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-[10px] font-bold">
                    <span className="text-slate-400 font-black uppercase tracking-wider text-[9px]">Cleanliness Score:</span>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        <span className="text-slate-700">85–100 Excellent</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                        <span className="text-slate-700">{passThreshold}–84 Good</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        <span className="text-slate-700">50–{passThreshold - 1} Attention</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                        <span className="text-slate-700">0–49 Poor</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                        <span className="text-slate-500">Uninspected</span>
                    </div>
                </div>
            </div>

            {/* Main Stable CAD Blueprint Canvas (Direct in place, no zoom-in/zoom-out, no floor strip) */}
            <div className="flex-1 relative overflow-hidden bg-slate-100/70 flex items-center justify-center p-3 select-none">
                <div className="relative w-full h-full flex items-center justify-center">
                    {/* CAD Base Blueprint Image */}
                    {cadImageUrl ? (
                        <div className="relative max-w-full max-h-full flex items-center justify-center">
                            <img
                                ref={imageRef}
                                src={cadImageUrl}
                                alt="CAD Floor Plan"
                                onLoad={handleImageLoad}
                                draggable={false}
                                className="w-auto h-auto max-h-[580px] max-w-full select-none rounded-lg block shadow-sm pointer-events-none transition-filter object-contain"
                            />

                            {/* Interactive SVG Polygons Overlay directly mapped over the CAD image */}
                            {imageSize.width > 0 && (
                                <svg
                                    className="absolute inset-0 w-full h-full pointer-events-auto"
                                    viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                                    preserveAspectRatio="none"
                                >
                                    {areas.map(area => {
                                        const audit = auditMap.get(area.id);
                                        const isSelected = selectedAreaId === area.id;
                                        const isHovered = hoveredAreaId === area.id;
                                        const hasPolygon = Array.isArray(area.points) && area.points.length > 2;
                                        const styles = getAreaStyles(audit);

                                        const centroid = centroidOf(area);
                                        const badgeX = centroid.x;
                                        const badgeY = centroid.y;
                                        const scoreLabel = audit?.score !== null && audit?.score !== undefined
                                            ? String(audit.score)
                                            : '—';

                                        return (
                                            <g
                                                key={area.id}
                                                className="cursor-pointer focus:outline-none"
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`${area.label}. ${
                                                    audit?.score !== null && audit?.score !== undefined
                                                        ? `Score ${audit.score} out of 100`
                                                        : 'Not evaluated'
                                                }. Press Enter to inspect.`}
                                                onClick={() => onSelectArea(area.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        onSelectArea(area.id);
                                                    }
                                                }}
                                                onFocus={() => setHoveredAreaId(area.id)}
                                                onBlur={() => setHoveredAreaId(null)}
                                                onMouseEnter={() => setHoveredAreaId(area.id)}
                                                onMouseLeave={() => setHoveredAreaId(null)}
                                            >
                                                {hasPolygon && area.points ? (
                                                    <polygon
                                                        points={area.points.map((p: any) => `${p.x},${p.y}`).join(' ')}
                                                        fill={isHovered ? 'rgba(2, 132, 199, 0.35)' : styles.fill}
                                                        stroke={isSelected || isHovered ? '#0284c7' : styles.stroke}
                                                        strokeWidth={isSelected || isHovered ? 8 : 4}
                                                        strokeLinejoin="round"
                                                        className="transition-all"
                                                    />
                                                ) : area.coordinates ? (
                                                    <rect
                                                        x={area.coordinates.x}
                                                        y={area.coordinates.y}
                                                        width={area.coordinates.width}
                                                        height={area.coordinates.height}
                                                        fill={isHovered ? 'rgba(2, 132, 199, 0.35)' : styles.fill}
                                                        stroke={isSelected || isHovered ? '#0284c7' : styles.stroke}
                                                        strokeWidth={isSelected || isHovered ? 8 : 4}
                                                        rx={6}
                                                        className="transition-all"
                                                    />
                                                ) : null}

                                                {/* Center Status Badge */}
                                                {badgeX > 0 && badgeY > 0 && (
                                                    <g transform={`translate(${badgeX}, ${badgeY})`}>
                                                        {/* The score itself, not a ✓ / ! glyph: the number
                                                            is the thing people are scanning the plan for. */}
                                                        <circle
                                                            r={imageSize.width / (isSelected || isHovered ? 100 : 112)}
                                                            fill={styles.badgeBg}
                                                            stroke="#ffffff"
                                                            strokeWidth={imageSize.width / 700}
                                                            className="transition-all"
                                                        />
                                                        <text
                                                            textAnchor="middle"
                                                            dy=".35em"
                                                            fill="#ffffff"
                                                            fontSize={imageSize.width / 150}
                                                            fontWeight="900"
                                                            className="pointer-events-none select-none"
                                                        >
                                                            {scoreLabel}
                                                        </text>
                                                    </g>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                            )}

                            {/* Hover card, anchored beside the area under the pointer and flipped to stay
                                inside the viewport. Pointer-events are off so it can never steal the hover
                                from the plan underneath it — click the area to open the full inspector. */}
                            <AnimatePresence>
                                {hoverTarget && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.96 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.96 }}
                                        transition={{ duration: 0.12 }}
                                        style={{
                                            left: `${hoverTarget.leftPct}%`,
                                            top: `${hoverTarget.topPct}%`,
                                            transform: `translate(${hoverTarget.leftPct > 55 ? 'calc(-100% - 14px)' : '14px'}, ${hoverTarget.topPct > 60 ? 'calc(-100% - 14px)' : '14px'})`,
                                        }}
                                        className="absolute z-30 w-60 bg-white/98 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl p-3 space-y-2 pointer-events-none"
                                    >
                                        {/* Identify the area and give its headline verdict. Anything that needs
                                            reading time — photos, every parameter — belongs in the inspector,
                                            which a click away keeps open while the pointer moves. */}
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <h3 className="font-black text-sm text-slate-900 leading-tight truncate">
                                                    {hoverTarget.area.label}
                                                </h3>
                                                <span className="text-[10px] font-bold text-slate-400">
                                                    {hoverTarget.audit?.category || 'Area'}
                                                </span>
                                            </div>
                                            <div className={`px-2 py-0.5 rounded-lg text-xs font-black shadow-2xs flex-shrink-0 ${
                                                hoverTarget.audit?.score === null || hoverTarget.audit?.score === undefined
                                                    ? 'bg-slate-200 text-slate-600'
                                                    : hoverTarget.audit.score >= 85 ? 'bg-emerald-500 text-white'
                                                    : hoverTarget.audit.score >= passThreshold ? 'bg-yellow-500 text-white'
                                                    : hoverTarget.audit.score >= 50 ? 'bg-amber-500 text-white'
                                                    : 'bg-rose-500 text-white'
                                            }`}>
                                                {hoverTarget.audit?.score ?? '—'}
                                            </div>
                                        </div>

                                        {hoverTarget.audit?.score === null || hoverTarget.audit?.score === undefined ? (
                                            <p className="text-[10px] font-semibold text-slate-400 leading-snug">
                                                Not evaluated in this period.
                                            </p>
                                        ) : (
                                            <div className="flex flex-wrap items-center gap-1">
                                                {hoverTarget.audit.needsReview && (
                                                    <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[9px] font-black uppercase tracking-wider">
                                                        Needs review
                                                    </span>
                                                )}
                                                {hoverTarget.audit.antiSpoofing?.status === 'fail' && (
                                                    <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[9px] font-black uppercase tracking-wider">
                                                        Photo integrity failed
                                                    </span>
                                                )}
                                                {(() => {
                                                    const failed = (hoverTarget.audit.parameters || []).filter(p => p.status === 'fail').length;
                                                    const unseen = (hoverTarget.audit.parameters || []).filter(p => p.status === 'not_visible' || p.status === 'not_in_frame').length;
                                                    if (failed === 0 && unseen === 0) {
                                                        return (
                                                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wider">
                                                                All parameters passed
                                                            </span>
                                                        );
                                                    }
                                                    return (
                                                        <>
                                                            {failed > 0 && (
                                                                <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[9px] font-black uppercase tracking-wider">
                                                                    {failed} failed
                                                                </span>
                                                            )}
                                                            {unseen > 0 && (
                                                                <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[9px] font-black uppercase tracking-wider">
                                                                    {unseen} not visible
                                                                </span>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        <div className="pt-1 border-t border-slate-100 flex items-center gap-1 text-[10px] font-bold text-slate-400">
                                            <span>Click to inspect photos & AI analysis</span>
                                            <ChevronRight size={11} />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ) : (
                        <div className="w-[700px] h-[480px] bg-white flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-300 rounded-2xl shadow-sm">
                            <Layers size={36} className="opacity-30 mb-2" />
                            <p className="text-xs font-bold text-slate-600">CAD Floor Plan Loading...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
