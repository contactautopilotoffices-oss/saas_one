'use client';

import { useLayoutEffect } from 'react';
import { zoomForWidth } from '@/frontend/hooks/useAppZoom';

/**
 * Owner 2026-10-26: scales the whole dashboard to the screen (see useAppZoom), like browser zoom, so every laptop and
 * monitor shows the same layout. Sets `zoom` and `data-app-zoom` on <html>; globals.css keeps full-height layouts
 * filling the screen. Removed again when the dashboard unmounts (login and public pages are never scaled).
 */
export default function AppZoom() {
    useLayoutEffect(() => {
        const root = document.documentElement;
        const apply = () => {
            const zoom = zoomForWidth(window.innerWidth);
            if (zoom === 1) {
                root.style.removeProperty('zoom');
                root.style.removeProperty('--app-zoom');
                delete root.dataset.appZoom;
            } else {
                root.style.setProperty('zoom', String(zoom));
                root.style.setProperty('--app-zoom', String(zoom));
                root.dataset.appZoom = String(zoom);
            }
        };
        apply();
        window.addEventListener('resize', apply);
        return () => {
            window.removeEventListener('resize', apply);
            root.style.removeProperty('zoom');
            root.style.removeProperty('--app-zoom');
            delete root.dataset.appZoom;
        };
    }, []);

    return null;
}
