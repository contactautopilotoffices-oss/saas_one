'use client';

import React, { useMemo } from 'react';
import { widgetsForRole } from '@/frontend/lib/dashboard/registry';
import { useWidgetLayout } from '@/frontend/lib/dashboard/useWidgetLayout';
import { useAppSession } from '@/frontend/hooks/useAppSession';
import WidgetGrid from './WidgetGrid';

/**
 * The customizable operations board, ready to drop into any dashboard.
 *
 * Composes the registry (which widgets exist), the layout hook (where this user put them)
 * and the grid (how they are rendered and rearranged), so a host dashboard only has to
 * supply an org id and a role.
 *
 * Renders nothing when the role has no widgets, rather than an empty frame — a heading over
 * a blank area reads as a bug.
 */

interface Props {
    /** Falls back to the session's organisation when omitted. */
    orgId?: string | null;
    /** Falls back to the session role. Pass explicitly only to override. */
    role?: string | null;
}

export default function OpsBoard({ orgId: orgIdProp, role: roleProp }: Props) {
    const { session } = useAppSession();
    const orgId = orgIdProp || session?.org_id || null;
    const role = roleProp || session?.role || null;

    const widgets = useMemo(() => widgetsForRole(role), [role]);
    const { layout, setLayout, reset, recordUse, loaded } = useWidgetLayout(orgId, widgets);

    if (!orgId || widgets.length === 0) return null;

    if (!loaded) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-[104px]" aria-hidden="true">
                {[2, 1, 1, 2].map((span, i) => (
                    <div key={i}
                        className={`${span === 2 ? 'col-span-1 sm:col-span-2' : 'col-span-1'} row-span-1
                                    rounded-[20px] bg-muted/60 animate-pulse`} />
                ))}
            </div>
        );
    }

    return (
        <WidgetGrid
            orgId={orgId}
            widgets={widgets}
            layout={layout}
            onLayoutChange={setLayout}
            onResetLayout={reset}
            onWidgetUsed={recordUse}
        />
    );
}
