importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ─── Fix 1: Proper SW lifecycle (was missing — caused mobile activation failures) ───
self.addEventListener('install', () => {
    console.log('[firebase-messaging-sw.js] Installing, skipping waiting...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[firebase-messaging-sw.js] Activating, claiming clients...');
    event.waitUntil(self.clients.claim());
});

// ─── Firebase Init ────────────────────────────────────────────────────────────────
firebase.initializeApp({
    apiKey: "AIzaSyC4qQTo0vM71suNGbtGtjOWIdK8bPzqe98",
    authDomain: "web-notification-52467.firebaseapp.com",
    projectId: "web-notification-52467",
    messagingSenderId: "758776193487",
    appId: "1:758776193487:web:37aded7039fffec6a432ba",
});

const messaging = firebase.messaging();

// ─── Background Message Handler ───────────────────────────────────────────────────
// FCM delivers the notification automatically when webpush.notification is present
// in the payload. We only need to handle the data-only fallback case here.
messaging.onBackgroundMessage(function (payload) {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);

    // Only manually show if FCM did NOT auto-display (i.e., data-only payload)
    if (payload.notification) return; // FCM already handled it

    const data = payload.data || {};
    const title = data.title || 'Autopilot Notice';
    const options = {
        body: data.message || 'You have a new notification from Autopilot',
        icon: '/android-chrome-192x192.png',
        badge: '/android-chrome-192x192.png',
        // Fix minor: prefer deep_link, fallback to url
        data: { url: data.deep_link || data.url || '/' },
        requireInteraction: true,
        vibrate: [200, 100, 200],
        tag: data.notification_id || 'autopilot-fms',
        renotify: true,
    };
    self.registration.showNotification(title, options);
});

// ─── Notification Click Handler ───────────────────────────────────────────────────
self.addEventListener('notificationclick', function (event) {
    console.log('[firebase-messaging-sw.js] Notification clicked', event);
    event.notification.close();

    // Fix minor: support both deep_link and url fields
    const data = event.notification.data || {};
    const relativeUrl = data.deep_link || data.url || '/';

    // Ensure we have a valid absolute URL
    const targetUrl = new URL(relativeUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // 1. Try to find an existing tab with this exact URL and focus it
            for (let client of windowClients) {
                if (client.url === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }

            // 2. If no exact match, find any tab on same origin and navigate it
            for (let client of windowClients) {
                if ('navigate' in client && 'focus' in client) {
                    return client.navigate(targetUrl).then(c => c && c.focus());
                }
            }

            // 3. Last resort: open a brand new window
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
