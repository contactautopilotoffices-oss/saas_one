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
                <link
                    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body className="bg-background text-foreground antialiased overflow-x-hidden font-body">
                <ErrorTrackingProvider>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
                            (function() {
                                if (!('serviceWorker' in navigator)) return;

                                // ── CHUNK LOAD ERROR RECOVERY ───────────────────────────────────
                                // Detects failed Next.js chunks and reloads once to recover.
                                window.addEventListener('error', function(e) {
                                    if (e.message && (e.message.includes('ChunkLoadError') || e.message.includes('Loading chunk'))) {
                                        const lastReload = localStorage.getItem('last_chunk_reload');
                                        const now = Date.now();
                                        if (!lastReload || (now - parseInt(lastReload)) > 5000) {
                                            localStorage.setItem('last_chunk_reload', now.toString());
                                            window.location.reload();
                                        }
                                    }
                                }, true);

                                // Also handle async promise rejections for chunks
                                window.addEventListener('unhandledrejection', function(e) {
                                    if (e.reason && e.reason.name === 'ChunkLoadError') {
                                        window.location.reload();
                                    }
                                });

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

                                // ── Minimal Registration for Push Notifications ───────────────────
                                window.addEventListener('load', function() {
                                    navigator.serviceWorker.register('/sw.js').catch(function() {});
                                });
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
