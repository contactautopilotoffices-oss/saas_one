import type { Metadata, Viewport } from "next";
import { Poppins, Urbanist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/frontend/context/AuthContext";
import { GlobalProvider } from "@/frontend/context/GlobalContext";
import { ThemeProvider } from "@/frontend/context/ThemeContext";
import { DataCacheProvider } from "@/frontend/context/DataCacheContext";
import { SessionProvider, CookieConsentToast } from "@/frontend/components/analytics";
import { SoundProvider } from "@/frontend/context/SoundContext";
import NotificationSystem from "@/frontend/components/ops/NotificationSystem";
import ErrorTrackingProvider from "@/frontend/components/ErrorTrackingProvider";
import HrAssistantBot from "@/frontend/components/hr-assistant/HrAssistantBot";

const poppins = Poppins({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700", "800", "900"],
    variable: "--font-display",
    display: 'swap',
});

const urbanist = Urbanist({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700"],
    variable: "--font-body",
    display: 'swap',
});

export const metadata: Metadata = {
    title: "Autopilot | Facility Management on Autopilot",
    description: "Facilities that run without constant follow-ups. Fewer complaints. Faster fixes. Clear accountability. The operating system for modern buildings.",
    keywords: ["facility management", "building maintenance", "operations automation", "property management", "SaaS"],
    manifest: "/manifest.json",
    icons: {
        icon: '/autopilot-logo.png',
        apple: '/autopilot-logo.png',
    },
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    minimumScale: 1,
    userScalable: false,
    themeColor: "#ffffff",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;

}>) {
    return (
        <html lang="en" className={`${poppins.variable} ${urbanist.variable}`} suppressHydrationWarning>
            <head>
                <link rel="manifest" href="/manifest.json" />
            </head>
            <body className="bg-background text-foreground antialiased overflow-x-hidden font-body">
                <ErrorTrackingProvider>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
                            (function() {
                                // ── CHUNK LOAD ERROR RECOVERY ───────────────────────────────────
                                // After a new deploy, an open page can ask for JS files that no longer exist;
                                // one reload fetches the new version. Capped at 2 reloads per tab per minute
                                // (the old 5-second gap let a page that keeps failing reload forever). Past the
                                // cap the error is left to show, with its Reload button. If storage is
                                // unavailable we do not reload at all, so this can never loop.
                                function recoverFromChunkError() {
                                    try {
                                        var now = Date.now();
                                        var recent = JSON.parse(sessionStorage.getItem('chunk_reload_times') || '[]')
                                            .filter(function(t) { return now - t < 60000; });
                                        if (recent.length >= 2) return;
                                        recent.push(now);
                                        sessionStorage.setItem('chunk_reload_times', JSON.stringify(recent));
                                        window.location.reload();
                                    } catch (err) {}
                                }

                                window.addEventListener('error', function(e) {
                                    if (e.message && (e.message.includes('ChunkLoadError') || e.message.includes('Loading chunk'))) {
                                        recoverFromChunkError();
                                        return;
                                    }
                                    // A <script> or stylesheet from /_next/static that fails to download
                                    // (old file gone after a deploy, or a dropped connection) fires an error
                                    // with no message, so the check above never saw it.
                                    var t = e.target;
                                    var src = t && (t.src || t.href);
                                    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK') && src && src.indexOf('/_next/static/') !== -1) {
                                        recoverFromChunkError();
                                    }
                                }, true);

                                // Also handle async promise rejections for chunks
                                window.addEventListener('unhandledrejection', function(e) {
                                    if (e.reason && e.reason.name === 'ChunkLoadError') {
                                        recoverFromChunkError();
                                    }
                                });

                                // ── STARTUP WATCHDOG ────────────────────────────────────────────
                                // AuthProvider sets window.HYDRATED once the app has started and read the
                                // session. If every file has finished downloading and the app still has not
                                // started 10 s later, the page is stuck on its server-rendered "Loading..."
                                // and nothing else will rescue it: reload, under the same 2-per-minute cap.
                                // Waiting for 'load' means a slow download is never cut short; the 45 s
                                // ceiling covers a download that hangs and never finishes.
                                function checkStarted() {
                                    if (!window.HYDRATED) recoverFromChunkError();
                                }
                                window.addEventListener('load', function() { setTimeout(checkStarted, 10000); });
                                setTimeout(checkStarted, 45000);

                                // An iPhone home-screen app is often resumed from memory instead of loaded
                                // again, so a page that was stuck stays stuck. Reload it on resume.
                                window.addEventListener('pageshow', function(e) {
                                    if (e.persisted && !window.HYDRATED) recoverFromChunkError();
                                });

                                if (!('serviceWorker' in navigator)) return;

                                // ── DEEP PURGE & RESET ───────────────────────────────────────────
                                // We aggressively unregister ALL workers and clear ALL caches 
                                // to recover from the aggressive caching bugs in previous versions.
                                const PURGE_KEY = 'sw_deep_purge_v6';
                                if (!localStorage.getItem(PURGE_KEY)) {
                                    localStorage.setItem(PURGE_KEY, 'true');
                                    
                                    let foundOldStuff = false;

                                    // 1. Unregister EVERY found worker
                                    navigator.serviceWorker.getRegistrations().then(function(regs) {
                                        if (regs.length > 0) {
                                            foundOldStuff = true;
                                            for (let reg of regs) reg.unregister();
                                        }
                                        
                                        // 2. Delete EVERY found cache bucket
                                        if ('caches' in window) {
                                            caches.keys().then(function(keys) {
                                                if (keys.length > 0) {
                                                    foundOldStuff = true;
                                                    keys.forEach(function(key) { caches.delete(key); });
                                                }
                                                
                                                // 3. ONLY reload if we actually found something to clean
                                                if (foundOldStuff) {
                                                    console.log('[Deep Purge] Cleaning up old workers/caches and reloading...');
                                                    setTimeout(function() { window.location.reload(); }, 1000);
                                                }
                                            });
                                        }
                                    });
                                    return;
                                }

                                // ── No /sw.js registration ──────────────────────────────────────
                                // /sw.js and /firebase-messaging-sw.js both claimed scope '/', so each page
                                // load swapped one for the other. /sw.js does nothing now (push lives in
                                // firebase-messaging-sw.js, registered by useFCM), so only Firebase registers.
                                // public/sw.js stays so browsers that still have it can update it cleanly.
                            })();
                        `,
                    }}
                />
                <ThemeProvider>
                    <AuthProvider>
                        <GlobalProvider>
                            <DataCacheProvider>
                                <SessionProvider>
                                    <SoundProvider>
                                        {children}
                                        <NotificationSystem />
                                        <CookieConsentToast />
                                        {/* Floating HR policy assistant: staff only, hidden on public pages (self-gates) */}
                                        <HrAssistantBot />
                                    </SoundProvider>
                                </SessionProvider>
                            </DataCacheProvider>
                        </GlobalProvider>
                    </AuthProvider>
                </ThemeProvider>
                </ErrorTrackingProvider>
            </body>
        </html>
    );
}
