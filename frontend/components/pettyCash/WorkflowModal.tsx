'use client';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
const subscribe = () => () => {};
export default function WorkflowModal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
    const mounted = useSyncExternalStore(subscribe, () => true, () => false);
    const panel = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!mounted) return;
        const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panel.current?.focus();
        return () => { before?.focus(); };
    }, [mounted]);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onClose();
            if (event.key === 'Tab') {
                const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || []);
                const first = items[0]; const last = items[items.length - 1];
                if (!first) { event.preventDefault(); return; }
                if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
            }
        };
        window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
    }, [onClose, busy]);
    if (!mounted) return null;
    return createPortal(<div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" role="presentation">
        <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="petty-cash-workflow w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-3xl bg-white dark:bg-[#161b22] text-slate-900 dark:text-white shadow-2xl border border-slate-100 dark:border-[#30363d]">
            <div className="sticky top-0 z-10 flex justify-between items-center gap-4 bg-white/95 dark:bg-[#161b22]/95 backdrop-blur-md border-b border-slate-100 dark:border-[#30363d] px-6 py-4.5">
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h2>
                <button type="button" disabled={busy} onClick={onClose} aria-label="Close dialog" className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 dark:border-[#30363d] text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#21262d] transition-colors"><X size={18} /></button>
            </div>
            <div className="pc-modal-body p-6 space-y-4">{children}</div>
        </section>
    </div>, document.body);
}
