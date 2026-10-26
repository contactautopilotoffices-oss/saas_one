'use client';

import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState, type CSSProperties } from 'react';

import { BOT_NAME, BOT_TITLE } from '@/backend/lib/hr-assistant/identity';
import { useAuth } from '@/frontend/context/AuthContext';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';

import { BotFace, type BotMood } from './BotFace';
import { claimHrChat, HrAssistantChat, useHrChatPending } from './HrAssistantChat';

interface HrAccess {
    canUse: boolean;
    isAdmin: boolean;
}

// Kept outside React so the answer (and whether the window is open) survives the bot
// remounting when the dashboard layout switches branches between pages.
let accessCache: { userId: string; access: Promise<HrAccess> } | null = null;
let wasOpen = false;
let openFor: string | null = null;

// The greeting bubble pops up once per browser session.
const GREETED_KEY = 'hr-assistant-greeted';
const GREETING_DELAY_MS = 1500;
const GREETING_VISIBLE_MS = 8000;
let greetedThisLoad = false;

function alreadyGreeted(): boolean {
    if (greetedThisLoad) return true;
    try {
        return window.sessionStorage.getItem(GREETED_KEY) === '1';
    } catch {
        return false;
    }
}

function markGreeted() {
    greetedThisLoad = true;
    try {
        window.sessionStorage.setItem(GREETED_KEY, '1');
    } catch {
        // Storage blocked (private mode, policy): the in-memory flag still covers this load.
    }
}

function loadAccess(userId: string): Promise<HrAccess> {
    if (accessCache?.userId !== userId) {
        const access = fetch('/api/hr-assistant', { cache: 'no-store' })
            .then(res => (res.ok ? (res.json() as Promise<HrAccess>) : { canUse: false, isAdmin: false }))
            .catch(() => {
                accessCache = null; // network blip: try again on the next mount
                return { canUse: false, isAdmin: false };
            });
        accessCache = { userId, access };
    }
    return accessCache.access;
}

/** Three bouncing dots in a little cloud, floating off the launcher while an answer loads. */
function ThoughtCloud() {
    const reduceMotion = useReducedMotion();
    return (
        <motion.div
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.6, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: 6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            style={{ transformOrigin: 'bottom right' }}
            className="pointer-events-none absolute bottom-[calc(100%-22px)] right-[calc(100%-12px)]"
        >
            <div className="flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-2 shadow-lg">
                {[0, 1, 2].map(index => (
                    <motion.span
                        key={index}
                        className="size-1.5 rounded-full bg-primary"
                        animate={reduceMotion ? undefined : { y: [0, -3, 0], opacity: [0.45, 1, 0.45] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.15, ease: 'easeInOut' }}
                    />
                ))}
            </div>
            <span className="absolute -bottom-2 right-0 size-2.5 rounded-full border border-border bg-surface shadow-sm" />
            <span className="absolute -bottom-4 -right-1.5 size-1.5 rounded-full border border-border bg-surface" />
        </motion.div>
    );
}

// Public, sign-in and marketing pages never show the bot (prefix match, like proxy.ts).
const HIDDEN_PATH_PREFIXES = [
    '/login', '/signup', '/forgot-password', '/reset-password', '/join', '/q', '/a/', '/kiosk',
    '/onboard', '/onboarding', '/landing', '/landing_animation', '/privacy', '/privacy-policy',
    '/terms', '/data-deletion', '/waiting-approval', '/cc-preview', '/design-lab', '/loader-test',
    '/test-loader', '/simple-test',
];

function isHiddenPath(pathname: string | null): boolean {
    if (!pathname || pathname === '/') return true;
    return HIDDEN_PATH_PREFIXES.some(prefix =>
        prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

/**
 * Floating HR policy assistant, bottom-right on every signed-in page (mounted once in the root
 * layout). Self-gates: renders nothing on public pages, or until the server confirms the user
 * is an employee or staff member.
 */
export default function HrAssistantBot() {
    const { user, membership } = useAuth();
    const params = useParams();
    const pathname = usePathname();
    // /procurement, /property/... and /org/... have no [orgId] segment, so fall back to the
    // user's own organisation for the HR documents link.
    const orgId =
        (params?.orgId as string | undefined) ?? membership?.org_id ?? membership?.properties?.[0]?.organization_id ?? undefined;
    const [access, setAccess] = useState<HrAccess | null>(null);
    // Reopen only for the same user who left it open.
    const [open, setOpenState] = useState(() => wasOpen && openFor === user?.id);
    const [hovered, setHovered] = useState(false);
    const [greeting, setGreeting] = useState(false);
    const pending = useHrChatPending();
    const reduceMotion = useReducedMotion();
    const squash = useAnimationControls();
    const canUse = Boolean(user && access?.canUse && !isHiddenPath(pathname));

    const setOpen = (next: boolean) => {
        wasOpen = next;
        openFor = user?.id ?? null;
        setOpenState(next);
        if (next) {
            markGreeted();
            setGreeting(false);
        }
    };

    // Jelly squash-and-stretch on the bot, then open the window.
    const toggle = async () => {
        if (open) {
            setOpen(false);
            return;
        }
        if (!reduceMotion) {
            await squash.start(
                { scaleX: [1, 1.16, 0.92, 1.04, 1], scaleY: [1, 0.84, 1.08, 0.98, 1] },
                { duration: 0.42, ease: 'easeOut' },
            );
        }
        setOpen(true);
    };

    useEffect(() => {
        if (!user?.id) return;
        claimHrChat(user.id);
        let cancelled = false;
        void loadAccess(user.id).then(result => {
            if (!cancelled) setAccess(result);
        });
        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    useEffect(() => {
        if (!canUse || open || alreadyGreeted()) return;
        const timer = window.setTimeout(() => {
            markGreeted();
            setGreeting(true);
        }, GREETING_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [canUse, open]);

    useEffect(() => {
        if (!greeting) return;
        const timer = window.setTimeout(() => setGreeting(false), GREETING_VISIBLE_MS);
        return () => window.clearTimeout(timer);
    }, [greeting]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                wasOpen = false;
                setOpenState(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open]);

    if (!user || !access || !canUse) return null;

    // BD Super Admins have the CRM ⇄ FMS pill at bottom-5 right-5; sit just above it.
    const raised = isBdSuperAdmin(user.email, membership?.org_role);
    const documentsHref = access.isAdmin && orgId ? `/${orgId}/hr-assistant/documents` : null;
    // Sized from the viewport: ~a quarter of the width and ~70% of the height, clamped, and never
    // taller than the space above the launcher (1rem gap at the top), so it always fits on screen.
    const windowBottom = raised ? '10rem' : '6rem';
    const windowSize = {
        transformOrigin: 'bottom right',
        '--hr-win-w': 'min(420px, max(320px, 25vw), calc(100vw - 2.5rem))',
        '--hr-win-h': `min(640px, max(380px, 70vh), calc(100dvh - ${windowBottom} - 1rem))`,
    } as CSSProperties;
    const showGreeting = greeting && !open && !pending;
    const showTooltip = hovered && !open && !showGreeting && !pending;
    const mood: BotMood = pending ? 'thinking' : hovered || showGreeting ? 'happy' : 'idle';

    return (
        <>
            <AnimatePresence>
                {open && (
                    <motion.div
                        id="hr-assistant-window"
                        role="dialog"
                        aria-label={BOT_TITLE}
                        initial={{ opacity: 0, y: 24, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 24, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                        style={windowSize}
                        className={`fixed inset-0 z-[65] overflow-hidden bg-surface shadow-2xl sm:inset-auto sm:right-5 sm:h-[var(--hr-win-h)] sm:w-[var(--hr-win-w)] sm:rounded-2xl sm:border sm:border-border ${
                            raised ? 'sm:bottom-40' : 'sm:bottom-24'
                        }`}
                    >
                        <HrAssistantChat documentsHref={documentsHref} onClose={() => setOpen(false)} />
                    </motion.div>
                )}
            </AnimatePresence>

            <div
                className={`fixed right-5 z-[65] flex items-end gap-3 ${raised ? 'bottom-20' : 'bottom-5'} ${
                    open ? 'max-sm:hidden' : ''
                }`}
            >
                <AnimatePresence>
                    {showGreeting && (
                        <motion.aside
                            key="greeting"
                            aria-label={`${BOT_NAME} greeting`}
                            initial={{ opacity: 0, scale: 0.85, x: 12 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9, x: 8 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                            style={{ transformOrigin: 'bottom right' }}
                            className="relative mb-3 w-60 max-w-[calc(100vw-7rem)] rounded-2xl rounded-br-sm border border-border bg-surface p-3.5 pr-8 shadow-xl"
                        >
                            <span
                                aria-hidden="true"
                                className="absolute -right-[7px] bottom-3 size-3 rotate-45 border-r border-t border-border bg-surface"
                            />
                            <button
                                type="button"
                                onClick={() => setGreeting(false)}
                                aria-label={`Dismiss ${BOT_NAME} greeting`}
                                className="absolute right-2 top-2 rounded-md p-1 text-text-tertiary transition hover:bg-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                <X className="size-3.5" aria-hidden />
                            </button>
                            <p className="font-display text-sm font-semibold text-text-primary">Hi, I&apos;m {BOT_NAME}! Got an HR question?</p>
                            <p className="mt-0.5 text-xs leading-snug text-text-secondary">
                                Ask me about leave, WFH or notice period.
                            </p>
                            <button
                                type="button"
                                onClick={() => void toggle()}
                                className="mt-2.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                                Ask a question
                            </button>
                        </motion.aside>
                    )}
                    {showTooltip && (
                        <motion.span
                            key="tooltip"
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 8 }}
                            className="mb-4 hidden whitespace-nowrap rounded-2xl rounded-br-sm border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary shadow-lg sm:block"
                        >
                            Hi, I&apos;m {BOT_NAME}! Ask me about HR policy
                        </motion.span>
                    )}
                </AnimatePresence>

                <div className="relative">
                    <AnimatePresence>{pending && <ThoughtCloud key="thinking" />}</AnimatePresence>
                    {/* soft pulsing halo behind the bot */}
                    <motion.span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-1 rounded-full bg-primary/30 blur-xl"
                        animate={reduceMotion ? undefined : { opacity: [0.5, 0.9, 0.5], scale: [0.9, 1.08, 0.9] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <motion.button
                        type="button"
                        onClick={() => void toggle()}
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => setHovered(false)}
                        onFocus={() => setHovered(true)}
                        onBlur={() => setHovered(false)}
                        aria-label={open ? `Close ${BOT_NAME}, the HR assistant` : `Open ${BOT_NAME}, the HR assistant`}
                        aria-expanded={open}
                        aria-controls="hr-assistant-window"
                        initial={{ y: 0 }}
                        animate={reduceMotion ? undefined : { y: [0, -10, 0, -4, 0] }}
                        transition={{ duration: 0.9, delay: 0.6, ease: 'easeOut' }}
                        whileHover={{ scale: 1.08, rotate: -6 }}
                        className="relative flex size-16 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/60"
                    >
                        <motion.span animate={squash} className="flex" style={{ transformOrigin: '50% 90%' }}>
                            <BotFace className="size-14" interactive mood={mood} />
                        </motion.span>
                    </motion.button>
                </div>
            </div>
        </>
    );
}
