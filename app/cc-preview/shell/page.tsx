'use client';

import { Suspense } from 'react';

import CommandCenterShell from '@/frontend/components/dashboard/command-center/CommandCenterShell';
import {
  HeartPulse,
  Sparkles,
  Building2,
  Zap,
  ArrowUpRight,
} from 'lucide-react';


export default function ShellPreview() {
  return (
    <Suspense fallback={<div style={{padding:24,fontFamily:'system-ui'}}>Loading preview…</div>}>
      <CommandCenterShell userName="Saniel Golechha" userEmail="superadmin@autopilot.com">
        {/* Row 1 — 3 skeleton cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 20 }}>
          <div className="cc-card">
            <div className="cc-card-head">
              <span className="cc-chip cc-chip--green"><HeartPulse /></span>
              <span className="cc-title">Operations Health Score</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="cc-metric cc-metric--lg">94<small> /100</small></span>
              <span className="cc-pill cc-pill--low">↑ 3 pts vs yesterday</span>
            </div>
            <div className="cc-sub" style={{ marginTop: 6 }}>Your portfolio is performing well</div>
            <div className="cc-statstrip">
              <div className="cc-stat cc-stat--red"><span className="cc-stat-val">4</span><span className="cc-stat-label">Buildings need attention</span></div>
              <div className="cc-stat"><span className="cc-stat-val">2</span><span className="cc-stat-label">Critical issues</span></div>
              <div className="cc-stat cc-stat--teal"><span className="cc-stat-val">₹2.4L</span><span className="cc-stat-label">Est. financial exposure</span></div>
              <div className="cc-stat cc-stat--green"><span className="cc-stat-val">18</span><span className="cc-stat-label">Positive updates</span></div>
            </div>
          </div>

          <div className="cc-card">
            <div className="cc-card-head">
              <span className="cc-chip cc-chip--purple"><Sparkles /></span>
              <span className="cc-title">AI Brief</span>
              <span className="cc-head-meta">Updated 10 min ago</span>
            </div>
            <p className="cc-sub" style={{ margin: '0 0 8px' }}>
              Whitefield electricity has <b style={{ color: 'var(--cc-red)' }}>risen 18%</b> for three
              consecutive days, primarily driven by HVAC usage after 8 PM.
            </p>
            <p className="cc-sub" style={{ margin: '0 0 12px' }}>
              Purchase approvals are pending for <b>₹1.8Cr</b> across 7 requests.
            </p>
            <button className="cc-btn" type="button" style={{ alignSelf: 'flex-start' }}>View full brief</button>
          </div>

          <div className="cc-card">
            <div className="cc-card-head">
              <span className="cc-chip cc-chip--teal"><Building2 /></span>
              <span className="cc-title">Portfolio Overview</span>
              <span className="cc-head-meta"><a href="#" onClick={(e) => e.preventDefault()}>View All Buildings</a></span>
            </div>
            {[
              { dot: 'cc-dot--red', name: 'Whitefield Tower', sub: 'Bangalore', score: 82, c: 'var(--cc-red)' },
              { dot: 'cc-dot--green', name: 'BKC Center', sub: 'Mumbai', score: 98, c: 'var(--cc-green)' },
              { dot: 'cc-dot--amber', name: 'Pune Tech Park', sub: 'Pune', score: 90, c: 'var(--cc-amber)' },
            ].map((r) => (
              <div className="cc-listrow" key={r.name}>
                <span className={`cc-dot ${r.dot}`} />
                <div className="cc-listrow-main">
                  <div className="cc-listrow-name">{r.name}</div>
                  <div className="cc-listrow-sub">{r.sub}</div>
                </div>
                <span className="cc-listrow-right" style={{ color: r.c }}>{r.score}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Row 2 — pill variants + ghost button + metric */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
          <div className="cc-card">
            <div className="cc-card-head">
              <span className="cc-chip cc-chip--red"><Zap /></span>
              <span className="cc-title">Electricity Alert</span>
              <span className="cc-head-meta"><span className="cc-badge">5</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="cc-metric" style={{ color: 'var(--cc-red)' }}>18%</span>
              <span className="cc-sub">vs 28-day average</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <span className="cc-pill cc-pill--high">High</span>
                <span className="cc-pill cc-pill--medium">Medium</span>
                <span className="cc-pill cc-pill--low">Low</span>
                <span className="cc-pill cc-pill--ok">Healthy</span>
              </span>
            </div>
            <div className="cc-statstrip" style={{ alignItems: 'center' }}>
              <div className="cc-stat"><span className="cc-stat-label">Whitefield Tower</span></div>
              <div className="cc-stat" style={{ alignItems: 'flex-end' }}>
                <button className="cc-btn" type="button">Investigate <ArrowUpRight /></button>
              </div>
            </div>
          </div>

          <div className="cc-card">
            <div className="cc-card-head">
              <span className="cc-chip cc-chip--blue"><Sparkles /></span>
              <span className="cc-title">PPM Compliance</span>
              <span className="cc-head-meta"><span className="cc-pill cc-pill--ok">On Track</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="cc-metric">81%</span>
              <span className="cc-sub">Completed</span>
            </div>
            <div className="cc-statstrip">
              <div className="cc-stat"><span className="cc-stat-val">14</span><span className="cc-stat-label">Due Today</span></div>
              <div className="cc-stat cc-stat--red"><span className="cc-stat-val">5</span><span className="cc-stat-label">Overdue</span></div>
              <div className="cc-stat cc-stat--amber"><span className="cc-stat-val">27</span><span className="cc-stat-label">Next 7 Days</span></div>
              <div className="cc-stat" style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                <button className="cc-btn-ghost" type="button">View Schedule</button>
              </div>
            </div>
          </div>
        </div>
      </CommandCenterShell>
    </Suspense>
  );
}
