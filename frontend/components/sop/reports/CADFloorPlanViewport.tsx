'use client';

import React, { useState, useRef, useMemo } from 'react';
import { 
    Layers, 
    ChevronRight, 
    Check,
    X,
    Camera
} from 'lucide-react';
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
}

export const CADFloorPlanViewport: React.FC<CADFloorPlanViewportProps> = ({
    cadImageUrl,
    areas,
    areaAudits,
    selectedAreaId,
    onSelectArea,
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
                icon: '—',
            };
        }
        if (audit.score >= 85) {
            return {
                fill: 'rgba(34, 197, 94, 0.38)',
                stroke: '#16a34a',
                badgeBg: '#16a34a',
                icon: '✓',
            };
        }
        if (audit.score >= 70) {
            return {
                fill: 'rgba(234, 179, 8, 0.38)',
                stroke: '#ca8a04',
                badgeBg: '#ca8a04',
                icon: '!',
            };
        }
        if (audit.score >= 50) {
            return {
                fill: 'rgba(249, 115, 22, 0.42)',
                stroke: '#ea580c',
                badgeBg: '#ea580c',
                icon: '!',
            };
        }
        return {
            fill: 'rgba(239, 68, 68, 0.45)',
            stroke: '#dc2626',
            badgeBg: '#dc2626',
            icon: '!',
        };
    };

    // Active popover area - appears on hovering over an area in the CAD map
    const activePopoverArea = useMemo(() => {
        const targetId = hoveredAreaId || selectedAreaId;
        if (!targetId) return null;
        const area = areas.find(a => a.id === targetId) || null;
        if (!area) return null;
        const audit = auditMap.get(area.id) || null;
        return { area, audit };
    }, [hoveredAreaId, selectedAreaId, areas, auditMap]);

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
                        <span className="text-slate-700">70–84 Good</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        <span className="text-slate-700">50–69 Attention</span>
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

                                        let badgeX = area.coordinates?.x + (area.coordinates?.width || 0) / 2;
                                        let badgeY = area.coordinates?.y + (area.coordinates?.height || 0) / 2;
                                        if (hasPolygon && area.points) {
                                            const sumX = area.points.reduce((acc: number, p: any) => acc + p.x, 0);
                                            const sumY = area.points.reduce((acc: number, p: any) => acc + p.y, 0);
                                            badgeX = Math.round(sumX / area.points.length);
                                            badgeY = Math.round(sumY / area.points.length);
                                        }

                                        return (
                                            <g
                                                key={area.id}
                                                className="cursor-pointer"
                                                onClick={() => onSelectArea(area.id)}
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
                                                        <circle
                                                            r={imageSize.width / 130}
                                                            fill={styles.badgeBg}
                                                            className="shadow-md"
                                                        />
                                                        <text
                                                            textAnchor="middle"
                                                            dy=".35em"
                                                            fill="#ffffff"
                                                            fontSize={imageSize.width / 200}
                                                            fontWeight="900"
                                                        >
                                                            {styles.icon}
                                                        </text>
                                                    </g>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                            )}
                        </div>
                    ) : (
                        <div className="w-[700px] h-[480px] bg-white flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-300 rounded-2xl shadow-sm">
                            <Layers size={36} className="opacity-30 mb-2" />
                            <p className="text-xs font-bold text-slate-600">CAD Floor Plan Loading...</p>
                        </div>
                    )}

                    {/* Interactive Area Details Box appearing on Hover */}
                    <AnimatePresence>
                        {activePopoverArea && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -6 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -6 }}
                                transition={{ duration: 0.15 }}
                                className="absolute top-4 left-4 z-30 w-72 sm:w-80 bg-white/98 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl p-3.5 space-y-2.5 pointer-events-auto"
                            >
                                {/* Header: Area Name + Real Score Badge */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-black text-sm text-slate-900 leading-tight">
                                            {activePopoverArea.area.label}
                                        </h3>
                                        <span className="text-[10px] font-bold text-slate-400">
                                            {activePopoverArea.audit?.category || 'Office Zone'}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        <div className={`px-2 py-0.5 rounded-lg text-xs font-black text-white shadow-2xs ${
                                            (activePopoverArea.audit?.score || 0) >= 85 ? 'bg-emerald-500' :
                                            (activePopoverArea.audit?.score || 0) >= 70 ? 'bg-yellow-500' :
                                            (activePopoverArea.audit?.score || 0) >= 50 ? 'bg-amber-500' :
                                            activePopoverArea.audit?.score !== null ? 'bg-rose-500' : 'bg-slate-400'
                                        }`}>
                                            {activePopoverArea.audit?.score !== null ? activePopoverArea.audit?.score : 'Pending'}
                                        </div>
                                    </div>
                                </div>

                                {/* Preview Photo of the Room from Database */}
                                <div className="w-full h-28 rounded-xl overflow-hidden bg-slate-900 border border-slate-200 shadow-2xs relative">
                                    {(activePopoverArea.audit?.previewPhoto || activePopoverArea.audit?.benchmarkPhoto) ? (
                                        <img
                                            src={activePopoverArea.audit.previewPhoto || activePopoverArea.audit.benchmarkPhoto}
                                            alt={activePopoverArea.area.label}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                                            <Camera size={20} className="opacity-40 mb-1" />
                                            <span>No photo uploaded</span>
                                        </div>
                                    )}
                                </div>

                                {/* Real Checkpoint Parameters from Database */}
                                <div className="space-y-1 pt-0.5 max-h-36 overflow-y-auto">
                                    {(activePopoverArea.audit?.parameters || []).slice(0, 5).map((param, pIdx) => {
                                        const pScore = param.score ?? activePopoverArea.audit?.score ?? null;
                                        const isPass = param.status === 'pass' || (pScore !== null && pScore >= 75);

                                        return (
                                            <div key={pIdx} className="flex items-center justify-between text-xs font-bold">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] font-black ${
                                                        isPass ? 'bg-emerald-50 border border-emerald-500 text-emerald-700' : 'bg-rose-50 border border-rose-500 text-rose-700'
                                                    }`}>
                                                        {isPass ? '✓' : '!'}
                                                    </span>
                                                    <span className="text-slate-700 font-semibold truncate" title={param.name}>
                                                        {param.name}
                                                    </span>
                                                </div>
                                                <span className={`font-black flex-shrink-0 ${isPass ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {pScore !== null ? pScore : '—'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Action Link: View Details -> */}
                                <div className="pt-1 border-t border-slate-100 text-center">
                                    <button
                                        type="button"
                                        onClick={() => onSelectArea(activePopoverArea.area.id)}
                                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                                    >
                                        <span>View Details</span>
                                        <ChevronRight size={13} />
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};
