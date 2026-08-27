'use client';

import React from 'react';

/**
 * Live/Demo provenance tag for Command Center cards.
 *
 * Green dot + "Live"  — the numbers on the card came from a real fetch.
 * Amber dot + "Demo"  — the card is rendering its mock fallback (mockData*).
 *
 * Rendered inside the .cc-head-meta slot of each card header. Uses the existing
 * .cc-dot classes from globals.css; no stylesheet changes.
 */
export default function SourceTag({ live }: { live: boolean }) {
  return (
    <span
      title={live ? 'Live data from the API' : 'Demo data — no live source wired'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 8.5,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: live ? 'var(--cc-green)' : 'var(--cc-amber)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className={`cc-dot ${live ? 'cc-dot--green' : 'cc-dot--amber'}`}
        style={{ width: 6, height: 6, boxShadow: 'none', flex: 'none' }}
      />
      {live ? 'Live' : 'Demo'}
    </span>
  );
}
