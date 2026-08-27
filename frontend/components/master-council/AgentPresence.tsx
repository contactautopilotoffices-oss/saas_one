'use client';

/**
 * AgentPresence — one holographic agent tile in the chamber.
 *
 * Three states: dim (idle), lit (opinion landed), speaking (the one element in
 * the chamber allowed to pulse — calm-tech rule: CouncilChamber guarantees at
 * most one presence is `speaking` at any moment).
 *
 * Chrome lives in app/globals.css `.council-tile` (see the [council:begin]
 * block): vercel's stacked-shadow ladder + inset hairline ring, linear.app's
 * surface ladder and top-edge highlight, and exactly ONE chromatic gesture —
 * the agent hue, carried by the rim + the 2px top edge + the monogram.
 * Text tiers are --council-ink-1/2/3, all measured at AA or better against
 * the lightest point of the chamber canvas.
 */

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { CouncilAgent } from './fixtures';
import AgentAvatar from './AgentAvatar';

export type PresenceState = 'dim' | 'lit' | 'speaking';

const EASE = [0.19, 1, 0.22, 1] as const;

/** Split at the @ so the address wraps on a meaningful boundary and is never
 *  clipped. The tile is ~272px wide; the full string cannot fit on one line at
 *  a readable size, and an ellipsised address is worthless. */
function splitEmail(email: string): [string, string] {
  const i = email.indexOf('@');
  if (i < 0) return [email, ''];
  return [email.slice(0, i + 1), email.slice(i + 1)];
}

export default function AgentPresence({
  agent,
  state,
  label,
  findingsCount,
  onClick,
  onCall,
}: {
  agent: CouncilAgent;
  state: PresenceState;
  /** Anonymized stage-2 handle, e.g. "Agent A". */
  label?: string | null;
  findingsCount?: number;
  onClick?: () => void;
  /** Starts a 1:1 voice call with this member (renders the phone chip). */
  onCall?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const lit = state !== 'dim';
  const speaking = state === 'speaking';
  const [local, domain] = splitEmail(agent.email);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={false}
      /* Idle state is carried by ink tiers and the hue ring only — never by
         fading the tile: a real person's photo at 70% opacity reads as a
         rendering bug, not as "idle". */
      animate={{ opacity: 1 }}
      transition={{ duration: 0.9, ease: EASE }}
      className="council-tile"
      data-lit={lit ? 'true' : 'false'}
      style={
        {
          '--council-agent': agent.color,
          cursor: onClick ? 'pointer' : 'default',
        } as React.CSSProperties
      }
    >
      {/* Speaking halo — the chamber's single pulse. */}
      {speaking && !reduceMotion && (
        <motion.span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 12,
            pointerEvents: 'none',
            boxShadow: `inset 0 0 0 1px ${agent.color}, inset 0 0 26px -6px ${agent.color}`,
          }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {/* Static halo under reduced motion: state survives without animation. */}
      {speaking && reduceMotion && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 12,
            pointerEvents: 'none',
            boxShadow: `inset 0 0 0 1px ${agent.color}, inset 0 0 26px -6px ${agent.color}`,
          }}
        />
      )}

      <AgentAvatar agent={agent} />

      <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, paddingRight: 30 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.3,
              letterSpacing: '-0.01em',
              color: lit ? 'var(--council-ink-1)' : 'var(--council-ink-2)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {agent.name}
          </span>
          {label && (
            <span
              style={{
                flex: 'none',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--council-ink-2)',
                boxShadow: `inset 0 0 0 1px ${
                  lit ? `color-mix(in srgb, ${agent.color} 60%, transparent)` : 'rgba(30, 42, 48, 0.10)'
                }`,
                borderRadius: 999,
                padding: '2px 7px',
              }}
            >
              {label}
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 500,
            lineHeight: 1.4,
            color: 'var(--council-ink-2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {agent.title}
        </span>
        <span className="council-email" title={agent.email}>
          <span>{local}</span>
          <span>{domain}</span>
        </span>
      </span>

      {/* 1:1 call chip — a span, not a button: the tile itself is a button and
          nested buttons are invalid HTML. */}
      {onCall && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Call ${agent.name}`}
          title={`Call ${agent.name} — 1:1 voice`}
          onClick={(e) => {
            e.stopPropagation();
            onCall();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onCall();
            }
          }}
          style={{
            position: 'absolute',
            bottom: 11,
            right: 12,
            width: 28,
            height: 28,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: lit ? 'var(--council-ink-1)' : 'var(--council-ink-2)',
            background: `color-mix(in srgb, ${agent.color} ${lit ? 20 : 10}%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${agent.color} ${lit ? 50 : 28}%, transparent)`,
            transition: 'all 300ms cubic-bezier(0.19, 1, 0.22, 1)',
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </span>
      )}

      {typeof findingsCount === 'number' && findingsCount > 0 && (
        <span
          style={{
            /* Taken out of flow so the address below it gets the full column
               width and never has to be clipped. */
            position: 'absolute',
            top: 13,
            right: 14,
            fontSize: 10.5,
            fontWeight: 700,
            lineHeight: 1.4,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--council-ink-1)',
            background: lit
              ? `color-mix(in srgb, ${agent.color} 34%, transparent)`
              : 'rgba(30, 42, 48, 0.05)',
            boxShadow: `inset 0 0 0 1px ${
              lit ? `color-mix(in srgb, ${agent.color} 55%, transparent)` : 'rgba(30, 42, 48, 0.10)'
            }`,
            borderRadius: 999,
            padding: '1px 8px',
          }}
          title={`${findingsCount} findings`}
        >
          {findingsCount}
        </span>
      )}
    </motion.button>
  );
}
