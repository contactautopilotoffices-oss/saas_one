// Mock data for Row 3 (Intelligence) and Row 4 (Bottom) of the Command Center.
// Isolated so each card can be swapped 1:1 with real fetches later.

export const ELECTRICITY = {
  status: 'Healthy',
  delta: '↓ 8%',
  deltaLabel: 'vs last month',
  todayValue: '3,120 kWh',
  todayLabel: "Today's consumption",
  // 24 hourly points (relative load, 0–100)
  spark: [30, 26, 24, 22, 24, 30, 42, 55, 66, 72, 68, 74, 80, 76, 70, 66, 62, 68, 78, 84, 72, 58, 44, 34],
  ticks: ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'],
  footer: [
    { label: 'Projected Bill', value: '₹8.7L' },
    { label: 'vs Last Month', value: '₹9.3L' },
    { label: 'Savings', value: '₹60K', color: 'var(--cc-green)' },
    { label: 'Top Consumer', value: 'HVAC (41%)' },
    { label: 'Confidence', value: '97%' },
  ],
};

export const WATER = {
  status: 'Low Risk',
  delta: '↓ 11%',
  deltaLabel: 'vs last week',
  todayValue: '45,600 Ltrs',
  todayLabel: "Today's usage",
  // 24 hourly bars (relative, 0–100)
  bars: [22, 18, 15, 14, 18, 30, 52, 70, 84, 76, 60, 66, 88, 72, 55, 48, 44, 58, 74, 90, 68, 50, 36, 26],
  ticks: ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'],
  footer: [
    { label: 'Expected Bill', value: '₹2.3L' },
    { label: 'vs Last Week', value: '₹2.6L' },
    { label: 'Savings', value: '₹30K', color: 'var(--cc-green)' },
    { label: 'Highest Use Area', value: 'Kitchen (28%)' },
    { label: 'Leak Probability', value: 'Low' },
  ],
};

export const PPM = {
  completedPct: 81,
  dueToday: 14,
  overdue: 5,
  footer: [
    { label: 'Target', value: '95%' },
    { label: 'Next 7 Days', value: '27' },
    { label: 'Most Critical Asset', value: 'DG Generator' },
    { label: 'Last Serviced', value: '62 days ago' },
  ],
};

export const MATERIAL_REQUESTS = {
  total: 99,
  delayed: 21,
  critical: 8,
  avgFulfilment: '2.7 days',
  spark: [40, 46, 38, 52, 44, 60, 55, 48, 58, 50, 62, 54],
  footer: [
    { label: 'Top Pending Category', value: 'Electrical' },
    { label: 'Vendor causing delay', value: 'ABC Lighting' },
  ],
};

export const PURCHASE_ORDERS = {
  total: 402,
  awaitingApproval: 18,
  awaitingVendor: 29,
  pipelineValue: '₹5.6Cr',
  pipelinePct: 72,
  footer: [
    { label: 'Completed This Month', value: '355' },
    { label: 'Cancelled', value: '6' },
  ],
};

export const BUDGET = {
  legend: [
    { label: 'Actual', color: 'var(--cc-green)' },
    { label: 'Budget', color: '#9aa8ae' },
    { label: 'Forecast', color: 'var(--cc-amber)' },
  ],
  dates: ['1 Jul', '8 Jul', '15 Jul', '22 Jul', '29 Jul', '5 Aug', '12 Aug', '19 Aug', '26 Aug', '31 Aug'],
  yLabels: ['₹2.5Cr', '₹2Cr', '₹1.5Cr', '₹1Cr', '₹0'],
  // normalized 0–100, y up
  actual: [8, 16, 24, 33, 41, 50, 58, 66, 74],
  budget: [10, 20, 30, 40, 50, 60, 70, 80, 90],
  forecast: [74, 80, 87, 94],
  monthProgress: '72%',
  forecastUtilization: '94%',
  projectedOverspend: '₹13.8L',
};

export const DG = {
  statusLabel: 'All Generators',
  status: 'Normal',
  counts: [
    { label: 'Running', value: 2, color: 'var(--cc-green)' },
    { label: 'Standby', value: 4, color: 'var(--cc-blue)' },
    { label: 'Fault', value: 0, color: 'var(--cc-red)' },
  ],
};

export const MAIL_DIGEST = [
  {
    vendor: 'Dell Technologies',
    issue: 'Quotation approval pending',
    time: '1h ago',
    severity: 'High',
    pill: 'cc-pill--high',
  },
  {
    vendor: 'Godrej & Boyce',
    issue: 'Vendor escalation – urgent',
    time: '4h ago',
    severity: 'High',
    pill: 'cc-pill--high',
  },
  {
    vendor: 'Schneider Electric',
    issue: 'Invoice mismatch',
    time: 'Yesterday',
    severity: 'Medium',
    pill: 'cc-pill--medium',
  },
  {
    vendor: 'Amazon Business',
    issue: 'Delivery update required',
    time: 'Yesterday',
    severity: 'Low',
    pill: 'cc-pill--low',
  },
];
