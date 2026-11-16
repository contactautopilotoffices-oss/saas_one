'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Info, AlertTriangle, CheckCircle, Share, PlusSquare } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

import { useRouter } from 'next/navigation';

interface Notification {
    id: string;
    user_id: string;
    notification_type: string;
    title: string;
    message: string;
    deep_link: string;
    created_at: string;
}

import { useFCM } from '@/frontend/hooks/useFCM';

// Fix 4: Detect if running on iOS and not in standalone (PWA) mode
function useIOSInstallPrompt() {
    const [shouldShow, setShouldShow] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            || ('standalone' in window.navigator && (window.navigator as any).standalone === true);

        // Only show if iOS + not installed + user hasn't dismissed it this session
        const dismissed = localStorage.getItem('ios_install_dismissed');
        if (isIOS && !isStandalone && !dismissed) {
            // Delay slightly so it doesn't pop up immediately on load
            // Use a local variable to check mount status for safe async update
            let isMounted = true;
            const timer = setTimeout(() => {
                if (isMounted) setShouldShow(true);
            }, 3000);
            return () => {
                isMounted = false;
                clearTimeout(timer);
            };
        }
    }, []);

    const dismiss = () => {
        setShouldShow(false);
        localStorage.setItem('ios_install_dismissed', '1');
    };

    return { shouldShow, dismiss };
}

// Hook to track and prompt for notification permissions (non-iOS browsers)
function useNotificationPermission() {
    // Initialize state directly from the API to avoid a second render pass on mount
    const [permission, setPermission] = useState<string>(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return 'granted';
        return Notification.permission;
    });
    const [shouldShowPrompt, setShouldShowPrompt] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        
        // Sync permission if it changed externally (rare)
        if (permission !== Notification.permission) {
            setPermission(Notification.permission);
        }

        // If default (not yet asked), show a soft prompt after 5 seconds
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        if (Notification.permission === 'default' && !isIOS) {
            let isMounted = true;
            const timer = setTimeout(() => {
                const dismissed = localStorage.getItem('notif_prompt_dismissed');
                if (dismissed) return;
                if (isMounted) setShouldShowPrompt(true);
            }, 5000);
            return () => {
                isMounted = false;
                clearTimeout(timer);
            };
        }
    }, [permission]);

    const requestPermission = async () => {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        
        // Hide our prompt and remember that they interacted with it
        setShouldShowPrompt(false);
        localStorage.setItem('notif_prompt_dismissed', '1');

        try {
            const result = await Notification.requestPermission();
            setPermission(result);
            if (result === 'granted') {
                // Trigger FCM sync by reloading or dispatching event
                window.dispatchEvent(new Event('visibilitychange'));
            }
        } catch (err) {
            console.error('Failed to request notification permission:', err);
            // Fallback for older Safari
            Notification.requestPermission((result) => {
                setPermission(result);
                if (result === 'granted') {
                    window.dispatchEvent(new Event('visibilitychange'));
                }
            });
        }
    };

    const dismiss = () => {
        setShouldShowPrompt(false);
        localStorage.setItem('notif_prompt_dismissed', '1');
    };

    return { permission, shouldShowPrompt, requestPermission, dismiss };
}

/**
 * NotificationSystem - Global component for handling real-time alerts
 */
export default function NotificationSystem() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const supabase = createClient();
    const router = useRouter();

    // Register FCM push notifications globally (Fix 5 + 6 inside this hook)
    useFCM();

    // Fix 4: iOS install prompt
    const { shouldShow: showIOSPrompt, dismiss: dismissIOSPrompt } = useIOSInstallPrompt();
    // "Turn on" on the strip opens the steps (Share, then Add to Home Screen).
    const [showIOSSteps, setShowIOSSteps] = useState(false);

    // Browser permission prompt (Non-iOS)
    const { shouldShowPrompt: showPermPrompt, requestPermission, dismiss: dismissPermPrompt } = useNotificationPermission();

    // Trigger Haptics
    const triggerHaptic = (type: string) => {
        if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
            if (type === 'SLA_BREACH' || type === 'SLA_WARNING') {
                window.navigator.vibrate([100, 50, 100]);
            } else {
                window.navigator.vibrate(50);
            }
        }
    };

    useEffect(() => {
        let isMounted = true;

        const setupSubscription = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!isMounted || !user) return;

            // Subscribe to real-time notifications for THIS user only
            const channel = supabase
                .channel(`notif-${user.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'notifications',
                        filter: `user_id=eq.${user.id}`
                    },
                    (payload) => {
                        const newNotif = payload.new as Notification;
                        setNotifications((prev) => [newNotif, ...prev]);
                        triggerHaptic(newNotif.notification_type);

                        // Auto-dismiss after 6 seconds
                        setTimeout(() => {
                            setNotifications((prev) => prev.filter((n) => n.id !== newNotif.id));
                        }, 6000);
                    }
                )
                .subscribe();

            console.log('Subscribing notification channel (NotificationSystem)');
            channelRef.current = channel;
        };

        setupSubscription();

        return () => {
            isMounted = false;
            if (channelRef.current) {
                console.log('Removing notification channel (NotificationSystem)');
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, []);

    const handleNotificationClick = (notif: Notification) => {
        console.log('Notification clicked:', notif);
        removeNotification(notif.id);
        if (notif.deep_link) {
            console.log('Redirecting to:', notif.deep_link);
            router.push(notif.deep_link);
        } else {
            console.warn('Notification has no deep_link');
        }
    };

    const removeNotification = (id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    };

    const getTypeStyles = (type: string) => {
        switch (type) {
            case 'SLA_BREACH':
            case 'SLA_WARNING':
                return {
                    icon: <AlertTriangle className="w-5 h-5 text-error" />,
                    bg: 'bg-error/5',
                    border: 'border-error/20'
                };
            case 'TICKET_ASSIGNED':
            case 'TICKET_COMPLETED':
                return {
                    icon: <CheckCircle className="w-5 h-5 text-success" />,
                    bg: 'bg-success/5',
                    border: 'border-success/20'
                };
            default:
                return {
                    icon: <Bell className="w-5 h-5 text-primary" />,
                    bg: 'bg-primary/5',
                    border: 'border-primary/20'
                };
        }
    };

    return (
        <>
            {/* Fix 4: iOS PWA Install Prompt */}
            <AnimatePresence>
                {showIOSPrompt && (
                    <motion.div
                        key="ios-install-prompt"
                        initial={{ opacity: 0, y: 80 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 80 }}
                        transition={{ type: 'spring', damping: 20, stiffness: 260 }}
                        // Owner 2026-11-15: a one-line dark strip at the bottom instead of a card over the tickets.
                        // "Turn on" shows the same steps as before; × dismisses for good (same localStorage key).
                        className="fixed inset-x-2 min-[390px]:inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[55] mx-auto max-w-md"
                        role="region"
                        aria-label="Ticket alerts on this phone"
                        style={{ fontFamily: 'var(--font-body)' }}
                    >
                        {showIOSSteps && (
                            <p id="ios-alert-steps" className="mb-2 rounded-[14px] bg-gray-900 px-3.5 py-3 text-sm leading-relaxed text-gray-100 shadow-[0_8px_24px_rgba(15,23,42,0.25)]">
                                Tap{' '}
                                <Share className="mx-0.5 inline h-4 w-4 text-blue-300" aria-hidden="true" />
                                {' '}Share, then{' '}
                                <strong className="text-white">
                                    <PlusSquare className="mx-0.5 inline h-4 w-4" aria-hidden="true" />
                                    Add to Home Screen
                                </strong>
                                {' '}to receive push alerts.
                            </p>
                        )}
                        <div className="flex h-[52px] items-center gap-2 rounded-[14px] bg-gray-900 pl-3 pr-0.5 min-[390px]:gap-2.5 min-[390px]:pl-3.5 text-white shadow-[0_8px_24px_rgba(15,23,42,0.25)]">
                            <Bell className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold min-[420px]:text-sm">Get ticket alerts on this phone</span>
                            <button
                                type="button"
                                onClick={() => setShowIOSSteps(s => !s)}
                                aria-expanded={showIOSSteps}
                                aria-controls="ios-alert-steps"
                                className="shrink-0 rounded-[8px] px-1.5 py-3 text-sm font-bold text-blue-300 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                            >
                                Turn on
                            </button>
                            <button
                                type="button"
                                onClick={dismissIOSPrompt}
                                className="flex h-11 w-10 shrink-0 items-center justify-center rounded-[8px] text-gray-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                                aria-label="Close"
                            >
                                <X className="h-[18px] w-[18px]" strokeWidth={2.5} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Browser Permission Prompt (Non-iOS) */}
            <AnimatePresence>
                {showPermPrompt && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-md"
                    >
                        <div className="bg-white border border-primary/20 shadow-2xl rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
                            
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                <Bell className="w-5 h-5 text-primary" />
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-black uppercase tracking-widest text-text-primary mb-1">
                                    Don't miss a fix
                                </p>
                                <p className="text-[11px] text-text-secondary leading-tight">
                                    Allow notifications to get real-time updates on your tickets and tasks.
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={requestPermission}
                                    className="px-3 py-1.5 bg-primary text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-primary-dark transition-all shadow-sm"
                                >
                                    Enable
                                </button>
                                <button
                                    onClick={dismissPermPrompt}
                                    className="p-1.5 text-text-tertiary hover:bg-slate-50 rounded-lg transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>


            {/* Existing push toast notifications */}
            <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-3 w-80 pointer-events-none">
                <AnimatePresence>
                    {notifications.map((notif) => {
                        const styles = getTypeStyles(notif.notification_type);
                        return (
                            <motion.div
                                key={notif.id}
                                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                                onClick={() => handleNotificationClick(notif)}
                                className={`pointer-events-auto flex items-start gap-4 p-4 rounded-xl border bg-white shadow-2xl ${styles.border} ${styles.bg} overflow-hidden relative group cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all`}
                            >
                                <div className="mt-0.5">{styles.icon}</div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-xs font-black uppercase tracking-widest text-text-primary mb-1">
                                        {notif.title}
                                    </h4>
                                    <p className="text-[11px] font-medium text-text-secondary leading-normal">
                                        {notif.message}
                                    </p>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeNotification(notif.id);
                                    }}
                                    className="p-1 hover:bg-black/5 rounded-md transition-colors relative z-10"
                                >
                                    <X className="w-4 h-4 text-text-tertiary" />
                                </button>

                                {/* Progress bar for auto-dismiss */}
                                <motion.div
                                    initial={{ width: '100%' }}
                                    animate={{ width: '0%' }}
                                    transition={{ duration: 6, ease: 'linear' }}
                                    className="absolute bottom-0 left-0 h-1 bg-black/5"
                                />
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </>
    );
}
