'use client';

/**
 * AgentAvatar — the member's face, with the monogram as a guaranteed fallback.
 *
 * Portraits are static assets at /council/{agent.key}.png (one matched
 * illustration set, generated against the locked palette). The monogram tile
 * is kept as the error fallback so a missing or unloaded portrait can never
 * blank the chamber — identity degrades to initials, not to a hole.
 *
 * Reuses the .council-mono chrome (38px box, radius, agent-hue inset ring)
 * so the portrait sits in exactly the footprint the monogram occupied.
 */

import React from 'react';
import type { CouncilAgent } from './fixtures';
import { agentInitials } from './fixtures';

export default function AgentAvatar({ agent, size }: { agent: CouncilAgent; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  // The ring and wash are carried inline (not only via .council-mono's
  // --council-agent) so the avatar keeps its hue outside .council-tile —
  // FindingsBoard, the transcript and the inbox don't set that variable.
  const chrome = {
    background: `color-mix(in srgb, ${agent.color} 18%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${agent.color} 40%, transparent)`,
  };
  const sizeStyle = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;

  if (failed) {
    return (
      <span className="council-mono" style={{ ...chrome, ...sizeStyle }} title={`${agent.name} — ${agent.title}`}>
        {agentInitials(agent.name)}
      </span>
    );
  }
  return (
    <img
      className="council-mono"
      src={`/council/${agent.key}.png`}
      alt={`${agent.name} — ${agent.title}`}
      title={`${agent.name} — ${agent.title}`}
      onError={() => setFailed(true)}
      style={{ ...chrome, ...sizeStyle, objectFit: 'cover', objectPosition: 'top' }}
    />
  );
}
