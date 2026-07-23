'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Joyride, ACTIONS, EVENTS, STATUS } from 'react-joyride';
import type { EventData, Step, Controls } from 'react-joyride';
import { useCrmTour, TourId } from '@/frontend/hooks/useCrmTour';
import TourTooltip from './TourTooltip';

interface CrmTourProps {
    tourId: TourId;
    steps: Step[];
    delayMs?: number;
    onComplete?: () => void;
}

export default function CrmTour({ tourId, steps, delayMs = 800, onComplete }: CrmTourProps) {
    const { shouldAutoStart, markComplete } = useCrmTour(tourId);
    const [run, setRun] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);

    useEffect(() => {
        if (!shouldAutoStart) return;
        const t = setTimeout(() => setRun(true), delayMs);
        return () => clearTimeout(t);
    }, [shouldAutoStart, delayMs]);

    const finishTour = useCallback(() => {
        setRun(false);
        setStepIndex(0);
        markComplete();
        onComplete?.();
    }, [markComplete, onComplete]);

    const handleEvent = useCallback((data: EventData, controls: Controls) => {
        const { action, type, status, index } = data;

        if (type === EVENTS.STEP_AFTER) {
            if (action === ACTIONS.NEXT) {
                if (index >= steps.length - 1) {
                    finishTour();
                } else {
                    setStepIndex(i => i + 1);
                }
            }
            if (action === ACTIONS.PREV) setStepIndex(i => Math.max(0, i - 1));
        }

        if ((type as string) === 'error:target_not_found') {
            if (index >= steps.length - 1) {
                finishTour();
            } else {
                setStepIndex(i => i + 1);
            }
            return;
        }

        if (status === STATUS.FINISHED) {
            finishTour();
            return;
        }

        if (action === ACTIONS.CLOSE || status === STATUS.SKIPPED) {
            setRun(false);
            setStepIndex(0);
        }
    }, [markComplete, onComplete, steps.length, finishTour]);

    useEffect(() => {
        const handler = (e: CustomEvent) => {
            if (e.detail?.tourId === tourId) {
                setStepIndex(0);
                setRun(true);
            }
        };
        window.addEventListener('crm-tour-start' as any, handler);
        return () => window.removeEventListener('crm-tour-start' as any, handler);
    }, [tourId]);

    if (!steps.length) return null;

    return (
        <Joyride
            steps={steps}
            run={run}
            stepIndex={stepIndex}
            continuous
            scrollToFirstStep
            tooltipComponent={TourTooltip}
            styles={{
                overlay: { backgroundColor: 'rgba(15, 23, 42, 0.75)' },
            }}
            onEvent={handleEvent}
        />
    );
}

export function triggerTour(tourId: TourId) {
    window.dispatchEvent(new CustomEvent('crm-tour-start', { detail: { tourId } }));
}
