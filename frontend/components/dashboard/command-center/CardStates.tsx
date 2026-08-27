'use client';

import React from 'react';

/**
 * Shared loading / empty states for every Command Center card.
 *
 * The defect this file fixes: cards used to render their MOCK values while a fetch was in
 * flight ("nothing ever flashes empty"), which means a fabricated number sat on screen,
 * indistinguishable at a glance from a real one, for as long as the request took. That is
 * never acceptable — a skeleton that says nothing is strictly better than a plausible lie.
 *
 * Every card now has three distinct states:
 *   loading             -> <CardSkeleton />   (shape approximates the card's real layout)
 *   error / unprovisioned -> <CardEmpty reason=".." /> (short, honest, names what's missing)
 *   loaded              -> the real component tree, built from the fetched payload only.
 *
 * Nothing in this file ever renders a number — it is pure chrome.
 */

/** Base shimmer rectangle. Cards compose this into shapes matching their own layout. */
export function SkeletonBlock({
  width = '100%',
  height = 12,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="cc-skel"
      style={{ width, height, borderRadius: radius, flex: 'none', ...style }}
      aria-hidden
    />
  );
}

/**
 * Generic card-body skeleton. Compose only the pieces a given card needs:
 *  - `hero`: a large figure block, for cards whose loaded state leads with one big number.
 *  - `lines`: N tapering text-line placeholders, for prose/footer-grid cards.
 *  - `rows`: N list-row placeholders (avatar + two lines + trailing value), for list cards
 *    like Portfolio Overview and Mail Digest.
 */
export function CardSkeleton({
  hero = false,
  lines = 0,
  rows = 0,
}: {
  hero?: boolean;
  lines?: number;
  rows?: number;
}) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}
      aria-busy="true"
      aria-label="Loading"
    >
      {hero && <SkeletonBlock width={130} height={32} radius={8} />}
      {lines > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: lines }).map((_, i) => (
            <SkeletonBlock key={`l${i}`} width={`${92 - i * 12}%`} height={11} />
          ))}
        </div>
      )}
      {rows > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={`r${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <SkeletonBlock width={26} height={26} radius={999} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SkeletonBlock width="55%" height={10} />
                <SkeletonBlock width="35%" height={9} />
              </div>
              <SkeletonBlock width={30} height={14} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Honest empty state — used both for a hard fetch failure and for a backend
 * `provisioned: false` response. Never paired with a plausible-looking number.
 */
export function CardEmpty({ reason }: { reason: string }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 72,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        textAlign: 'center',
        padding: '16px 10px',
        borderRadius: 10,
        border: '1px dashed var(--cc-hairline)',
        background: 'rgba(30,42,48,0.02)',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cc-ink-2)' }}>No data</span>
      <span className="cc-sub" style={{ maxWidth: 230 }}>{reason}</span>
    </div>
  );
}

/** Standard message when a fetch failed outright (network/HTTP), as opposed to an honest
 *  `provisioned: false` from the backend. Kept in one place so wording stays consistent. */
export function fetchErrorReason(error: string | null): string {
  if (error === 'forbidden') return "You don't have access to this data.";
  return "Couldn't load this data right now.";
}
