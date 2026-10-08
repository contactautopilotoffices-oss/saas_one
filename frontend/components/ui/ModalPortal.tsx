'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/** Keep viewport overlays outside dashboard stacking and transform contexts. */
export default function ModalPortal({ children }: { children: ReactNode }) {
    const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    return mounted ? createPortal(children, document.body) : null;
}
