import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const isConfigValid = !!firebaseConfig.projectId && !!firebaseConfig.apiKey;
const app = typeof window !== "undefined" && isConfigValid
    ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp())
    : null;

let messaging: any = null;
if (typeof window !== "undefined" && app) {
    try {
        if ('serviceWorker' in navigator) {
            messaging = getMessaging(app);
        }
    } catch (e) {
        console.warn('FCM not supported (likely insecure context):', e);
    }
}

export { app, messaging };

/**
 * Fix 3: Corrected SW registration to eliminate the race condition.
 *
 * Previously:
 *   getRegistration('/firebase-messaging-sw.js') || register(...)
 * This could return undefined if the SW existed but wasn't yet active,
 * causing getToken() to fail silently on mobile.
 *
 * Now: always call register() (browser deduplicates), then await .ready
 * to guarantee the SW is fully active before requesting the FCM token.
 */
export const requestForToken = async (): Promise<string | null> => {
    if (!messaging || typeof window === 'undefined') return null;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn('[FCM] Notification permission not granted.');
            return null;
        }

        // Always register — browser deduplicates if already registered
        await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
            scope: '/',
            updateViaCache: 'none', // Always check for SW updates
        });

        // Wait for the SW to be fully activated before requesting token
        const registration = await navigator.serviceWorker.ready;
        console.log('[FCM] Service Worker ready, requesting token...');

        const currentToken = await getToken(messaging, {
            vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
            serviceWorkerRegistration: registration,
        });

        if (!currentToken) {
            console.warn('[FCM] No token received — user may have blocked notifications.');
        }

        return currentToken || null;
    } catch (err) {
        console.error('[FCM] Error retrieving token:', err);
    }
    return null;
};

/**
 * Foreground message listener — resolves once with the next message.
 * Call this in a loop or with a persistent subscription in your UI layer.
 */
export const onMessageListener = () =>
    new Promise((resolve) => {
        if (!messaging) return;
        onMessage(messaging, (payload) => {
            resolve(payload);
        });
    });
