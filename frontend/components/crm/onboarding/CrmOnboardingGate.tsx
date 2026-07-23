'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { useCrmOnboarding, TOUR_ORDER, TOUR_LABELS, TourId } from '@/frontend/hooks/useCrmTour';
import { useAuth } from '@/frontend/context/AuthContext';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';

const TOUR_ROUTES: Record<TourId, string> = {
    'crm-dashboard': '/crm',
    'crm-leads': '/crm/leads',
    'crm-lead-detail': '/crm/leads',
    'crm-calendar': '/crm/calendar',
};

/**
 * The route each tour expects to mount on. If the user is already on the
 * route that hosts the next tour, we must release the gate immediately so the
 * underlying page can mount and auto-start its own tour. Otherwise the gate
 * would block the only place where the tour can actually run.
 */
function tourOwningRoute(tourId: TourId): string {
    return TOUR_ROUTES[tourId];
}

export default function CrmOnboardingGate({ children }: { children: React.ReactNode }) {
    const { isLoaded, allCompleted, completedCount, totalCount, nextTourId, completedTours } = useCrmOnboarding();
    const { user, membership } = useAuth();
    const router = useRouter();
    const params = useParams();
    const pathname = usePathname();
    const orgId = params.orgId as string;

    // If the user clicks "Start" while already on the route hosting the next
    // tour, the gate has nothing to navigate to. Mark the gate "released" so
    // we render the children — the destination page will auto-start its own
    // CrmTour. Reset on full resetAll().
    const [released, setReleased] = useState(false);
    useEffect(() => { setReleased(false); }, [completedCount === 0]);

    // BD Super Admins (CEO portal) skip the rep onboarding tour entirely — it
    // teaches the rep workflow, which is not their dashboard. (Placed after all
    // hooks to respect the Rules of Hooks.)
    if (isBdSuperAdmin(user?.email, membership?.org_role)) {
        return <>{children}</>;
    }

    if (!isLoaded) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Once any tour is done, free passage — the gate's job is to gate the
    // very first tour, not to babysit subsequent ones.
    if (allCompleted || completedCount > 0) return <>{children}</>;

    // The user is sitting on the route that hosts the next tour. Release the
    // gate so the underlying page can mount and auto-start its own tour.
    if (released && nextTourId) {
        const target = tourOwningRoute(nextTourId);
        if (pathname?.endsWith(target) || pathname === `/${orgId}${target}`) {
            return <>{children}</>;
        }
    }

    const progress = (completedCount / totalCount) * 100;

    // Helper: navigate to the next tour's route, releasing the gate if we
    // can't actually navigate (i.e. we're already on that route).
    const startNextTour = () => {
        if (!nextTourId) return;
        const target = `/${orgId}${tourOwningRoute(nextTourId)}`;
        const alreadyHere = pathname === target || pathname?.endsWith(tourOwningRoute(nextTourId));
        if (alreadyHere) {
            // Same-page mount: release the gate so children render, then
            // notify the page's tour to start immediately.
            setReleased(true);
            window.dispatchEvent(new CustomEvent('crm-tour-start', { detail: { tourId: nextTourId } }));
        } else {
            router.push(target);
        }
    };

    return (
        <div className="min-h-[80vh] flex items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="max-w-lg w-full"
            >
                <div className="text-center mb-8">
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', delay: 0.2, damping: 15 }}
                        className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"
                    >
                        <Sparkles className="w-8 h-8 text-primary" />
                    </motion.div>
                    <h1 className="text-2xl font-black text-slate-900 mb-2">
                        CRM Onboarding
                    </h1>
                    <p className="text-sm text-slate-500 max-w-sm mx-auto">
                        Complete all 4 guided tours to unlock the CRM. Each tour teaches you a core module — no physical training needed.
                    </p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
                    <div className="px-5 pt-5 pb-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                Progress
                            </span>
                            <span className="text-xs font-bold text-primary">
                                {completedCount} / {totalCount}
                            </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-primary rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' }}
                            />
                        </div>
                    </div>

                    <div className="p-3">
                        {TOUR_ORDER.map((tourId, idx) => {
                            const isComplete = completedTours.has(tourId);
                            const isNext = tourId === nextTourId;
                            const isLocked = !isComplete && !isNext;

                            return (
                                <motion.button
                                    key={tourId}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.1 * idx }}
                                    onClick={() => {
                                        if (isNext) startNextTour();
                                    }}
                                    disabled={isLocked || isComplete}
                                    className={`
                                        w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left
                                        ${isNext ? 'bg-primary/5 border border-primary/20 shadow-sm cursor-pointer hover:bg-primary/10' : ''}
                                        ${isComplete ? 'opacity-70' : ''}
                                        ${isLocked ? 'opacity-40 cursor-not-allowed' : ''}
                                    `}
                                >
                                    <div className="flex-shrink-0">
                                        {isComplete ? (
                                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                        ) : isLocked ? (
                                            <Lock className="w-5 h-5 text-slate-300" />
                                        ) : (
                                            <Circle className="w-5 h-5 text-primary" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-bold ${isComplete ? 'text-slate-400 line-through' : isNext ? 'text-slate-900' : 'text-slate-400'}`}>
                                            {idx + 1}. {TOUR_LABELS[tourId]}
                                        </p>
                                    </div>
                                    {isNext && (
                                        <ArrowRight className="w-4 h-4 text-primary flex-shrink-0" />
                                    )}
                                    {isComplete && (
                                        <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider flex-shrink-0">Done</span>
                                    )}
                                </motion.button>
                            );
                        })}
                    </div>
                </div>

                <AnimatePresence>
                    {nextTourId && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-6 text-center"
                        >
                            <button
                                onClick={startNextTour}
                                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20"
                            >
                                Start: {TOUR_LABELS[nextTourId]}
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}
