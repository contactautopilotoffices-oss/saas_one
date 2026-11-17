'use client';

import { useSyncExternalStore } from 'react';

/**
 * Owner 2026-10-26: the dashboard looks the same on every laptop and monitor at 100% browser zoom.
 * It is laid out for an 1800px-wide page and scaled to the real screen with CSS `zoom` on <html> (see AppZoom): about
 * 85% on a 1536px laptop (owner: 75% was too small), about 100% on a 1920px monitor. Phones and small tablets (under
 * 1024px) keep their own layout at normal size; the scale never drops below 80%, so text stays readable on small laptops.
 */
export const DESIGN_WIDTH = 1800;
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 1.15;
export const DESKTOP_MIN_WIDTH = 1024;

/** The scale for a window this wide (two decimals, so tiny resizes do not re-lay out the page). */
export function zoomForWidth(width: number): number {
    if (!Number.isFinite(width) || width < DESKTOP_MIN_WIDTH) return 1;
    const z = Math.round((width / DESIGN_WIDTH) * 100) / 100;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** The scale the page is drawn at right now (1 when AppZoom is not active). */
export function currentAppZoom(): number {
    if (typeof document === 'undefined') return 1;
    const z = Number(document.documentElement.dataset.appZoom);
    return Number.isFinite(z) && z > 0 ? z : 1;
}

const subscribe = (onChange: () => void) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-zoom'] });
    return () => observer.disconnect();
};

/** The current page scale, re-rendering when it changes. */
export function useAppZoom(): number {
    return useSyncExternalStore(subscribe, currentAppZoom, () => 1);
}

/**
 * Drag-and-drop libraries measure the screen in real pixels, but anything they position inside the scaled page is scaled
 * again. Dividing a measured offset by the scale puts it back where the pointer is.
 */
export function unzoomTransform<T extends { x: number; y: number } | null>(transform: T, zoom: number): T {
    if (!transform || zoom === 1) return transform;
    return { ...transform, x: transform.x / zoom, y: transform.y / zoom };
}
