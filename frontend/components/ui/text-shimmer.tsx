'use client';

import React, { useMemo } from 'react';

interface TextShimmerProps {
    children: React.ReactNode;
    duration?: number;
    className?: string;
    baseColor?: string;
    gradientColor?: string;
}

export function TextShimmer({
    children,
    duration = 1.2,
    className = '',
    baseColor = '#475569',
    gradientColor = '#94a3b8',
}: TextShimmerProps) {
    const animationStyle = useMemo(() => ({
        backgroundImage: `linear-gradient(90deg, ${baseColor} 0%, ${gradientColor} 50%, ${baseColor} 100%)`,
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        animation: `text-shimmer ${duration}s ease-in-out infinite`,
    } as React.CSSProperties), [duration, baseColor, gradientColor]);

    return (
        <>
            <style>{`
                @keyframes text-shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
            `}</style>
            <span className={className} style={animationStyle}>
                {children}
            </span>
        </>
    );
}
