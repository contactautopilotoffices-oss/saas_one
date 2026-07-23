'use client';

import React from 'react';
import { motion } from 'framer-motion';
import type { TooltipRenderProps } from 'react-joyride';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';

export default function TourTooltip({
    index,
    step,
    size,
    backProps,
    closeProps,
    primaryProps,
    skipProps,
    tooltipProps,
    isLastStep,
}: TooltipRenderProps) {
    const progress = ((index + 1) / size) * 100;

    return (
        <motion.div
            {...tooltipProps}
            initial={{ opacity: 0, scale: 0.85, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full overflow-hidden"
            style={{ zIndex: 10001 }}
        >
            {/* Progress bar */}
            <div className="h-1 bg-slate-100">
                <motion.div
                    className="h-full bg-primary rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                />
            </div>

            <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Sparkles className="w-3.5 h-3.5 text-primary" />
                        </div>
                        {step.title && (
                            <h3 className="text-sm font-black text-slate-900">{step.title as string}</h3>
                        )}
                    </div>
                    <button
                        {...closeProps}
                        className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label="Close tour"
                    >
                        <X className="w-4 h-4 text-slate-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="text-sm text-slate-600 leading-relaxed mb-4">
                    {step.content}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {index + 1} of {size}
                    </span>

                    <div className="flex items-center gap-2">
                        {index > 0 && (
                            <button
                                {...backProps}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                <ChevronLeft className="w-3 h-3" />
                                Back
                            </button>
                        )}
                        <button
                            {...primaryProps}
                            className="flex items-center gap-1 px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20"
                        >
                            {isLastStep ? 'Got it!' : 'Next'}
                            {!isLastStep && <ChevronRight className="w-3 h-3" />}
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
