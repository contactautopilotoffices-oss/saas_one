'use client';

import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { FONT, Item, ItemIcon, previewKind } from './shared';

/**
 * Owner 2026-11-13: Drive-style preview. Images, PDFs, video and audio open here over the list; anything else
 * downloads instead. Left/Right move between the previewable files in the current list, Escape closes.
 */
export function PreviewOverlay({ item, url, onClose, onDownload, onPrev, onNext }: {
    item: Item; url: string; onClose: () => void; onDownload: () => void; onPrev?: () => void; onNext?: () => void;
}) {
    const kind = previewKind(item);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft' && onPrev) onPrev();
            if (e.key === 'ArrowRight' && onNext) onNext();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, onPrev, onNext]);

    return (
        <div role="dialog" aria-modal="true" aria-label={`Preview of ${item.name}`} style={FONT} className="fixed inset-0 z-[88] flex flex-col bg-black/90 text-white">
            <div className="flex h-16 shrink-0 items-center gap-3 px-3">
                <button type="button" onClick={onClose} aria-label="Close preview" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"><X className="h-5 w-5" /></button>
                <ItemIcon item={item} />
                <p className="min-w-0 flex-1 truncate text-base" title={item.name}>{item.name}</p>
                <button type="button" onClick={onDownload} aria-label="Download" title="Download" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"><Download className="h-5 w-5" /></button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
                {onPrev && (
                    <button type="button" onClick={onPrev} aria-label="Previous file" className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><ChevronLeft className="h-6 w-6" /></button>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element -- a private download behind the session; next/image can't serve it */}
                {kind === 'image' && <img src={url} alt={item.name} className="max-h-full max-w-full object-contain" />}
                {kind === 'pdf' && <iframe src={url} title={item.name} className="h-full w-full max-w-5xl rounded bg-white" />}
                {kind === 'video' && <video src={url} controls autoPlay className="max-h-full max-w-full" />}
                {kind === 'audio' && (
                    <div className="flex flex-col items-center gap-6">
                        <ItemIcon item={item} className="h-20 w-20" />
                        <audio src={url} controls autoPlay />
                    </div>
                )}
                {onNext && (
                    <button type="button" onClick={onNext} aria-label="Next file" className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><ChevronRight className="h-6 w-6" /></button>
                )}
            </div>
        </div>
    );
}
