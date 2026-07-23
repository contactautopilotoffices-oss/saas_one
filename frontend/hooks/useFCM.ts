'use client';

import { useEffect, useRef } from 'react';
import { requestForToken } from '@/frontend/lib/firebase';
import { createClient } from '@/frontend/utils/supabase/client';

export function useFCM() {
    const supabase = createClient();
    // Ref to prevent concurrent init calls (e.g., rapid visibility changes)
    const isInitializing = useRef(false);

    useEffect(() => {
        const initializeFCM = async () => {
            if (typeof window === 'undefined') return;
            if (isInitializing.current) return;
            isInitializing.current = true;

            try {
                // 1. Get current user
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                // 2. Fix 6: Use crypto.randomUUID() instead of Math.random()
                //    for a cryptographically stable browser instance ID
                let instanceId = localStorage.getItem('fcm_browser_instance_id');
                if (!instanceId) {
                    instanceId = typeof crypto !== 'undefined' && crypto.randomUUID
                        ? crypto.randomUUID()
                        : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                    localStorage.setItem('fcm_browser_instance_id', instanceId);
                }

                // 3. Request token (Fix 3 is inside requestForToken — handles SW race condition)
                const fcmToken = await requestForToken();
                if (!fcmToken) return;

                // 4. Upsert to push_tokens table
                const { error } = await supabase
                    .from('push_tokens')
                    .upsert({
                        user_id: user.id,
                        token: fcmToken,
                        browser: instanceId,
                        device_info: navigator.userAgent,
                        is_active: true,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'token' });

                if (error) {
                    console.error('[FCM] Error saving token to DB:', error);
                } else {
                    console.log('[FCM] Token synchronized successfully');
                }
            } catch (err) {
                console.error('[FCM] Initialization error:', err);
            } finally {
                isInitializing.current = false;
            }
        };

        // Initial load
        initializeFCM();

        // Fix 5: Re-sync token on visibility change.
        // FCM tokens can rotate while the app is backgrounded on mobile.
        // When the user returns to the app, we re-check and update the token
        // if it has changed, ensuring push never silently stops working.
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('[FCM] App visible — re-syncing push token...');
                initializeFCM();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);
}
