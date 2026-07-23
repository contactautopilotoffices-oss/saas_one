/**
 * Minimalist Service Worker
 *
 * Push notifications are now handled exclusively by firebase-messaging-sw.js.
 * This worker only handles install/activate to avoid SW conflicts on mobile.
 *
 * Fix 1: Removed push + notificationclick listeners from here — they now live
 * in firebase-messaging-sw.js to prevent two SWs fighting over notifications.
 */

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

/**
 * NOTE: No fetch listener — browser handles all requests natively.
 * NOTE: No push listener — handled by firebase-messaging-sw.js.
 */