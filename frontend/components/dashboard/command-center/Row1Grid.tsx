'use client';

import React from 'react';
import HealthScoreCard from './HealthScoreCard';
import AlertsCard from './AlertsCard';
import PortfolioOverviewCard from './PortfolioOverviewCard';

export default function Row1Grid({
  orgId,
  propertyId,
}: {
  orgId?: string | null;
  propertyId?: string | null;
} = {}) {
  return (
    <div
      // Columns come from .cc-band-hero (container query on .cc-board): 3 → 2 + full → 1.
      className="cc-band-hero"
      style={{
        display: 'grid',
        gap: 14,
        alignItems: 'stretch',
      }}
    >
      <HealthScoreCard />
      <AlertsCard orgId={orgId ?? null} propertyId={propertyId ?? null} />
      <PortfolioOverviewCard />
    </div>
  );
}
