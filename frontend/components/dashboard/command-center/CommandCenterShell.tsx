'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Building2,
  Bell,
  CalendarDays,
  ChevronDown,
  Check,
  Plus,
  LogOut,
  SlidersHorizontal,
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { useAuth } from '@/frontend/context/AuthContext';
import SignOutModal from '@/frontend/components/ui/SignOutModal';
import { buildNavMap } from './navMap';

type PropertyOption = { id: string; name: string };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * Property selector — dark-glass pill in the cc-header. Selection is
 * persisted to the `propertyId` query param, the same param the legacy
 * OrgAdminDashboard restores its `selectedPropertyId` from, so tab links
 * (`/{orgId}/dashboard?tab=X&propertyId=Y`) land already scoped.
 */
function PropertySelector({
  orgId,
  selectedId,
  properties,
  onChange,
}: {
  orgId: string;
  selectedId: string; // 'all' | property id
  properties: PropertyOption[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const current =
    selectedId === 'all'
      ? 'All properties'
      : properties.find((p) => p.id === selectedId)?.name ?? 'All properties';

  const options: PropertyOption[] = [{ id: 'all', name: 'All properties' }, ...properties];

  return (
    <div ref={ref} className="relative" data-org={orgId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-[12.5px] font-semibold text-white/90 backdrop-blur-md transition-colors hover:bg-white/10"
      >
        <Building2 className="h-4 w-4 text-white/70" />
        <span className="max-w-[160px] truncate">{current}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-white/60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#15181f]/95 shadow-2xl backdrop-blur-xl">
          <div className="max-h-64 overflow-y-auto py-1.5">
            {options.map((p) => {
              const selected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] transition-colors ${
                    selected
                      ? 'bg-white/10 font-semibold text-white'
                      : 'text-white/75 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                </button>
              );
            })}
            {properties.length === 0 && (
              <div className="px-3.5 py-2 text-[11.5px] text-white/40">No properties found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommandCenterShell({
  userName,
  userEmail,
  // Optional so the /cc-preview/* harness pages keep compiling; falls back to
  // the preview org id. Production callers (CommandCenter) always pass it.
  orgId = '211e1330-ad83-446d-941f-dcea48396798',
  children,
}: {
  userName: string;
  userEmail: string;
  orgId?: string;
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { signOut } = useAuth();
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  // Property scope — 'all' or a property id. Mirrors the legacy dashboard,
  // which restores selectedPropertyId from the `propertyId` query param, and
  // the selection is synced back into that same param so deep links keep it.
  const [selectedPropertyId, setSelectedPropertyId] = useState(
    () => searchParams.get('propertyId') ?? 'all'
  );
  const [properties, setProperties] = useState<PropertyOption[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('properties')
        .select('id, name')
        .eq('organization_id', orgId)
        .order('name', { ascending: true });
      if (!cancelled && data) setProperties(data as PropertyOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, supabase]);

  const navMap = useMemo(
    () => buildNavMap(orgId, selectedPropertyId === 'all' ? undefined : selectedPropertyId),
    [orgId, selectedPropertyId]
  );

  const handlePropertyChange = (id: string) => {
    setSelectedPropertyId(id);
    const params = new URLSearchParams(window.location.search);
    if (id === 'all') params.delete('propertyId');
    else params.set('propertyId', id);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  };

  return (
    <div className="cc-canvas">
      {/* ---- Left rail ---- */}
      <aside className="cc-rail">
        <div className="cc-rail-logo">
          <div>
            <img src="/autopilot-logo-new.png" alt="Autopilot" />
            <span className="cc-rail-logo-caption">SUPER ADMIN CONSOLE</span>
          </div>
        </div>

        <nav>
          {navMap.rail.map((section) => (
            <div className="cc-rail-section" key={section.label}>
              <span className="cc-rail-section-label">{section.label}</span>
              {section.items.map((item) => {
                const Icon = item.icon;
                if (item.disabled || !item.href) {
                  return (
                    <span
                      key={item.label}
                      className="cc-rail-item opacity-40 cursor-not-allowed"
                      title={`${item.label} — coming soon`}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </span>
                  );
                }
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`cc-rail-item${item.active ? ' is-active' : ''}`}
                  >
                    <Icon />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="cc-user-card">
          <div className="cc-user-row">
            <div className="cc-user-avatar">{initials(userName)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="cc-user-name">{userName}</div>
              <div className="cc-user-email">{userEmail}</div>
            </div>
          </div>
          <button type="button" className="cc-signout" onClick={() => setShowSignOutModal(true)}>
            <LogOut />
            Sign Out
          </button>
          <button type="button" className="cc-customize">
            <SlidersHorizontal />
            Customize Dashboard
          </button>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="cc-main">
        <header className="cc-header">
          <div>
            <h1 className="cc-greeting">Good Afternoon, {userName.split(' ')[0]} 👋</h1>
            <div className="cc-header-sub">
              Here&apos;s what&apos;s happening across your portfolio today.
            </div>
          </div>
          <div className="cc-header-right">
            <PropertySelector
              orgId={orgId}
              selectedId={selectedPropertyId}
              properties={properties}
              onChange={handlePropertyChange}
            />
            <div className="cc-sync">
              <span className="cc-sync-dot" />
              <span className="cc-sync-text">
                <b>Data synced</b>
                <span>2 min ago</span>
              </span>
            </div>
            <button type="button" className="cc-iconbtn" aria-label="Notifications">
              <Bell />
              <span className="cc-iconbtn-badge">8</span>
            </button>
            <button type="button" className="cc-iconbtn" aria-label="Calendar">
              <CalendarDays />
            </button>
            <button type="button" className="cc-addbtn">
              <Plus />
              Add Widget
            </button>
          </div>
        </header>

        {children}
      </div>

      <SignOutModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={signOut}
      />
    </div>
  );
}
