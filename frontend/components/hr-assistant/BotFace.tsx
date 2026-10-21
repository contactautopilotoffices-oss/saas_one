'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { useEffect, useId, useRef } from 'react';

export type BotMood = 'idle' | 'happy' | 'thinking';

interface BotFaceProps {
    className?: string;
    /** Launcher only: eyes follow the cursor and the head bobs. Small avatars leave this off. */
    interactive?: boolean;
    mood?: BotMood;
}

// How far (in viewBox units) the eyes may wander from centre when tracking the cursor.
const EYE_REACH_X = 2.6;
const EYE_REACH_Y = 2;
// Cursor distance (px) at which the eyes reach their full offset.
const FULL_REACH_PX = 260;
// Where the eyes rest while thinking: up and to the left, towards the thought cloud.
const THINKING_GAZE = { x: -2.2, y: -1.9 };

const blinkTransition = { duration: 4.2, times: [0, 0.9, 0.93, 0.96, 1], repeat: Infinity };

/**
 * The HR assistant's mascot: a glossy teal robot head with a gold antenna and a dark visor.
 * Decorative only. Gradient ids are scoped per instance so several bots can share a page.
 */
export function BotFace({ className = '', interactive = false, mood = 'idle' }: BotFaceProps) {
    const reduceMotion = useReducedMotion();
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const id = (name: string) => `bot-${uid}-${name}`;
    const svgRef = useRef<SVGSVGElement>(null);

    const animated = interactive && !reduceMotion;
    const tracking = animated && mood !== 'thinking';

    const gazeX = useMotionValue(0);
    const gazeY = useMotionValue(0);
    const eyeX = useSpring(gazeX, { stiffness: 260, damping: 24 });
    const eyeY = useSpring(gazeY, { stiffness: 260, damping: 24 });
    // The visor slides a little less than the eyes, which reads as depth.
    const faceX = useTransform(eyeX, value => value * 0.4);
    const faceY = useTransform(eyeY, value => value * 0.4);

    useEffect(() => {
        if (mood === 'thinking' && !reduceMotion) {
            gazeX.set(THINKING_GAZE.x);
            gazeY.set(THINKING_GAZE.y);
            return;
        }
        if (!tracking) {
            gazeX.set(0);
            gazeY.set(0);
            return;
        }

        let frame = 0;
        let pointer: { x: number; y: number } | null = null;

        const update = () => {
            frame = 0;
            const rect = svgRef.current?.getBoundingClientRect();
            if (!rect || !pointer) return;
            const dx = pointer.x - (rect.left + rect.width / 2);
            const dy = pointer.y - (rect.top + rect.height * 0.55);
            const distance = Math.hypot(dx, dy) || 1;
            const reach = Math.min(1, distance / FULL_REACH_PX);
            gazeX.set((dx / distance) * reach * EYE_REACH_X);
            gazeY.set((dy / distance) * reach * EYE_REACH_Y);
        };

        const onPointerMove = (event: PointerEvent) => {
            pointer = { x: event.clientX, y: event.clientY };
            if (!frame) frame = requestAnimationFrame(update);
        };

        window.addEventListener('pointermove', onPointerMove, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            if (frame) cancelAnimationFrame(frame);
            gazeX.set(0);
            gazeY.set(0);
        };
    }, [tracking, mood, reduceMotion, gazeX, gazeY]);

    const blink = reduceMotion || mood === 'happy' ? undefined : { scaleY: [1, 1, 0.1, 1, 1] };
    const bob = animated ? { y: [0, -2.4, 0] } : undefined;
    const bobShadow = animated ? { scale: [1, 0.82, 1], opacity: [0.9, 0.6, 0.9] } : undefined;
    const bobTransition = { duration: 3.2, repeat: Infinity, ease: 'easeInOut' as const };

    return (
        <svg ref={svgRef} viewBox="0 0 64 64" className={`overflow-visible ${className}`} aria-hidden="true">
            <defs>
                {/* body: lit from the upper left, rolling off into primary-dark */}
                <radialGradient id={id('body')} cx="36%" cy="26%" r="80%">
                    <stop offset="0" style={{ stopColor: 'var(--primary-light)' }} />
                    <stop offset="0.55" style={{ stopColor: 'var(--primary)' }} />
                    <stop offset="1" style={{ stopColor: 'var(--primary-dark)' }} />
                </radialGradient>
                {/* soft inner shadow along the lower edge */}
                <linearGradient id={id('shade')} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0.55" stopColor="#0B1A20" stopOpacity="0" />
                    <stop offset="1" stopColor="#0B1A20" stopOpacity="0.32" />
                </linearGradient>
                {/* rim light: bright on top, fading out by the chin */}
                <linearGradient id={id('rim')} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
                    <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.15" />
                    <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.4" />
                </linearGradient>
                <radialGradient id={id('spec')} cx="50%" cy="50%" r="50%">
                    <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
                    <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                </radialGradient>
                <linearGradient id={id('ear')} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" style={{ stopColor: 'var(--primary)' }} />
                    <stop offset="1" style={{ stopColor: 'var(--primary-dark)' }} />
                </linearGradient>
                {/* dark glass visor */}
                <linearGradient id={id('visor')} x1="0" y1="0" x2="0.35" y2="1">
                    <stop offset="0" stopColor="#24343F" />
                    <stop offset="1" stopColor="#0C141A" />
                </linearGradient>
                <radialGradient id={id('gold')} cx="35%" cy="32%" r="70%">
                    <stop offset="0" style={{ stopColor: 'var(--secondary-light)' }} />
                    <stop offset="0.6" style={{ stopColor: 'var(--secondary)' }} />
                    <stop offset="1" style={{ stopColor: 'var(--secondary-dark)' }} />
                </radialGradient>
                <radialGradient id={id('eyeGlow')} cx="50%" cy="50%" r="50%">
                    <stop offset="0" style={{ stopColor: 'var(--primary-light)' }} stopOpacity="0.75" />
                    <stop offset="1" style={{ stopColor: 'var(--primary-light)' }} stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id('ground')} cx="50%" cy="50%" r="50%">
                    <stop offset="0" stopColor="#0B1A20" stopOpacity="0.38" />
                    <stop offset="1" stopColor="#0B1A20" stopOpacity="0" />
                </radialGradient>
            </defs>

            {/* contact shadow: shrinks as the head rises */}
            <motion.ellipse
                cx="32"
                cy="60.5"
                rx="17"
                ry="2.8"
                fill={`url(#${id('ground')})`}
                animate={bobShadow}
                transition={bobTransition}
            />

            <motion.g animate={bob} transition={bobTransition}>
                {/* antenna */}
                <rect x="30.6" y="8" width="2.8" height="8" rx="1.4" fill={`url(#${id('ear')})`} />
                <circle cx="32" cy="6.5" r="4.4" fill={`url(#${id('gold')})`} />
                <ellipse cx="30.6" cy="5" rx="1.5" ry="1.1" fill="#FFFFFF" opacity="0.75" />

                {/* ears */}
                <rect x="3.5" y="27" width="7" height="16" rx="3.5" fill={`url(#${id('ear')})`} />
                <rect x="53.5" y="27" width="7" height="16" rx="3.5" fill={`url(#${id('ear')})`} />
                <rect x="5" y="29" width="2" height="6" rx="1" fill="#FFFFFF" opacity="0.35" />
                <rect x="55" y="29" width="2" height="6" rx="1" fill="#FFFFFF" opacity="0.35" />

                {/* head */}
                <rect x="9" y="14.5" width="46" height="41" rx="17" fill={`url(#${id('body')})`} />
                <rect x="9" y="14.5" width="46" height="41" rx="17" fill={`url(#${id('shade')})`} />
                <rect
                    x="9.75"
                    y="15.25"
                    width="44.5"
                    height="39.5"
                    rx="16.25"
                    fill="none"
                    stroke={`url(#${id('rim')})`}
                    strokeWidth="1.5"
                />
                {/* specular highlight */}
                <ellipse cx="21" cy="20" rx="8" ry="3.4" fill={`url(#${id('spec')})`} transform="rotate(-18 21 20)" />

                {/* face: visor, eyes, mouth; drifts slightly with the gaze */}
                <motion.g style={{ x: faceX, y: faceY }}>
                    <rect x="14.5" y="22" width="35" height="25.5" rx="11.5" fill={`url(#${id('visor')})`} />
                    <rect
                        x="14.5"
                        y="22"
                        width="35"
                        height="25.5"
                        rx="11.5"
                        fill="none"
                        stroke="#0B1A20"
                        strokeOpacity="0.35"
                        strokeWidth="1"
                    />
                    {/* glass reflection */}
                    <path d="M18.5 30 Q19 25 25 24.5 L29 24.5 Q22 26.5 20.5 31 Z" fill="#FFFFFF" opacity="0.22" />

                    <motion.g style={{ x: eyeX, y: eyeY }}>
                        <ellipse cx="25" cy="34" rx="6" ry="6" fill={`url(#${id('eyeGlow')})`} />
                        <ellipse cx="39" cy="34" rx="6" ry="6" fill={`url(#${id('eyeGlow')})`} />
                        {mood === 'happy' ? (
                            <g stroke="#EAF4F6" strokeWidth="2.6" strokeLinecap="round" fill="none">
                                <path d="M21.5 35.5 Q25 30 28.5 35.5" />
                                <path d="M35.5 35.5 Q39 30 42.5 35.5" />
                            </g>
                        ) : (
                            <motion.g animate={blink} transition={blinkTransition}>
                                <ellipse
                                    cx="25"
                                    cy="34"
                                    rx={mood === 'thinking' ? 2.8 : 3.4}
                                    ry={mood === 'thinking' ? 3.6 : 4.4}
                                    fill="#EAF4F6"
                                />
                                <ellipse
                                    cx="39"
                                    cy="34"
                                    rx={mood === 'thinking' ? 2.8 : 3.4}
                                    ry={mood === 'thinking' ? 3.6 : 4.4}
                                    fill="#EAF4F6"
                                />
                                <circle cx="26.2" cy="32.2" r="1.1" fill="#FFFFFF" />
                                <circle cx="40.2" cy="32.2" r="1.1" fill="#FFFFFF" />
                            </motion.g>
                        )}
                    </motion.g>

                    {/* cheeks */}
                    <ellipse cx="19.5" cy="41" rx="2.4" ry="1.5" fill="#F6B8B0" opacity={mood === 'happy' ? 0.9 : 0.6} />
                    <ellipse cx="44.5" cy="41" rx="2.4" ry="1.5" fill="#F6B8B0" opacity={mood === 'happy' ? 0.9 : 0.6} />

                    {/* mouth */}
                    {mood === 'thinking' ? (
                        <path
                            d="M28 42.5 Q30 41.2 32 42.5 T36 42.5"
                            stroke="#EAF4F6"
                            strokeWidth="2"
                            fill="none"
                            strokeLinecap="round"
                        />
                    ) : mood === 'happy' ? (
                        <path d="M26.5 40.5 Q32 46.5 37.5 40.5 Z" fill="#EAF4F6" strokeLinejoin="round" />
                    ) : (
                        <path
                            d="M27 41 Q32 45 37 41"
                            stroke="#EAF4F6"
                            strokeWidth="2.4"
                            fill="none"
                            strokeLinecap="round"
                        />
                    )}
                </motion.g>
            </motion.g>
        </svg>
    );
}
