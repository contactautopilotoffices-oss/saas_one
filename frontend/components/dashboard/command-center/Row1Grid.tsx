'use client';

import React from 'react';
import HealthScoreCard from './HealthScoreCard';
import AiBriefCard from './AiBriefCard';
import PortfolioOverviewCard from './PortfolioOverviewCard';

export default function Row1Grid() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 14,
        alignItems: 'stretch',
      }}
    >
      <HealthScoreCard />
      <AiBriefCard />
      <PortfolioOverviewCard />
    </div>
  );
}
