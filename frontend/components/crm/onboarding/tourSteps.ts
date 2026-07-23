import type { Step } from 'react-joyride';

// ─── CRM Dashboard Tour ──────────────────────────────────────────────

export const dashboardSteps: Step[] = [
    {
        target: 'body',
        placement: 'center',
        title: 'Welcome to Your CRM',
        content: 'This is your command center for managing leads, tracking deals, and closing more business. We\'ll walk you through everything — once you finish this onboarding, the CRM is all yours.',
        skipBeacon: true,
    },
    {
        target: '[data-tour="crm-stat-tiles"]',
        placement: 'bottom',
        title: 'Your Numbers at a Glance',
        content: 'Three key metrics: Total Leads, New Leads, and Follow-ups Needed. Use the toggle to switch between Today, This Month, and Total — this is how you start every morning.',
    },
    {
        target: '[data-tour="crm-priority-leads"]',
        placement: 'right',
        title: 'Priority Leads',
        content: 'Hot and MQL leads that need your attention right now. These are your highest-chance closures. Click any lead to jump straight into their details.',
    },
    {
        target: '[data-tour="crm-action-leads"]',
        placement: 'left',
        title: 'Action Required',
        content: 'Leads flagged as Future or missing a status land here. These need your immediate attention — don\'t let them slip through the cracks.',
    },
    {
        target: '[data-tour="crm-add-lead"]',
        placement: 'bottom',
        title: 'Adding New Leads',
        content: 'Click here to add a lead manually. For bulk imports, use the Import page from the sidebar. Every lead you add enters at the "MQL" stage by default.',
    },
    {
        target: 'body',
        placement: 'center',
        title: 'Dashboard Complete!',
        content: 'Great — you know your way around the dashboard. Next up: the Leads table, where you\'ll manage your entire pipeline.',
        skipBeacon: true,
    },
];

// ─── Leads Table Tour ────────────────────────────────────────────────

export const leadsTableSteps: Step[] = [
    {
        target: 'body',
        placement: 'center',
        title: 'Your Lead Pipeline',
        content: 'This is where all your leads live. Every company you\'re talking to, every deal in progress — search, filter, sort, and click to dive into details.',
        skipBeacon: true,
    },
    {
        target: '[data-tour="leads-search"]',
        placement: 'bottom',
        title: 'Instant Search',
        content: 'Search by company name, contact person, email, or phone. Results update as you type — no need to press Enter.',
    },
    {
        target: '[data-tour="leads-filters"]',
        placement: 'bottom',
        title: 'Filter by Stage & Priority',
        content: 'Click chips to filter leads by lifecycle stage (MQL, Hot, Cold, etc.) or priority level. Select multiple to combine. This is how you plan your day — filter to "Hot" leads and start calling.',
    },
    {
        target: '[data-tour="leads-table"]',
        placement: 'top',
        title: 'The Lead Table',
        content: 'Each row shows company, contact, status, priority, and next follow-up date. Click any row to open the full lead detail drawer with pipeline, actions, and history.',
    },
    {
        target: '[data-tour="leads-add"]',
        placement: 'bottom',
        title: 'Create a Lead',
        content: 'Click "Add Lead" to create a new one. Fill in company details, contact info, deal value, and assign a team member. The lead starts at "MQL" stage.',
    },
    {
        target: 'body',
        placement: 'center',
        title: 'Leads Table Done!',
        content: 'You\'ve got the table down. Now for the most important part — the lead detail view where you manage stages, log calls, and move deals forward.',
        skipBeacon: true,
    },
];

// ─── Lead Detail & Stage Pipeline Tour ──────────────────────────────

export const leadDetailSteps: Step[] = [
    {
        target: 'body',
        placement: 'center',
        title: 'Understanding Lead Stages',
        content: 'Before we look at the controls, let\'s understand the 13 lifecycle stages every lead moves through. This is the heart of your sales process.',
        skipBeacon: true,
    },
    {
        target: 'body',
        placement: 'center',
        title: '🔥 MQL → Ring 1, 2, 3',
        content: 'Every new lead starts at "MQL." You then make up to 3 call attempts — Ring 1, Ring 2, Ring 3. Each ring is logged so you know exactly where follow-up stands.',
        skipBeacon: true,
    },
    {
        target: 'body',
        placement: 'center',
        title: '❄️ Cold & 🔥 Hot',
        content: 'After your calls: if the lead shows strong interest → move to "Hot" (high priority, pursue aggressively). If they\'re unresponsive after 3 rings → "Cold" (park it, revisit later).',
        skipBeacon: true,
    },
    {
        target: 'body',
        placement: 'center',
        title: '📅 Future',
        content: 'When a lead says "not now, maybe later" → move to "Future." This automatically prompts you to set a follow-up date so it lands on your calendar. Never lose a "maybe" again.',
        skipBeacon: true,
    },
    {
        target: 'body',
        placement: 'center',
        title: '🏆 Won, ❌ Lost & 🚫 Disqualified',
        content: '"Won" = deal closed successfully. "Lost" = deal lost (requires a comment with the reason). "Disqualified" = not a valid MQL lead (also requires a comment). All three are terminal stages.',
        skipBeacon: true,
    },
    {
        target: 'body',
        placement: 'center',
        title: '📍 Site Visit, LOI & Layout',
        content: 'Site visits, LOI (Letter of Intent), and Layout Shared are tracked as timeline activities — not pipeline stages. Use the buttons in the Timeline tab to log them with a comment.',
        skipBeacon: true,
    },
    {
        target: 'body',
        placement: 'center',
        title: 'Free Movement',
        content: 'Important: you can move a lead to ANY stage at any time. There\'s no enforced order — the pipeline is a guide, not a gate. Click any stage circle to jump there instantly.',
        skipBeacon: true,
    },
    {
        target: '[data-tour="lead-pipeline"]',
        placement: 'bottom',
        title: 'The Stage Pipeline',
        content: 'Here it is — the visual pipeline. MQL → Active (Ring 1-10) → Warm → Hot → Future → Cold → Lost / Disqualified / Won. Click any stage to move the lead there.',
    },
    {
        target: '[data-tour="lead-quick-actions"]',
        placement: 'bottom',
        title: 'Quick Actions',
        content: 'Log a call, schedule a meeting, plan a site visit, or set a follow-up — one click each. "Call" is highlighted since it\'s your most frequent action. Every action gets logged to the timeline.',
    },
    {
        target: '[data-tour="lead-tabs"]',
        placement: 'bottom',
        title: 'Overview, Timeline & Notes',
        content: 'Overview = contact info, deal value, property interest. Timeline = every action in chronological order (calls, emails, stage changes, events). Notes = your personal observations.',
    },
    {
        target: '[data-tour="lead-contact-info"]',
        placement: 'right',
        title: 'Contact Details',
        content: 'Phone, email, company, location, deal value, assigned rep — everything you need before picking up the phone. This section also shows the property they\'re interested in.',
    },
    {
        target: 'body',
        placement: 'center',
        title: 'Lead Management Mastered!',
        content: 'You now know how to manage a lead from MQL to Close (or Loss). One more stop — the Calendar, where all your scheduled events live.',
        skipBeacon: true,
    },
];

// ─── Calendar Tour ───────────────────────────────────────────────────

export const calendarSteps: Step[] = [
    {
        target: 'body',
        placement: 'center',
        title: 'Your CRM Calendar',
        content: 'Every call, meeting, site visit, and follow-up you schedule appears here. Events created from leads auto-sync. This is your daily planner.',
        skipBeacon: true,
    },
    {
        target: '[data-tour="calendar-view-toggle"]',
        placement: 'bottom',
        title: 'View Modes',
        content: 'Week view = plan your daily outreach. Month view = see the big picture and spot gaps. Day view = focused execution mode for busy days.',
    },
    {
        target: '[data-tour="calendar-grid"]',
        placement: 'top',
        title: 'Events & Color Coding',
        content: 'Each event is color-coded by type: calls, meetings, site visits, follow-ups. Click any event to see details and jump to the associated lead.',
    },
    {
        target: 'body',
        placement: 'center',
        title: 'You\'re All Set! 🎉',
        content: 'Onboarding complete — you\'ve learned the dashboard, leads table, the pipeline stages, and the calendar. The CRM is now fully unlocked. Go close some deals!',
        skipBeacon: true,
    },
];
