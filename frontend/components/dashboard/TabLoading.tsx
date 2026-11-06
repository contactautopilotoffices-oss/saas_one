'use client';

import { Loader2 } from 'lucide-react';

/**
 * Shown INSIDE the content area while a sidebar tab's code is still downloading (tabs load on demand — performance plan
 * Phase 1). The sidebar and header stay on screen; without this the wait jumped up to the whole dashboard and the full
 * screen went blank (owner, 2026-10-13). Tabs are also preloaded in the background, so this is rarely seen.
 */
export default function TabLoading() {
    return (
        <div className="flex min-h-[40vh] w-full items-center justify-center text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
        </div>
    );
}
