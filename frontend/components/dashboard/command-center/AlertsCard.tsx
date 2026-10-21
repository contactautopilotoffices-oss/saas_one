'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { useWidgetData, inr, type WidgetDataState } from '@/frontend/lib/dashboard/useWidgetData';
import { useCommandCenterOrgId } from './mockData';
import { buildNavMap } from './navMap';
import SourceTag from './SourceTag';
import { CardSkeleton } from './CardStates';
import {
  buildAlerts, stillSeen,
  type AlertLevel, type CcAlert, type SeenMark,
  type TicketAlertsFeed, type PaceFeed, type AopFeed, type MailboxFeed, type GeneratorRow, type BillsFeed,
} from './alertRules';

/**
 * Compact Alerts card — mounted in Row 1 (replacing AI Brief).
 *
 * Displays prioritized abnormal conditions with their exact ages/dates,
 * and scrolls smoothly within the standard card height.
 */

const TTL = 5 * 60_000;
const LEVEL_LABEL: Record<AlertLevel, string> = { critical: 'Critical', warning: 'Warning', data: 'Check data' };

function feed<T>(q: WidgetDataState<T>): T | null | undefined {
  if (q.loading) return undefined;
  if (q.error) return null;
  return q.data ?? undefined;
}

function readJson<T>(key: string | null): T | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string | null, value: unknown) {
  if (!key || typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

const memSeen = new Map<string, Record<string, SeenMark>>();
const memKnown = new Map<string, string[]>();

export default function AlertsCard({
  orgId,
  propertyId,
}: {
  orgId?: string | null;
  propertyId?: string | null;
}) {
  const contextOrgId = useCommandCenterOrgId();
  const effectiveOrgId = orgId || contextOrgId;

  const { user } = useAuth();
  const userId = user?.id ?? null;

  const ticketsQ = useWidgetData<TicketAlertsFeed>(effectiveOrgId ? `/api/command-center/ticket-alerts?org_id=${effectiveOrgId}` : null, TTL);
  const paceQ = useWidgetData<PaceFeed>(effectiveOrgId ? `/api/electricity/pace?org_id=${effectiveOrgId}` : null, TTL);
  const aopQ = useWidgetData<AopFeed>(effectiveOrgId ? `/api/aop/summary?org_id=${effectiveOrgId}` : null, TTL);
  const mailboxQ = useWidgetData<MailboxFeed>(effectiveOrgId ? `/api/procurement/mailbox/summary?org_id=${effectiveOrgId}&limit=10` : null, TTL);
  const gensQ = useWidgetData<GeneratorRow[]>(effectiveOrgId ? `/api/organizations/${effectiveOrgId}/generators` : null, TTL);
  const billsQ = useWidgetData<BillsFeed>(effectiveOrgId ? `/api/electricity/tracker?org_id=${effectiveOrgId}` : null, TTL);

  const tickets = feed(ticketsQ);
  const pace = feed(paceQ);
  const aop = feed(aopQ);
  const mailbox = feed(mailboxQ);
  const gensRaw = feed(gensQ);
  const generators = gensRaw === undefined || gensRaw === null ? gensRaw : Array.isArray(gensRaw) ? gensRaw : null;
  const bills = feed(billsQ);
  const feeds = [tickets, pace, aop, mailbox, generators, bills];
  const allLoading = feeds.every(f => f === undefined);
  const anyLoading = feeds.some(f => f === undefined);
  const anyAnswered = feeds.some(f => f !== undefined && f !== null);

  const properties = tickets?.properties;
  const propertyName = propertyId ? properties?.find(p => p.id === propertyId)?.name ?? null : null;

  const result = useMemo(() => {
    const nav = effectiveOrgId ? buildNavMap(effectiveOrgId, propertyId ?? undefined) : null;
    const electricity = nav?.rail.flatMap(s => s.items).find(i => i.label === 'Electricity')?.href;
    return buildAlerts({
      now: new Date(),
      tickets, pace, aop, mailbox, generators, bills,
      propertyId: propertyId ?? null,
      propertyName,
      links: nav ? {
        tickets: nav.cardLinks.viewAllTickets,
        electricity,
        budget: nav.cardLinks.viewBudget,
        dg: nav.cardLinks.viewDg,
        bills: nav.cardLinks.viewElectricityBills,
      } : {},
      inr: (n: number) => inr(n, { compact: true }),
    });
  }, [effectiveOrgId, propertyId, propertyName, tickets, pace, aop, mailbox, generators, bills]);

  /* ---- Mark seen ------------------------------------------------------------------- */
  const seenKey = userId && effectiveOrgId ? `cc-alerts-seen:${userId}:${effectiveOrgId}` : null;
  const [seen, setSeen] = useState<Record<string, SeenMark>>({});
  useEffect(() => {
    if (!effectiveOrgId) return;
    setSeen(seenKey ? readJson<Record<string, SeenMark>>(seenKey) ?? {} : memSeen.get(effectiveOrgId) ?? {});
  }, [seenKey, effectiveOrgId]);

  const saveSeen = useCallback((next: Record<string, SeenMark>) => {
    setSeen(next);
    if (seenKey) writeJson(seenKey, next);
    else if (effectiveOrgId) memSeen.set(effectiveOrgId, next);
  }, [seenKey, effectiveOrgId]);

  const markSeen = (a: CcAlert) => saveSeen({ ...seen, [a.id]: { level: a.level, metric: a.metric, at: Date.now() } });
  const unhide = (id: string) => { const next = { ...seen }; delete next[id]; saveSeen(next); };

  const visible = result.alerts.filter(a => !stillSeen(a, seen[a.id]));
  const hidden = result.alerts.filter(a => stillSeen(a, seen[a.id]));
  const [seenOpen, setSeenOpen] = useState(false);

  /* ---- New-alert tracking ----------------------------------------------------------- */
  const knownKey = userId && effectiveOrgId ? `cc-alerts-known:${userId}:${effectiveOrgId}` : null;
  const sigs = result.alerts.map(a => `${a.id}:${a.level}`);
  const sigKey = sigs.join('|');
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (anyLoading || !effectiveOrgId) return;
    const current = sigKey ? sigKey.split('|') : [];
    const known = knownKey ? readJson<string[]>(knownKey) : memKnown.get(effectiveOrgId) ?? null;
    const save = (list: string[]) => { if (knownKey) writeJson(knownKey, list); else memKnown.set(effectiveOrgId, list); };
    if (!Array.isArray(known)) { save(current); return; }
    const added = current.filter(s => !known.includes(s));
    if (!added.length) return;
    save([...known, ...added]);
    setFresh(prev => new Set([...prev, ...added]));
  }, [anyLoading, effectiveOrgId, knownKey, sigKey]);

  /* ---- Render tones ----------------------------------------------------------------- */
  const tone = visible.some(a => a.level === 'critical') ? 'critical'
    : visible.some(a => a.level === 'warning') ? 'warning'
    : visible.length ? 'data' : 'clear';
  const chip = { critical: 'cc-chip--red', warning: 'cc-chip--amber', data: 'cc-chip--blue', clear: 'cc-chip--green' }[tone];
  const n = properties?.length;

  return (
    <section className="cc-card cc-alerts" aria-label="Alerts" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 250 }}>
      {/* Header */}
      <div className="cc-card-head" style={{ marginBottom: 10 }}>
        <span className={`cc-chip ${chip}`} aria-hidden>
          <TriangleAlert size={14} />
        </span>
        <span className="cc-title">Alerts</span>
        {visible.length > 0 && (
          <span
            className="cc-badge"
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 999,
              background: tone === 'critical' ? 'var(--cc-red)' : tone === 'warning' ? 'var(--cc-amber)' : 'var(--cc-blue)',
              color: tone === 'warning' ? '#111827' : '#ffffff',
            }}
            aria-label={`${visible.length} alerts`}
          >
            {visible.length}
          </span>
        )}
        <span className="cc-head-meta" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {anyAnswered ? <SourceTag live /> : null}
        </span>
      </div>

      {allLoading ? (
        <CardSkeleton lines={4} />
      ) : (
        <>
          {!visible.length ? (
            anyLoading ? (
              <CardSkeleton lines={2} />
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '18px 10px',
                  textAlign: 'center',
                  gap: 4,
                  background: 'color-mix(in srgb, var(--cc-green) 6%, transparent)',
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'color-mix(in srgb, var(--cc-green) 18%, transparent)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--cc-green)',
                    fontWeight: 800,
                    fontSize: 14,
                  }}
                >
                  ✓
                </div>
                <strong style={{ fontSize: 13, fontWeight: 700, color: 'var(--cc-ink)' }}>
                  {result.alerts.length ? 'All alerts marked seen' : 'All clear'}
                </strong>
                <span style={{ fontSize: 11, color: 'var(--cc-ink-3)', maxWidth: 220, lineHeight: 1.4 }}>
                  {propertyName
                    ? `No active issues at ${propertyName.replace(/\s*,\s*$/, '')}.`
                    : n ? `Nothing abnormal across ${n} buildings.` : 'Nothing abnormal right now.'}
                </span>
              </div>
            )
          ) : (
            <div
              className="cc-alerts-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                maxHeight: 185,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingRight: 4,
              }}
              aria-live="polite"
            >
              {visible.map(a => {
                const isNew = fresh.has(`${a.id}:${a.level}`);
                const borderColor = a.level === 'critical' ? 'var(--cc-red)' : a.level === 'warning' ? 'var(--cc-amber)' : 'var(--cc-blue)';
                const bgTint = a.level === 'critical'
                  ? 'color-mix(in srgb, var(--cc-red) 6%, transparent)'
                  : a.level === 'warning'
                  ? 'color-mix(in srgb, var(--cc-amber) 6%, transparent)'
                  : 'color-mix(in srgb, var(--cc-blue) 6%, transparent)';

                return (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '7px 9px',
                      borderRadius: 8,
                      background: bgTint,
                      borderLeft: `3px solid ${borderColor}`,
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: borderColor,
                            color: a.level === 'warning' ? '#111827' : '#ffffff',
                            lineHeight: 1.25,
                          }}
                        >
                          {LEVEL_LABEL[a.level]}
                        </span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--cc-ink-2)' }}>
                          {a.kind}
                        </span>
                        {isNew && (
                          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--cc-red)', letterSpacing: '0.06em' }}>
                            NEW
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 12,
                          fontWeight: 600,
                          lineHeight: 1.35,
                          color: 'var(--cc-ink)',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {a.what}
                      </div>

                      {/* Display how old the alert is with date */}
                      {a.when && (
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 10.5,
                            fontWeight: 500,
                            color: 'var(--cc-ink-3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <span aria-hidden>⏱️</span>
                          <span>{a.when}</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      {a.href ? (
                        <Link
                          href={a.href}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--cc-ink)',
                            textDecoration: 'none',
                            padding: '2px 7px',
                            borderRadius: 5,
                            background: 'rgba(30,42,48,0.06)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {a.action || 'View'} <span aria-hidden>→</span>
                        </Link>
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            color: 'var(--cc-ink-3)',
                            padding: '2px 5px',
                          }}
                        >
                          {a.action}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => markSeen(a)}
                        style={{
                          fontSize: 9.5,
                          fontWeight: 500,
                          color: 'var(--cc-ink-3)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0 2px',
                          textDecoration: 'underline',
                          opacity: 0.75,
                        }}
                        title="Dismiss until conditions worsen"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}

              {seenOpen && hidden.map(a => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '5px 8px',
                    borderRadius: 6,
                    background: 'rgba(30,42,48,0.03)',
                    opacity: 0.75,
                    fontSize: 11,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--cc-ink-2)' }}>
                    {a.what}
                  </span>
                  <button
                    type="button"
                    onClick={() => unhide(a.id)}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--cc-ink-2)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      textDecoration: 'underline',
                      flexShrink: 0,
                    }}
                  >
                    Unhide
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Footer bar */}
          <div
            style={{
              marginTop: 'auto',
              paddingTop: 8,
              borderTop: '1px solid var(--cc-hairline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 10.5,
              color: 'var(--cc-ink-3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {result.fine.length > 0 ? (
                <span><b style={{ color: 'var(--cc-green)' }}>✓</b> {result.fine[0]}</span>
              ) : result.notChecked.length > 0 ? (
                <span>Not checked: {result.notChecked[0]}</span>
              ) : (
                <span>All systems monitored</span>
              )}
            </div>

            {hidden.length > 0 && (
              <button
                type="button"
                onClick={() => setSeenOpen(o => !o)}
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: 'var(--cc-ink-3)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {hidden.length} dismissed {seenOpen ? '▾' : '▸'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
