'use client';

import React, { useRef, useState } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import imageCompression from 'browser-image-compression';
import { Image as ImageIcon, Save, Loader2, RotateCcw, UploadCloud, Volume2, VolumeX } from 'lucide-react';
import {
    readWallpaper,
    saveWallpaperLocal,
    extractAccentFromSrc,
    DEFAULT_WALLPAPER_OPACITY,
} from '@/frontend/components/ui/CrmBackground';
import { useSound } from '@/frontend/context/SoundContext';

interface WallpaperSettingsProps {
    // Optional: when embedded in a page that already has a toast, reuse it.
    // Otherwise the component shows its own lightweight toast.
    showToast?: (message: string, type?: 'success' | 'error') => void;
}

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export default function WallpaperSettings({ showToast: externalToast }: WallpaperSettingsProps) {
    const { user } = useAuth();
    const supabase = createClient();
    const fileRef = useRef<HTMLInputElement>(null);
    const { soundEnabled, setSoundEnabled } = useSound();

    const [localToast, setLocalToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        if (externalToast) {
            externalToast(message, type);
        } else {
            setLocalToast({ message, type });
            setTimeout(() => setLocalToast(null), 3000);
        }
    };

    const initial = typeof window !== 'undefined' ? readWallpaper(user?.id) : { url: '', opacity: DEFAULT_WALLPAPER_OPACITY, accent: '' };
    const [preview, setPreview] = useState<string>(initial.url);
    const [opacity, setOpacity] = useState<number>(initial.opacity);
    const [accent, setAccent] = useState<string>(initial.accent);
    const [file, setFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);

    const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!ACCEPTED.includes(f.type)) {
            showToast('Please choose a JPG, PNG, or WebP image', 'error');
            return;
        }
        const objectUrl = URL.createObjectURL(f);
        setFile(f);
        setPreview(objectUrl);
        // Preview the chameleon accent immediately (recomputed again on save).
        extractAccentFromSrc(objectUrl).then((c) => setAccent(c || ''));
    };

    // Persist via the server (service-role) so it isn't silently dropped by RLS on
    // the users table — a direct browser update saved 0 rows without erroring, so the
    // value reverted on refresh. The server route writes users.metadata reliably.
    const persist = async (url: string, op: number, acc: string) => {
        if (!user) return;
        const res = await fetch('/api/crm/wallpaper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, opacity: op, accent: acc }),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e?.error || 'Failed to save wallpaper');
        }
        saveWallpaperLocal(user.id, { url, opacity: op, accent: acc });
    };

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        try {
            let url = preview;
            let nextAccent = accent;
            if (file) {
                // Derive the chameleon accent from the local blob (no CORS taint).
                nextAccent = (await extractAccentFromSrc(preview)) || '';
                setAccent(nextAccent);

                const compressed = await imageCompression(file, {
                    maxSizeMB: 1.5,
                    maxWidthOrHeight: 2560,
                    useWebWorker: true,
                });
                const path = `${user.id}/crm-wallpaper.jpg`;
                const { error: upErr } = await supabase.storage
                    .from('user-photos')
                    .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
                if (upErr) throw upErr;
                const { data } = supabase.storage.from('user-photos').getPublicUrl(path);
                // Cache-bust so the fixed layer reloads the new image at the same path.
                url = `${data.publicUrl}?v=${Date.now()}`;
                setPreview(url);
                setFile(null);
            }
            if (!url) {
                showToast('Upload an image first, or keep the standard background', 'error');
                return;
            }
            await persist(url, opacity, nextAccent);
            showToast('Wallpaper saved');
        } catch (err: any) {
            console.error('Wallpaper save failed:', err);
            showToast(err?.message || 'Failed to save wallpaper', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        setSaving(true);
        try {
            await persist('', DEFAULT_WALLPAPER_OPACITY, '');
            setPreview('');
            setFile(null);
            setAccent('');
            setOpacity(DEFAULT_WALLPAPER_OPACITY);
            showToast('Reverted to the standard background');
        } catch (err: any) {
            console.error('Wallpaper reset failed:', err);
            showToast(err?.message || 'Failed to reset', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 md:p-8 shadow-sm">
            <h2 className="text-xl font-display font-semibold text-slate-900 mb-1 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" />
                Appearance
            </h2>
            <p className="text-slate-500 font-body text-sm mb-6">
                Set a personal background for your workspace. This applies only to your account — the standard
                white background stays the default for everyone else.
            </p>

            <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
                {/* Preview */}
                <div className="w-full md:w-64 shrink-0">
                    <div
                        className="relative w-full aspect-video rounded-xl border border-slate-200 overflow-hidden bg-slate-50 cursor-pointer group"
                        onClick={() => fileRef.current?.click()}
                    >
                        {preview ? (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={preview} alt="Wallpaper preview" className="absolute inset-0 w-full h-full object-cover" style={{ opacity }} />
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <UploadCloud className="w-7 h-7 text-white" />
                                </div>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-1">
                                <UploadCloud className="w-7 h-7" />
                                <span className="text-xs font-semibold">Click to upload</span>
                            </div>
                        )}
                    </div>
                    <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handlePick} className="hidden" />
                    <p className="text-xs font-semibold text-slate-500 mt-2 text-center">JPG, PNG or WebP · up to ~10MB</p>
                </div>

                {/* Controls */}
                <div className="flex-1 w-full space-y-6">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-slate-700">Background opacity</label>
                            <span className="text-sm font-bold text-slate-900">{Math.round(opacity * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(opacity * 100)}
                            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                            className="w-full accent-primary"
                        />
                        <p className="text-xs text-slate-500">0% = hidden · 100% = full strength. Lower values keep your content easier to read.</p>
                    </div>

                    {accent && preview && (
                        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <span className="h-7 w-7 shrink-0 rounded-lg border border-slate-200 shadow-inner" style={{ backgroundColor: accent }} />
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-700">Chameleon accent</p>
                                <p className="text-xs text-slate-500">Your sidebar, cards, buttons &amp; text pick up this color across the CRM.</p>
                            </div>
                        </div>
                    )}

                    {/* Sound effects toggle — off by default, persisted per device */}
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                            <span className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${soundEnabled ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-500'}`}>
                                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                            </span>
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-700">Sound effects</p>
                                <p className="text-xs text-slate-500">Subtle cues for ticking off tasks, switching filters &amp; success toasts.</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={soundEnabled}
                            aria-label="Toggle sound effects"
                            onClick={() => setSoundEnabled(!soundEnabled)}
                            className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${soundEnabled ? 'bg-primary' : 'bg-slate-300'}`}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${soundEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save
                        </button>
                        <button
                            type="button"
                            onClick={handleReset}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Use standard
                        </button>
                    </div>
                </div>
            </div>

            {/* Internal toast (only used when no external toast was provided) */}
            {localToast && (
                <div
                    className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg ${
                        localToast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'
                    }`}
                >
                    {localToast.message}
                </div>
            )}
        </section>
    );
}
