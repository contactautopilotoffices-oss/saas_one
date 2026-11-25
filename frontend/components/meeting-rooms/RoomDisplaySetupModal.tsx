'use client';

import React, { useState } from 'react';
import { X, Copy, Check, ExternalLink, MonitorSmartphone } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Owner 2026-11-25: everything needed to point a door panel at this room.
 *
 * The ESP32-S3 panels outside each meeting room are told which room they belong to by the
 * room's UUID, which is baked into the firmware at provisioning time. That id previously had
 * to be dug out of the database by hand; this surfaces it where the room is managed.
 *
 * Read-only — it shows ids and a link, and changes nothing.
 */

interface Props {
    room: { id: string; name: string };
    onClose: () => void;
}

const CopyRow: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            // Clipboard is blocked on insecure origins and in some embedded browsers. The value
            // is on screen and selectable, so this is a convenience failing, not a dead end.
            setCopied(false);
        }
    };

    return (
        <div className="mb-5">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5 block">
                {label}
            </label>
            <div className="flex items-stretch gap-2">
                <code className="flex-1 min-w-0 px-3 py-2.5 bg-muted border border-border rounded-xl text-[12px] font-mono text-foreground break-all select-all">
                    {value}
                </code>
                <button
                    onClick={copy}
                    title={`Copy ${label.toLowerCase()}`}
                    className="shrink-0 px-3 rounded-xl bg-muted hover:bg-muted/70 border border-border text-muted-foreground transition-all active:scale-95"
                >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
            </div>
            {hint && <p className="mt-1.5 text-[11px] text-muted-foreground font-medium">{hint}</p>}
        </div>
    );
};

const RoomDisplaySetupModal: React.FC<Props> = ({ room, onClose }) => {
    // Rendered only in the browser, so the panel URL is built from wherever this app is served.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const displayPath = `/display/room/${room.id}`;
    const displayUrl = `${origin}${displayPath}`;

    return (
        <div
            className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-lg bg-card rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            >
                <div className="p-6 md:p-8 relative">
                    <button
                        className="absolute top-4 right-4 p-2 rounded-full bg-muted hover:bg-muted/70 transition-colors"
                        onClick={onClose}
                    >
                        <X className="w-4 h-4 text-muted-foreground" />
                    </button>

                    <div className="w-14 h-14 bg-primary/10 border-4 border-primary/15 rounded-2xl flex items-center justify-center mb-5">
                        <MonitorSmartphone className="w-7 h-7 text-primary" />
                    </div>

                    <h3 className="text-xl font-black text-foreground mb-1 tracking-tight">Door panel setup</h3>
                    <p className="text-sm text-muted-foreground font-medium mb-6">
                        For the screen mounted outside <span className="font-bold text-foreground">{room.name}</span>.
                    </p>

                    <CopyRow
                        label="Room ID"
                        value={room.id}
                        hint="Paste this into ROOM_ID in the panel firmware. One panel, one room."
                    />

                    <CopyRow
                        label="Display URL"
                        value={displayUrl}
                        hint="What the panel shows. Open it in a browser to check the room before flashing."
                    />

                    <a
                        href={displayPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary/90 text-text-inverse rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open preview
                    </a>

                    <p className="mt-5 text-[11px] text-muted-foreground font-medium leading-relaxed">
                        The panel only reads this room&apos;s schedule — it cannot book, cancel or change
                        anything. Bookings stay in the app.
                    </p>
                </div>
            </motion.div>
        </div>
    );
};

export default RoomDisplaySetupModal;
