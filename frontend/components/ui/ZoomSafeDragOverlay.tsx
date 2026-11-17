'use client';

import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { useAppZoom } from '@/frontend/hooks/useAppZoom';

/**
 * dnd-kit's DragOverlay, kept under the pointer while the page is scaled (AppZoom, owner 2026-10-26).
 * dnd-kit places the overlay in real screen pixels, so the overlay undoes the page scale and its content puts it back.
 */
export default function ZoomSafeDragOverlay({ children, style, ...props }: React.ComponentProps<typeof DragOverlay>) {
    const zoom = useAppZoom();
    if (zoom === 1) return <DragOverlay style={style} {...props}>{children}</DragOverlay>;
    return (
        <DragOverlay {...props} style={{ ...style, zoom: 1 / zoom }}>
            {children ? <div style={{ zoom }}>{children}</div> : null}
        </DragOverlay>
    );
}
