"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Building2, Users, User, Award, Info } from 'lucide-react';

export interface ProgressMetric {
    percentage: number;
    completed: number;
    total: number;
    label: string;
    sublabel?: string;
}

export interface TaskProgressGaugeProps {
    orgProgress: ProgressMetric;
    deptProgress: ProgressMetric;
    employeeProgress: ProgressMetric;
    className?: string;
    active?: boolean;
    isReportingManager?: boolean;
    departmentName?: string;
}

// Internal easeOut count-up for gauge center readout
function useGaugeCountUp(target: number, active: boolean): number {
    const [val, setVal] = useState(0);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        if (!active) {
            setVal(0);
            return;
        }
        const start = performance.now();
        const duration = 1800;
        const tick = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setVal(Math.round(target * eased));
            if (progress < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                setVal(target);
            }
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [target, active]);

    return val;
}

type ArcLevel = 'org' | 'dept' | 'employee';

export default function TaskProgressGauge({
    orgProgress,
    deptProgress,
    employeeProgress,
    className = '',
    active = true,
    isReportingManager = false,
    departmentName = ''
}: TaskProgressGaugeProps) {
    const [hoveredLevel, setHoveredLevel] = useState<ArcLevel | null>(null);

    // Ensure display name includes " Department" (e.g. "Tech Department")
    const displayDeptName = departmentName
        ? (departmentName.toLowerCase().endsWith('department') ? departmentName : `${departmentName} Department`)
        : 'Department';

    // SVG Coordinate Space Constants (Ultra-compact)
    const VB_W = 400;
    const VB_H = 180;
    const CX = 200;
    const CY = 155;

    // Concentric Radii:
    // 3-arc mode (Superuser): Outer = Org (126), Middle = Dept (98), Inner = Emp (70)
    // 2-arc mode (Reporting Manager): Outer = Dept (118), Inner = Emp (84)
    const R_ORG = 126;
    const R_DEPT = isReportingManager ? 118 : 98;
    const R_EMP = isReportingManager ? 84 : 70;
    const STROKE_WIDTH = 10;
    const OUTER_R = isReportingManager ? R_DEPT : R_ORG;

    // Helper: Calculate Semi-Circular Arc Path & Circumference
    const getArcGeometry = (radius: number, pct: number) => {
        const circumference = Math.PI * radius;
        const clampedPct = Math.max(0, Math.min(100, isNaN(pct) ? 0 : pct));
        const strokeDashoffset = circumference - (clampedPct / 100) * circumference;
        const pathData = `M ${CX - radius} ${CY} A ${radius} ${radius} 0 0 1 ${CX + radius} ${CY}`;
        return { circumference, strokeDashoffset, pathData, clampedPct };
    };

    const orgGeom = getArcGeometry(R_ORG, orgProgress.percentage);
    const deptGeom = getArcGeometry(R_DEPT, deptProgress.percentage);
    const empGeom = getArcGeometry(R_EMP, employeeProgress.percentage);

    // Active focused metric (defaults to Dept for Reporting Manager, Org for Superuser)
    const defaultLevel: ArcLevel = isReportingManager ? 'dept' : 'org';
    const activeLevel: ArcLevel = hoveredLevel || defaultLevel;
    const activeMetric =
        activeLevel === 'employee' ? employeeProgress :
            (activeLevel === 'dept' || isReportingManager) ? deptProgress : orgProgress;

    const activeColor =
        activeLevel === 'employee' ? '#F59E0B' :
            (activeLevel === 'dept' || isReportingManager) ? '#10B981' : '#6366F1';

    const gaugePercentDisplay = useGaugeCountUp(Math.round(activeMetric.percentage), active);

    // Polar coordinates for tick marks
    const polarToCartesian = (radius: number, angleDegrees: number) => {
        const rad = (angleDegrees * Math.PI) / 180;
        return {
            x: CX + radius * Math.cos(rad),
            y: CY - radius * Math.sin(rad)
        };
    };

    return (
        <div
            className={`w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2.5 sm:p-3 shadow-xs ${active
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 -translate-x-24 pointer-events-none'
                } ${className}`}
            style={{
                transition: 'transform 1800ms cubic-bezier(0.16, 1, 0.3, 1), opacity 1500ms cubic-bezier(0.16, 1, 0.3, 1)',
                willChange: 'transform, opacity'
            }}
        >
            {/* Header / Title */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2 mb-0.5 border-b border-zinc-100 dark:border-zinc-800/80">
                <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500/10 via-emerald-500/10 to-amber-500/10 border border-indigo-200 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                        <Award className="w-3.5 h-3.5" />
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                            Progress Hierarchy Meter
                            <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded-full border ${isReportingManager
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900'
                                : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-100 dark:border-indigo-900'
                                }`}>
                                {isReportingManager ? '2-Tier Dynamic' : '3-Tier Dynamic'}
                            </span>
                        </h3>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            {isReportingManager
                                ? `${displayDeptName} (Outer) · Staff (Inner)`
                                : 'Organisation (Outer) · Department (Middle) · Staff (Inner)'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                    <Info className="w-3 h-3 text-zinc-400" />
                    <span className="hidden sm:inline">Hover arcs to inspect</span>
                </div>
            </div>

            {/* Gauge SVG Container */}
            <div className="relative w-full max-w-[280px] mx-auto select-none">
                <svg
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-auto overflow-visible"
                    role="img"
                    aria-label={`Task Progress Gauge: Org ${orgProgress.percentage}%, Dept ${deptProgress.percentage}%, Employee ${employeeProgress.percentage}%`}
                >
                    <defs>
                        {/* Outer Arc (Organisation) Gradient */}
                        <linearGradient id="org-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#818CF8" />
                            <stop offset="50%" stopColor="#6366F1" />
                            <stop offset="100%" stopColor="#4F46E5" />
                        </linearGradient>

                        {/* Middle Arc (Department) Gradient */}
                        <linearGradient id="dept-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#34D399" />
                            <stop offset="50%" stopColor="#10B981" />
                            <stop offset="100%" stopColor="#059669" />
                        </linearGradient>

                        {/* Inner Arc (Employee) Gradient */}
                        <linearGradient id="emp-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#FBBF24" />
                            <stop offset="50%" stopColor="#F59E0B" />
                            <stop offset="100%" stopColor="#EA580C" />
                        </linearGradient>

                        {/* Drop Glow Filter for Active Arc */}
                        <filter id="gauge-glow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="2.5" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Scale Bezel / Precision Ticks (Outer Boundary) */}
                    <g opacity="0.45" className="transition-opacity">
                        {Array.from({ length: 21 }, (_, i) => {
                            const pct = i * 5;
                            const isMajor = pct % 25 === 0;
                            const angle = 180 - (pct / 100) * 180;
                            const rIn = OUTER_R + STROKE_WIDTH / 2 + 5;
                            const rOut = rIn + (isMajor ? 7 : 4);
                            const p1 = polarToCartesian(rIn, angle);
                            const p2 = polarToCartesian(rOut, angle);
                            return (
                                <line
                                    key={pct}
                                    x1={p1.x}
                                    y1={p1.y}
                                    x2={p2.x}
                                    y2={p2.y}
                                    stroke="currentColor"
                                    strokeWidth={isMajor ? 1.5 : 1}
                                    strokeLinecap="round"
                                    className="text-zinc-400 dark:text-zinc-600"
                                />
                            );
                        })}
                    </g>

                    {/* Scale Label Numbers: 0%, 50%, 100% */}
                    <g className="text-zinc-400 dark:text-zinc-500 text-[9px] font-semibold select-none">
                        {/* 0% Left */}
                        <text
                            x={CX - OUTER_R - STROKE_WIDTH / 2 - 2}
                            y={CY + 13}
                            textAnchor="middle"
                            fill="currentColor"
                        >
                            0%
                        </text>
                        {/* 50% Center Top */}
                        <text
                            x={CX}
                            y={CY - OUTER_R - STROKE_WIDTH / 2 - 8}
                            textAnchor="middle"
                            fill="currentColor"
                        >
                            50%
                        </text>
                        {/* 100% Right */}
                        <text
                            x={CX + OUTER_R + STROKE_WIDTH / 2 + 2}
                            y={CY + 13}
                            textAnchor="middle"
                            fill="currentColor"
                        >
                            100%
                        </text>
                    </g>

                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* CONCENTRIC PROGRESS ARCS */}
                    {/* ───────────────────────────────────────────────────────────── */}
                    {[
                        ...(!isReportingManager ? [{
                            level: 'org' as const,
                            geom: orgGeom,
                            gradientId: 'org-gradient',
                            delay: '150ms'
                        }] : []),
                        {
                            level: 'dept' as const,
                            geom: deptGeom,
                            gradientId: 'dept-gradient',
                            delay: '350ms'
                        },
                        {
                            level: 'employee' as const,
                            geom: empGeom,
                            gradientId: 'emp-gradient',
                            delay: '550ms'
                        }
                    ].map(arc => (
                        <g
                            key={arc.level}
                            className="transition-all duration-300 cursor-pointer"
                            opacity={hoveredLevel && hoveredLevel !== arc.level ? 0.35 : 1}
                            onMouseEnter={() => setHoveredLevel(arc.level)}
                            onMouseLeave={() => setHoveredLevel(null)}
                        >
                            {/* Track Background */}
                            <path
                                d={arc.geom.pathData}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={STROKE_WIDTH}
                                strokeLinecap="round"
                                className="text-zinc-100 dark:text-zinc-800/80"
                            />
                            {/* Progress Fill (Left -> Right) */}
                            <path
                                d={arc.geom.pathData}
                                fill="none"
                                stroke={`url(#${arc.gradientId})`}
                                strokeWidth={hoveredLevel === arc.level ? STROKE_WIDTH + 2 : STROKE_WIDTH}
                                strokeLinecap="round"
                                strokeDasharray={arc.geom.circumference}
                                strokeDashoffset={active ? arc.geom.strokeDashoffset : arc.geom.circumference}
                                filter={hoveredLevel === arc.level ? 'url(#gauge-glow)' : undefined}
                                style={{ transition: `stroke-dashoffset 1800ms cubic-bezier(0.16, 1, 0.3, 1) ${arc.delay}, stroke-width 200ms ease` }}
                            />
                        </g>
                    ))}

                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* CENTER READOUT DISPLAY */}
                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* Baseline Horizontal Decorative Divider */}
                    <line
                        x1={CX - 40}
                        y1={CY + 3}
                        x2={CX + 40}
                        y2={CY + 3}
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                        className="text-zinc-200 dark:text-zinc-800"
                    />

                    {/* Center Percentage Display */}
                    <text
                        x={CX}
                        y={CY - 40}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="font-black text-2xl sm:text-3xl tracking-tight transition-colors duration-300 fill-zinc-900 dark:fill-zinc-50"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                        {gaugePercentDisplay}%
                    </text>

                    {/* Center Level Title / Scope Label */}
                    <text
                        x={CX}
                        y={CY - 22}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="text-[9px] font-bold uppercase tracking-wider transition-colors duration-300"
                        fill={activeColor}
                    >
                        {isReportingManager && activeLevel === 'dept'
                            ? `${displayDeptName.replace(/\s*progress$/i, '').toUpperCase()} PROGRESS`
                            : activeMetric.label}
                    </text>

                    {/* Center Task Count Pill Box */}
                    <g transform={`translate(${CX - 42}, ${CY - 13})`}>
                        <rect
                            x="0"
                            y="0"
                            width="84"
                            height="15"
                            rx="7.5"
                            className="fill-zinc-100 dark:fill-zinc-800/90 stroke-zinc-200 dark:stroke-zinc-700/60"
                            strokeWidth="1"
                        />
                        <text
                            x="42"
                            y="8"
                            textAnchor="middle"
                            dominantBaseline="central"
                            className="text-[8px] font-bold fill-zinc-700 dark:fill-zinc-300"
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                            {activeMetric.completed} / {activeMetric.total} tasks
                        </text>
                    </g>
                </svg>
            </div>

            {/* ── Interactive Level Legend Cards ─────────────────────────────── */}
            <div className={`grid grid-cols-1 ${isReportingManager ? 'sm:grid-cols-2' : 'md:grid-cols-3'} gap-1.5 pt-2 mt-0.5 border-t border-zinc-100 dark:border-zinc-800/80`}>
                {[
                    ...(!isReportingManager ? [{
                        level: 'org' as const,
                        icon: <Building2 className="w-3 h-3" />,
                        title: 'Organisation',
                        subtitle: `Outer Arc · ${orgProgress.sublabel || 'Company'}`,
                        metric: orgProgress,
                        colorClass: 'text-indigo-600 dark:text-indigo-400',
                        dotClass: 'bg-indigo-500',
                        activeBg: 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-500/20',
                        iconBox: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
                        delay: '150ms'
                    }] : []),
                    {
                        level: 'dept' as const,
                        icon: <Users className="w-3 h-3" />,
                        title: displayDeptName,
                        subtitle: `${isReportingManager ? 'Outer Arc' : 'Middle Arc'} · ${deptProgress.sublabel || deptProgress.label}`,
                        metric: deptProgress,
                        colorClass: 'text-emerald-600 dark:text-emerald-400',
                        dotClass: 'bg-emerald-500',
                        activeBg: 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 ring-1 ring-emerald-500/20',
                        iconBox: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                        delay: isReportingManager ? '150ms' : '300ms'
                    },
                    {
                        level: 'employee' as const,
                        icon: <User className="w-3 h-3" />,
                        title: 'Employee',
                        subtitle: `Inner Arc · ${employeeProgress.sublabel || employeeProgress.label}`,
                        metric: employeeProgress,
                        colorClass: 'text-amber-600 dark:text-amber-400',
                        dotClass: 'bg-amber-500',
                        activeBg: 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 ring-1 ring-amber-500/20',
                        iconBox: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                        delay: isReportingManager ? '300ms' : '450ms'
                    }
                ].map(c => (
                    <div
                        key={c.level}
                        onMouseEnter={() => setHoveredLevel(c.level)}
                        onMouseLeave={() => setHoveredLevel(null)}
                        style={{ transitionDelay: c.delay }}
                        className={`p-1.5 sm:p-2 rounded-lg border transition-all duration-500 cursor-pointer flex items-center justify-between gap-2 ${activeLevel === c.level
                            ? `${c.activeBg} shadow-xs`
                            : 'bg-zinc-50/60 dark:bg-zinc-800/40 border-zinc-200/80 dark:border-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600'
                            }`}
                    >
                        <div className="flex items-center gap-1.5 min-w-0">
                            <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${c.iconBox}`}>
                                {c.icon}
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dotClass}`} />
                                    <span className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                        {c.title}
                                    </span>
                                </div>
                                <div className="text-[9px] text-zinc-500 dark:text-zinc-400 truncate">
                                    {c.subtitle}
                                </div>
                            </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                            <div className={`text-xs sm:text-[13px] font-black ${c.colorClass}`}>
                                {c.metric.percentage}%
                            </div>
                            <div className="text-[8px] text-zinc-400 dark:text-zinc-500">
                                {c.metric.completed}/{c.metric.total}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
