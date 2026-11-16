'use client';

import React from 'react';
import { Pencil, Star, X } from 'lucide-react';
import { Crumb, FONT, Item, ItemIcon, fmtDateTime, fmtSize, teamLabel, typeLabel } from './shared';

/**
 * Owner 2026-11-13: Drive's info pane. Everything the list knows about one item, in one place, with the note
 * editable from here. Pure display: the host owns the data and the actions.
 */
export function DetailsPanel({ item, path, inBin, onClose, onEditNote }: {
    item: Item | null; path: Crumb[]; inBin: boolean; onClose: () => void; onEditNote: (item: Item) => void;
}) {
    const location = inBin ? (item?.location ?? 'Files') : ['Files', ...path.map(p => p.name)].join(' › ');
    return (
        <aside style={FONT} aria-label="Details" className="flex h-full w-full flex-col bg-white lg:w-80 lg:border-l lg:border-[#E1E3E1]">
            <div className="flex h-14 items-center justify-between pl-5 pr-2">
                <h2 className="truncate text-base font-medium text-[#1F1F1F]">{item ? item.name : 'Details'}</h2>
                <button type="button" onClick={onClose} aria-label="Close details" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-black/[.08]"><X className="h-5 w-5" /></button>
            </div>
            {!item ? (
                <p className="px-5 py-10 text-center text-sm text-[#444746]">Select a file or folder to see its details</p>
            ) : (
                <div className="flex-1 overflow-y-auto px-5 pb-6">
                    <div className="flex h-32 items-center justify-center rounded-2xl bg-[#F0F4F9]">
                        <ItemIcon item={item} className="h-14 w-14" />
                    </div>
                    <dl className="mt-5 space-y-3 text-sm">
                        <Row k="Type" v={typeLabel(item)} />
                        {item.kind === 'file' ? <Row k="Size" v={fmtSize(item.sizeBytes)} /> : <Row k="Contains" v={`${item.itemCount ?? 0} item${item.itemCount === 1 ? '' : 's'}`} />}
                        <Row k="Location" v={location} />
                        <Row k="Owner" v={`${item.createdByName} · ${teamLabel(item.team)}`} />
                        <Row k="Modified" v={fmtDateTime(item.updatedAt)} />
                        <Row k="Created" v={fmtDateTime(item.createdAt)} />
                        {item.deletedAt && <Row k="Binned" v={fmtDateTime(item.deletedAt)} />}
                        {item.starred && <Row k="Starred" v={<span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-[#F9AB00] text-[#F9AB00]" aria-hidden />By you</span>} />}
                    </dl>
                    <div className="mt-6 flex items-center justify-between">
                        <h3 className="text-sm font-medium text-[#1F1F1F]">Note</h3>
                        {!inBin && (
                            <button type="button" onClick={() => onEditNote(item)} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/[.08]">
                                <Pencil className="h-4 w-4" />{item.note ? 'Edit' : 'Add'}
                            </button>
                        )}
                    </div>
                    <p className={`mt-2 whitespace-pre-wrap break-words text-sm ${item.note ? 'text-[#1F1F1F]' : 'text-[#747775]'}`}>{item.note || 'No note yet'}</p>
                </div>
            )}
        </aside>
    );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[6rem_1fr] gap-2">
            <dt className="text-[#444746]">{k}</dt>
            <dd className="min-w-0 break-words text-[#1F1F1F]">{v}</dd>
        </div>
    );
}
