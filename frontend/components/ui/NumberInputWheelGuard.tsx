'use client';

import { useEffect } from 'react';

/**
 * Stops mouse-wheel scrolling from silently changing <input type="number"> values.
 *
 * Browsers increment/decrement a FOCUSED number input on wheel. Inside a scrollable
 * modal that is a data-corruption bug rather than a nicety: scrolling the Align Payment
 * dialog with the cursor over "GST hold" edits the amount without the user noticing,
 * and the changed figure is what gets submitted. The app has ~70 number inputs across
 * petty cash, diesel, water, stock and procurement with the same exposure.
 *
 * Blurring on wheel is the standard fix — an unfocused number input ignores the wheel,
 * and the page keeps scrolling normally. Capture phase so it runs before the browser's
 * default handling.
 */
export default function NumberInputWheelGuard() {
    useEffect(() => {
        const onWheel = (e: WheelEvent) => {
            const el = document.activeElement;
            if (el instanceof HTMLInputElement && el.type === 'number' && el === e.target) {
                el.blur();
            }
        };
        document.addEventListener('wheel', onWheel, { capture: true, passive: true });
        return () => document.removeEventListener('wheel', onWheel, { capture: true });
    }, []);

    return null;
}
