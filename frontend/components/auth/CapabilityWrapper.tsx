'use client';

import React, { useEffect, useState } from 'react';
import { CapabilityDomain, CapabilityAction, RequestContext } from '@/frontend/types/rbac';
import { authService } from '@/backend/services/authService';

interface CapabilityWrapperProps {
    domain: CapabilityDomain;
    action: CapabilityAction;
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export default function CapabilityWrapper({
    domain,
    action,
    children,
    fallback = null
}: CapabilityWrapperProps) {
    const [context, setContext] = useState<RequestContext | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        authService.getMeContext().then(ctx => {
            setContext(ctx);
            setLoading(false);
        });
    }, []);

    if (loading) return null; // Or a subtle skeleton

    const hasPermission = context?.capabilities[domain]?.includes(action);

    if (!hasPermission) return fallback as any;

    return children as any;
}
