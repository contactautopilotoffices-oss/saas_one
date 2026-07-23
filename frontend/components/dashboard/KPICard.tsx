'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';

interface KPICardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: LucideIcon;
    trend?: {
        value: string;
        direction: 'up' | 'down' | 'neutral';
    };
    neonAccent?: 'cyan' | 'magenta' | 'none';
    /** Soft status-tinted variant — adds colored background, border, and icon chip */
    statusColor?: 'hot' | 'warm' | 'cold' | 'lost' | 'won' | 'hold' | 'open' | 'progress' | 'overdue' | 'default';
    onClick?: () => void;
}

const STATUS_STYLE: Record<string, { bg: string; border: string; iconBg: string; icon: string; value: string; label: string }> = {
    hot:      { bg: 'bg-rose-50',    border: 'border-rose-200',    iconBg: 'bg-rose-100',    icon: 'text-rose-600',    value: 'text-rose-700',    label: 'text-rose-500' },
    warm:     { bg: 'bg-amber-50',   border: 'border-amber-200',   iconBg: 'bg-amber-100',   icon: 'text-amber-600',   value: 'text-amber-700',   label: 'text-amber-500' },
    cold:     { bg: 'bg-sky-50',     border: 'border-sky-200',     iconBg: 'bg-sky-100',     icon: 'text-sky-600',     value: 'text-sky-700',     label: 'text-sky-500' },
    lost:     { bg: 'bg-slate-100',  border: 'border-slate-200',  iconBg: 'bg-slate-200',   icon: 'text-slate-500',   value: 'text-slate-700',   label: 'text-slate-400' },
    won:      { bg: 'bg-emerald-50', border: 'border-emerald-200', iconBg: 'bg-emerald-100', icon: 'text-emerald-600', value: 'text-emerald-700', label: 'text-emerald-500' },
    hold:     { bg: 'bg-amber-50',   border: 'border-amber-200',   iconBg: 'bg-amber-100',   icon: 'text-amber-600',   value: 'text-amber-700',   label: 'text-amber-500' },
    open:     { bg: 'bg-blue-50',    border: 'border-blue-200',    iconBg: 'bg-blue-100',    icon: 'text-blue-600',    value: 'text-blue-700',    label: 'text-blue-500' },
    progress: { bg: 'bg-violet-50',  border: 'border-violet-200', iconBg: 'bg-violet-100',  icon: 'text-violet-600',  value: 'text-violet-700',  label: 'text-violet-500' },
    overdue:  { bg: 'bg-red-50',     border: 'border-red-200',    iconBg: 'bg-red-100',     icon: 'text-red-600',     value: 'text-red-700',     label: 'text-red-500' },
    default:  { bg: 'bg-slate-50',   border: 'border-slate-200',  iconBg: 'bg-slate-100',   icon: 'text-slate-500',   value: 'text-slate-700',   label: 'text-slate-400' },
};

export default function KPICard({
    title,
    value,
    subtitle,
    icon: Icon,
    trend,
    neonAccent = 'none',
    statusColor,
    onClick
}: KPICardProps) {
    const status = statusColor ? STATUS_STYLE[statusColor] : null;

    const getNeonBorderClass = () => {
        if (neonAccent === 'cyan') return 'border-l-4 border-l-[var(--neon-cyan)]';
        if (neonAccent === 'magenta') return 'border-l-4 border-l-[var(--neon-magenta)]';
        return '';
    };

    const getNeonTextClass = () => {
        if (neonAccent === 'cyan') return 'neon-cyan';
        if (neonAccent === 'magenta') return 'neon-magenta';
        return status ? status.value : 'text-text-primary';
    };

    const getTrendColor = () => {
        if (trend?.direction === 'up') return 'text-success bg-success/10 border-success/20';
        if (trend?.direction === 'down') return 'text-error bg-error/10 border-error/20';
        return 'text-text-tertiary bg-surface-elevated/50 border-border';
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0.0, 0.2, 1] }}
            className={`kpi-card h-full flex flex-col justify-between cursor-pointer rounded-2xl border ${getNeonBorderClass()} ${status ? `${status.bg} ${status.border}` : 'bg-white border-border'}`}
            onClick={onClick}
        >
            {/* Header */}
            <div className="flex items-start justify-between mb-6 p-4 pb-0">
                <div className="flex-1">
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${status ? status.label : 'text-text-tertiary'}`}>
                        {title}
                    </p>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-4xl metric-number tracking-tight font-black ${getNeonTextClass()}`}>
                            {value}
                        </span>
                        {trend && (
                            <span className={`text-xs font-semibold px-2 py-1 rounded-[var(--radius-sm)] border font-body ${getTrendColor()}`}>
                                {trend.direction === 'up' && '↑'}
                                {trend.direction === 'down' && '↓'}
                                {trend.direction === 'neutral' && '→'}
                                {' '}{trend.value}
                            </span>
                        )}
                    </div>
                </div>
                <div className={`w-10 h-10 kpi-icon flex items-center justify-center flex-shrink-0 rounded-xl ${status ? status.iconBg : 'bg-slate-100'}`}>
                    <Icon className={`w-5 h-5 ${status ? status.icon : 'text-text-secondary'}`} />
                </div>
            </div>

            {/* Subtitle */}
            {subtitle && (
                <p className={`text-sm font-body pt-3 px-4 pb-4 mt-3 border-t ${status ? 'border-' + status.border.split('-')[1] + '-200' : 'border-border/50'} ${status ? status.label : 'text-text-tertiary'}`}>
                    {subtitle}
                </p>
            )}
        </motion.div>
    );
}
