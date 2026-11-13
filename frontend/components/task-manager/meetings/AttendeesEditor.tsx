'use client';

import React, { useState } from 'react';
import { Check, Loader2, Users, X } from 'lucide-react';
import { call, meetingUrl, type MeetingPerson, type MeetingSpace } from './api';
import PeoplePicker from './PeoplePicker';

/**
 * Owner 2026-11-13: change who is present — a sheet from the bottom on a phone, a box in the middle on wider screens.
 * Used while recording (someone walked in) and on the finished meeting. Saves with the `update_attendees` action; a
 * save that fails for lack of signal keeps the sheet open with the choice intact, so nothing is lost by tapping again.
 */
export interface Attendees { attendees: Array<{ id: string; name: string }>; extraNames: string[] }

export default function AttendeesEditor({ space, meetingId, people, current, onSaved, onClose }: {
    space: MeetingSpace;
    meetingId: string;
    people: MeetingPerson[];
    current: Attendees;
    /** `canRewrite`: the notes already exist and can be written again with the new people */
    onSaved: (next: Attendees & { canRewrite: boolean }) => void;
    onClose: () => void;
}) {
    const [selected, setSelected] = useState<Set<string>>(new Set(current.attendees.map(a => a.id)));
    const [extra, setExtra] = useState<string[]>(current.extraNames);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const save = async () => {
        if (saving) return;
        setSaving(true);
        setError(null);
        const r = await call<Attendees & { canRewrite: boolean }>(meetingUrl(meetingId, space), { action: 'update_attendees', attendeeIds: [...selected], extraNames: extra }, { timeoutMs: 20_000 });
        setSaving(false);
        if (!r.ok) { setError(r.error); return; }
        onSaved({ attendees: r.attendees, extraNames: r.extraNames, canRewrite: r.canRewrite });
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" onKeyDown={e => { if (e.key === 'Escape' && !saving) onClose(); }}>
            <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px]" onClick={() => { if (!saving) onClose(); }} aria-hidden="true" />
            <div role="dialog" aria-modal="true" aria-labelledby="attendees-title"
                className="relative flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-zinc-200 bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-start gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50"><Users className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                        <h3 id="attendees-title" className="text-lg font-black text-zinc-900 dark:text-zinc-100">Who is present</h3>
                        <p className="text-sm text-zinc-500">Add anyone who joined, or take out anyone who did not.</p>
                    </div>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="-mr-1 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-6">
                    <PeoplePicker people={people} selected={selected} extra={extra} onToggle={toggle} onExtraChange={setExtra} listClassName="max-h-[40vh]" />
                </div>
                <div className="space-y-2 p-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6 sm:pt-3">
                    {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error} Your choice is kept — tap Save again.</p>}
                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} disabled={saving} className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-zinc-300 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Cancel</button>
                        <button type="button" onClick={() => void save()} disabled={saving} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save ({selected.size + extra.length})
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
