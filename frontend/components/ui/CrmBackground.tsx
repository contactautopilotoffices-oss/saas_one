'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';

// Per-user wallpaper for the CRM shell. The URL + opacity live on
// users.metadata (so they sync across devices, including the mobile app) and
// are mirrored into localStorage for an instant, flash-free first paint.
export const WALLPAPER_EVENT = 'crm-wallpaper-changed';
export const DEFAULT_WALLPAPER_OPACITY = 0.25;
// How far surfaces (sidebar + cards) shift toward the wallpaper's accent.
export const TINT_STRENGTH = 0.08;

export interface WallpaperState {
    url: string;
    opacity: number;
    accent: string; // hex like "#3b82f6", '' = no chameleon tint
}

// ── Color helpers (chameleon tint) ────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
    const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

// Mix a base color toward an accent by t (0..1).
export function mixHex(baseHex: string, accentHex: string, t: number): string {
    const a = hexToRgb(baseHex);
    const b = hexToRgb(accentHex);
    if (!a || !b) return baseHex;
    return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

// ── Chameleon theme spec ──────────────────────────────────────────────────────
// Numbers from a full-hue-sweep, WCAG-verified design pass. Primary L=0.381 is
// the most-immersive lightness whose worst hue (yellow, H=60) still keeps
// white-on-primary >= 3:1. Text is tinted only slightly so body copy stays
// near-neutral and readable (>=13:1 on the tinted surface).
//
// LIGHT MODE ONLY for now: dark mode has a different text-alpha ramp and needs
// a lighter accent to stay legible on dark surfaces, so applying these (light)
// values there would regress dark text/buttons. Dark mode keeps its standard,
// already-tuned palette until that's handled — revisit before the global rollout.
const PRIMARY_S = 0.58;
const PRIMARY_L = 0.381;
const PRIMARY_LIGHT_DL = 0.12;
const PRIMARY_DARK_DL = -0.11;
const TEXT_TINT_PRIMARY = 0.08;
const TEXT_TINT_SECONDARY = 0.16;

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

function hslHex(h: number, s: number, l: number): string {
    const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0.06, 0.94));
    return rgbToHex(r, g, b);
}

// Full chameleon theme derived from the wallpaper accent: surfaces (sidebar +
// cards), the brand primary family (buttons, links, icons, active states) and
// the text hierarchy. Applied on the CRM shell root only, so it's route-scoped.
export function crmThemeVars(accent: string, isDark: boolean): CSSProperties | undefined {
    // Light mode only for now (see spec note above): dark mode keeps its tuned palette.
    if (isDark) return undefined;

    const accentRgb = hexToRgb(accent);
    if (!accent || !accentRgb) return undefined;
    const [h] = rgbToHsl(accentRgb[0], accentRgb[1], accentRgb[2]);

    // Primary family — keep accent hue/sat, contrast-safe lightness.
    const primary = hslHex(h, PRIMARY_S, PRIMARY_L);
    const primaryLight = hslHex(h, PRIMARY_S, PRIMARY_L + PRIMARY_LIGHT_DL);
    const primaryDark = hslHex(h, PRIMARY_S, PRIMARY_L + PRIMARY_DARK_DL);
    const pRgb = hexToRgb(primary)!;

    // Surfaces: 8% toward accent over white/elevated-white.
    const surfBase = '#ffffff';
    const surfElev = '#f8fafc';

    // Text: tint the base color only; preserve the existing alpha ramp.
    const textBase: [number, number, number] = [26, 35, 50];
    const tintText = (strength: number): [number, number, number] => [
        Math.round(textBase[0] + (accentRgb[0] - textBase[0]) * strength),
        Math.round(textBase[1] + (accentRgb[1] - textBase[1]) * strength),
        Math.round(textBase[2] + (accentRgb[2] - textBase[2]) * strength),
    ];
    const tp = tintText(TEXT_TINT_PRIMARY);
    const ts = tintText(TEXT_TINT_SECONDARY);
    const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

    // A soft diagonal accent wash layered on top of cards so the wallpaper color
    // is "integrated" into tiles (subtle, fades out — not a flat slab of color).
    const [ar, ag, ab] = accentRgb;
    const surfaceGradient = `linear-gradient(160deg, rgba(${ar}, ${ag}, ${ab}, 0.16) 0%, rgba(${ar}, ${ag}, ${ab}, 0.04) 45%, rgba(${ar}, ${ag}, ${ab}, 0) 75%)`;

    return {
        ['--surface' as any]: mixHex(surfBase, accent, TINT_STRENGTH),
        ['--surface-elevated' as any]: mixHex(surfElev, accent, TINT_STRENGTH),
        ['--surface-gradient' as any]: surfaceGradient,
        // Brand primary / accent (buttons, links, icons, active nav, glows)
        ['--primary' as any]: primary,
        ['--primary-light' as any]: primaryLight,
        ['--primary-dark' as any]: primaryDark,
        ['--primary-rgb' as any]: `${pRgb[0]}, ${pRgb[1]}, ${pRgb[2]}`,
        ['--accent' as any]: primary,
        ['--accent-light' as any]: primaryLight,
        ['--accent-dark' as any]: primaryDark,
        // Text hierarchy (subtle hue whisper, readability preserved)
        ['--text-primary' as any]: rgba(tp, 0.92),
        ['--text-secondary' as any]: rgba(ts, 0.62),
        ['--text-tertiary' as any]: rgba(ts, 0.42),
        ['--text-muted' as any]: rgba(ts, 0.42),
    };
}

// Tracks whether the app is in dark mode (the `.dark` class on <html>),
// reacting to theme toggles via a MutationObserver.
export function useIsDark(): boolean {
    const [isDark, setIsDark] = useState(false);
    useEffect(() => {
        const el = document.documentElement;
        const update = () => setIsDark(el.classList.contains('dark'));
        update();
        const obs = new MutationObserver(update);
        obs.observe(el, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);
    return isDark;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// Average a downscaled copy of the image, weighting saturated pixels, then
// normalize into a pleasant band so the accent is vivid but never garish.
export function extractAccentFromSrc(src: string): Promise<string> {
    return new Promise((resolve) => {
        if (typeof document === 'undefined') return resolve('');
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const size = 48;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve('');
                ctx.drawImage(img, 0, 0, size, size);
                const data = ctx.getImageData(0, 0, size, size).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const R = data[i], G = data[i + 1], B = data[i + 2], A = data[i + 3];
                    if (A < 125) continue;
                    const max = Math.max(R, G, B), min = Math.min(R, G, B);
                    if (max > 245 && min > 245) continue; // skip near-white
                    if (max < 12) continue; // skip near-black
                    const sat = max === 0 ? 0 : (max - min) / max;
                    const w = 0.2 + sat; // vivid pixels count more
                    r += R * w; g += G * w; b += B * w; count += w;
                }
                if (count === 0) return resolve('');
                let [h, s, l] = rgbToHsl(r / count, g / count, b / count);
                s = Math.max(0.3, Math.min(0.65, s));
                l = Math.max(0.42, Math.min(0.6, l));
                const [nr, ng, nb] = hslToRgb(h, s, l);
                resolve(rgbToHex(nr, ng, nb));
            } catch {
                resolve(''); // tainted canvas / decode failure → no tint
            }
        };
        img.onerror = () => resolve('');
        img.src = src;
    });
}

// Storage is namespaced by user id so a wallpaper is strictly personal: on a
// shared device, signing in as someone else never shows the previous user's
// background (each id has its own key, and no id => no wallpaper).
function keyFor(userId: string | null | undefined): string | null {
    return userId ? `crm:wallpaper:${userId}` : null;
}

export function readWallpaper(userId: string | null | undefined): WallpaperState {
    const empty: WallpaperState = { url: '', opacity: DEFAULT_WALLPAPER_OPACITY, accent: '' };
    const key = keyFor(userId);
    if (typeof window === 'undefined' || !key) return empty;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return empty;
        const parsed = JSON.parse(raw);
        return {
            url: typeof parsed.url === 'string' ? parsed.url : '',
            opacity: typeof parsed.opacity === 'number' ? parsed.opacity : DEFAULT_WALLPAPER_OPACITY,
            accent: typeof parsed.accent === 'string' ? parsed.accent : '',
        };
    } catch {
        return empty;
    }
}

export function saveWallpaperLocal(userId: string | null | undefined, state: WallpaperState) {
    const key = keyFor(userId);
    if (typeof window === 'undefined' || !key) return;
    try {
        localStorage.setItem(key, JSON.stringify(state));
    } catch {
        /* ignore quota / private-mode errors */
    }
    window.dispatchEvent(new CustomEvent(WALLPAPER_EVENT));
}

// Subscribe to the signed-in user's wallpaper. Updates live when the settings
// panel saves (same tab via custom event) or another tab changes it (storage
// event). Returns the standard (empty) background when signed out.
export function useWallpaper(): WallpaperState {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const [wp, setWp] = useState<WallpaperState>(() => readWallpaper(userId));
    useEffect(() => {
        const sync = () => setWp(readWallpaper(userId));
        sync(); // re-read immediately when the active user changes
        window.addEventListener(WALLPAPER_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(WALLPAPER_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, [userId]);
    return wp;
}

export default function CrmBackground() {
    const { user } = useAuth();
    const wp = useWallpaper();

    // Pull the authoritative value from the user's profile once per session so
    // a wallpaper set on another device shows up here too. If the wallpaper exists
    // but the accent is missing (e.g. uploaded before chameleon feature), extract
    // and save it.
    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        (async () => {
            try {
                // Read the authoritative value via the server (service-role, RLS-proof).
                const res = await fetch('/api/crm/wallpaper');
                if (!res.ok || cancelled) return;
                const data = await res.json();
                const url = typeof data.url === 'string' ? data.url : '';
                let accent = typeof data.accent === 'string' ? data.accent : '';
                const opacity = typeof data.opacity === 'number' ? data.opacity : DEFAULT_WALLPAPER_OPACITY;

                // If a wallpaper exists but the accent is missing (uploaded before the
                // chameleon feature), extract it and persist it back via the server.
                if (url && !accent) {
                    try {
                        accent = (await extractAccentFromSrc(url)) || '';
                        if (accent && !cancelled) {
                            await fetch('/api/crm/wallpaper', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url, opacity, accent }),
                            });
                        }
                    } catch (err) {
                        console.warn('Failed to extract/save wallpaper accent:', err);
                    }
                }

                if (cancelled) return;
                const next: WallpaperState = { url, opacity, accent };
                const cur = readWallpaper(user.id);
                if (cur.url !== next.url || cur.opacity !== next.opacity || cur.accent !== next.accent) {
                    saveWallpaperLocal(user.id, next);
                }
            } catch {
                /* offline / transient — keep the local value */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    if (!wp.url) return null;

    return (
        <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url("${wp.url}")`, opacity: wp.opacity }}
        />
    );
}
