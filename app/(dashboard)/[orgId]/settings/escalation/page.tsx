import React from 'react';
import SpocMatrix from '@/frontend/components/workflow/SpocMatrix';

/**
 * Escalation SPOC matrix — who gets paged, per domain and escalation level.
 *
 * The component and its API (`/api/workflows/spoc`) have existed for a while but were
 * never mounted, so `workflow_spoc_rules` sits empty and `resolveSpoc()` has nothing to
 * resolve. That silently disables escalation everywhere it is consulted — including the
 * critical-PO path in the payment tracker, which looks like it is routing and is not.
 *
 * Org-wide matrix only. Per-property overrides are supported by the component via
 * `propertyId`, but there is no property picker here yet — one screen doing one thing.
 *
 * Next.js 16: params is a Promise and must be awaited.
 */

export const dynamic = 'force-dynamic';

export default async function EscalationSettingsPage({
    params,
}: {
    params: Promise<{ orgId: string }>;
}) {
    const { orgId } = await params;

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-4">
            <header>
                <h1 className="text-xl font-black text-text-primary">Escalation SPOCs</h1>
                <p className="text-xs font-semibold text-text-secondary mt-1 max-w-2xl">
                    Who gets notified when something is raised as critical, per domain and
                    escalation level. Until a rule exists here, escalation notifications have
                    nobody to route to and are silently dropped.
                </p>
            </header>

            <SpocMatrix organizationId={orgId} />
        </div>
    );
}
