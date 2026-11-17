'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import {
    DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor, closestCenter, pointerWithin,
    useDroppable, useSensor, useSensors,
    type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Copy, GripVertical, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useAppZoom, unzoomTransform } from '@/frontend/hooks/useAppZoom';

/**
 * The sections-and-questions part of the test editor, laid out like a form:
 * each section card holds its own questions. Drag a question by its handle to
 * reorder it or move it into another section; drag a section by its handle to
 * reorder sections (their questions fold away while you do). Keyboard: focus a
 * handle, Space to pick up, arrows to move, Space to drop.
 *
 * Locked (someone has already taken the test): only section titles and
 * descriptions can change; questions are shown read-only.
 */

export type SectionDraft = { key: string; title: string; description: string };
export type Draft = {
    uid: string; section: string; text: string; options: string[];
    /** The correct option (single answer). */
    answer_index: number;
    /** "Select all that apply": several correct options, scored all or nothing. */
    multi: boolean;
    answer_indexes: number[];
    /** The pasted text gave no answer and the AI chose one: shown until HR touches the answer. */
    aiPicked?: boolean;
};

export const newUid = () => Math.random().toString(36).slice(2, 10);
export const emptyQuestion = (section: string): Draft => ({ uid: newUid(), section, text: '', options: ['', '', '', ''], answer_index: -1, multi: false, answer_indexes: [] });

/** Questions in the order candidates (without shuffle) and the saved test see them: by section, then within. */
export function orderedQuestions(sections: SectionDraft[], questions: Draft[]) {
    return sections.flatMap((s) => questions.filter((q) => q.section === s.key));
}

const input = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none disabled:bg-slate-50';
const S = (key: string) => `s:${key}`;
const Q = (uid: string) => `q:${uid}`;
const C = (key: string) => `c:${key}`;

export default function TestBuilder({
    sections, setSections, questions, setQuestions, locked,
}: {
    sections: SectionDraft[];
    setSections: Dispatch<SetStateAction<SectionDraft[]>>;
    questions: Draft[];
    setQuestions: Dispatch<SetStateAction<Draft[]>>;
    locked: boolean;
}) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [moveTo, setMoveTo] = useState('');

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const ordered = orderedQuestions(sections, questions);
    const number = (uid: string) => ordered.findIndex((q) => q.uid === uid) + 1;
    const draggingSection = !!activeId?.startsWith('s:');

    const updateQuestion = (uid: string, patch: Partial<Draft>) =>
        setQuestions((qs) => qs.map((q) => (q.uid === uid ? { ...q, ...patch } : q)));

    const updateSection = (key: string, patch: Partial<SectionDraft>) =>
        setSections((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));

    const addSection = () => {
        const key = `section_${Date.now().toString(36)}`;
        setSections((ss) => [...ss, { key, title: 'New section', description: '' }]);
    };

    /** Add right after the section's last question, so it lands in that section. */
    const addQuestion = (section: string, after?: Draft) => {
        setQuestions((qs) => {
            const next = after ? { ...after, uid: newUid(), options: [...after.options] } : emptyQuestion(section);
            const at = after ? qs.findIndex((q) => q.uid === after.uid) : qs.map((q) => q.section).lastIndexOf(section);
            return at < 0 ? [...qs, next] : [...qs.slice(0, at + 1), next, ...qs.slice(at + 1)];
        });
    };

    const removeSection = (key: string, mode: 'move' | 'delete') => {
        if (mode === 'move' && moveTo) {
            setQuestions((qs) => {
                const moving = qs.filter((q) => q.section === key).map((q) => ({ ...q, section: moveTo }));
                const rest = qs.filter((q) => q.section !== key);
                const at = rest.map((q) => q.section).lastIndexOf(moveTo);
                return at < 0 ? [...rest, ...moving] : [...rest.slice(0, at + 1), ...moving, ...rest.slice(at + 1)];
            });
        } else {
            setQuestions((qs) => qs.filter((q) => q.section !== key));
        }
        setSections((ss) => ss.filter((s) => s.key !== key));
        setDeleting(null);
    };

    const askRemoveSection = (key: string) => {
        if (!questions.some((q) => q.section === key)) {
            setSections((ss) => ss.filter((s) => s.key !== key));
            return;
        }
        setMoveTo(sections.find((s) => s.key !== key)?.key || '');
        setDeleting(key);
    };

    // A section only collides with sections; a question with questions and section drop areas.
    const collision: CollisionDetection = (args) => {
        const isSection = String(args.active.id).startsWith('s:');
        const droppableContainers = args.droppableContainers.filter((c) => String(c.id).startsWith('s:') === isSection);
        if (isSection) return closestCenter({ ...args, droppableContainers });
        const hits = pointerWithin({ ...args, droppableContainers });
        const questionHits = hits.filter((h) => String(h.id).startsWith('q:'));
        if (questionHits.length) return questionHits;
        if (hits.length) return hits;
        return closestCenter({ ...args, droppableContainers });
    };

    const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

    // Crossing into another section moves the question there straight away, so the list makes room.
    const onDragOver = ({ active, over }: DragOverEvent) => {
        const a = String(active.id);
        const o = over ? String(over.id) : '';
        if (!a.startsWith('q:') || !o) return;
        const uid = a.slice(2);
        const target = o.startsWith('c:') ? o.slice(2) : o.startsWith('q:') ? questions.find((q) => q.uid === o.slice(2))?.section : undefined;
        const current = questions.find((q) => q.uid === uid);
        if (!target || !current || current.section === target) return;
        setQuestions((qs) => {
            const moving = { ...current, section: target };
            const rest = qs.filter((q) => q.uid !== uid);
            let at = o.startsWith('q:') ? rest.findIndex((q) => q.uid === o.slice(2)) : -1;
            if (at < 0) {
                const last = rest.map((q) => q.section).lastIndexOf(target);
                at = last < 0 ? rest.length : last + 1;
            }
            return [...rest.slice(0, at), moving, ...rest.slice(at)];
        });
    };

    const onDragEnd = ({ active, over }: DragEndEvent) => {
        setActiveId(null);
        const a = String(active.id);
        const o = over ? String(over.id) : '';
        if (!o || a === o) return;
        if (a.startsWith('s:') && o.startsWith('s:')) {
            setSections((ss) => arrayMove(ss, ss.findIndex((s) => S(s.key) === a), ss.findIndex((s) => S(s.key) === o)));
        } else if (a.startsWith('q:') && o.startsWith('q:')) {
            setQuestions((qs) => arrayMove(qs, qs.findIndex((q) => Q(q.uid) === a), qs.findIndex((q) => Q(q.uid) === o)));
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Sections and questions</p>
                {!locked && <p className="text-xs text-slate-400">Drag <GripVertical className="inline w-3.5 h-3.5" /> to reorder or move between sections</p>}
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={collision}
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={() => setActiveId(null)}
            >
                <SortableContext items={sections.map((s) => S(s.key))} strategy={verticalListSortingStrategy}>
                    {sections.map((s, si) => {
                        const inSection = questions.filter((q) => q.section === s.key);
                        return (
                            <SortableBlock key={s.key} id={S(s.key)} disabled={locked}>
                                {(handle) => (
                                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                                        <div className="flex items-center gap-2">
                                            {!locked && <Handle {...handle} label={`Move section ${si + 1}`} />}
                                            <span className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-black uppercase tracking-wider text-white">Section {si + 1}</span>
                                            <input className={`${input} font-bold`} placeholder="Section name" aria-label={`Section ${si + 1} name`} value={s.title} onChange={(e) => updateSection(s.key, { title: e.target.value })} />
                                            <span className="shrink-0 text-xs font-bold text-slate-400">{inSection.length} Q</span>
                                            {!locked && (
                                                <button type="button" onClick={() => askRemoveSection(s.key)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title="Remove section">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                        <input className={input} placeholder="Description the candidate reads under the section title (optional)" value={s.description} onChange={(e) => updateSection(s.key, { description: e.target.value })} />

                                        {deleting === s.key && (
                                            <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm">
                                                <p className="font-bold text-rose-900">This section has {inSection.length} question{inSection.length === 1 ? '' : 's'}. What should happen to {inSection.length === 1 ? 'it' : 'them'}?</p>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {sections.length > 1 && (
                                                        <>
                                                            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-700">
                                                                {sections.filter((x) => x.key !== s.key).map((x) => <option key={x.key} value={x.key}>{x.title || 'Untitled section'}</option>)}
                                                            </select>
                                                            <button type="button" onClick={() => removeSection(s.key, 'move')} className="rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-bold text-white">Move them, delete section</button>
                                                        </>
                                                    )}
                                                    <button type="button" onClick={() => removeSection(s.key, 'delete')} className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-sm font-bold text-rose-700">Delete section and questions</button>
                                                    <button type="button" onClick={() => setDeleting(null)} className="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-white">Cancel</button>
                                                </div>
                                            </div>
                                        )}

                                        {!draggingSection && (
                                            <SortableContext items={inSection.map((q) => Q(q.uid))} strategy={verticalListSortingStrategy}>
                                                <DropArea id={C(s.key)} empty={inSection.length === 0} locked={locked}>
                                                    {inSection.map((q) => (
                                                        <SortableBlock key={q.uid} id={Q(q.uid)} disabled={locked}>
                                                            {(qHandle) => (
                                                                <QuestionCard
                                                                    q={q}
                                                                    n={number(q.uid)}
                                                                    locked={locked}
                                                                    handle={qHandle}
                                                                    sections={sections}
                                                                    canDelete={questions.length > 1}
                                                                    onChange={(patch) => updateQuestion(q.uid, patch)}
                                                                    onMove={(section) => {
                                                                        setQuestions((qs) => {
                                                                            const rest = qs.filter((x) => x.uid !== q.uid);
                                                                            const at = rest.map((x) => x.section).lastIndexOf(section);
                                                                            const moved = { ...q, section };
                                                                            return at < 0 ? [...rest, moved] : [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)];
                                                                        });
                                                                    }}
                                                                    onDuplicate={() => addQuestion(s.key, q)}
                                                                    onDelete={() => setQuestions((qs) => qs.filter((x) => x.uid !== q.uid))}
                                                                />
                                                            )}
                                                        </SortableBlock>
                                                    ))}
                                                </DropArea>
                                            </SortableContext>
                                        )}

                                        {!locked && !draggingSection && (
                                            <button type="button" onClick={() => addQuestion(s.key)} className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-600 hover:border-slate-900">
                                                <Plus className="w-4 h-4" /> Add question
                                            </button>
                                        )}
                                    </div>
                                )}
                            </SortableBlock>
                        );
                    })}
                </SortableContext>
            </DndContext>

            {!locked && (
                <button type="button" onClick={addSection} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
                    <Plus className="w-4 h-4" /> Add section
                </button>
            )}
        </div>
    );
}

type HandleProps = React.HTMLAttributes<HTMLElement>;

function SortableBlock({ id, disabled, children }: { id: string; disabled: boolean; children: (handle: HandleProps) => React.ReactNode }) {
    const zoom = useAppZoom();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(unzoomTransform(transform, zoom)), transition, zIndex: isDragging ? 30 : undefined, position: 'relative' }}
            className={isDragging ? 'opacity-80 shadow-lg rounded-2xl' : undefined}
        >
            {children({ ...attributes, ...listeners } as HandleProps)}
        </div>
    );
}

function DropArea({ id, empty, locked, children }: { id: string; empty: boolean; locked: boolean; children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({ id, disabled: locked });
    return (
        <div ref={setNodeRef} className={`space-y-2 rounded-xl ${empty ? `min-h-14 border border-dashed ${isOver ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}` : ''}`}>
            {empty && <p className="px-3 py-4 text-center text-xs text-slate-400">{locked ? 'No questions' : 'No questions yet. Add one, or drag one here.'}</p>}
            {children}
        </div>
    );
}

function Handle({ label, ...props }: HandleProps & { label: string }) {
    return (
        <button type="button" {...props} aria-label={label} title="Drag to move" className="cursor-grab touch-none rounded-lg p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing">
            <GripVertical className="w-4 h-4" />
        </button>
    );
}

/** Is this option one of the right ones? */
const isCorrect = (q: Draft, oi: number) => (q.multi ? q.answer_indexes.includes(oi) : q.answer_index === oi);

function QuestionCard({
    q, n, locked, handle, sections, canDelete, onChange, onMove, onDuplicate, onDelete,
}: {
    q: Draft; n: number; locked: boolean; handle: HandleProps; sections: SectionDraft[]; canDelete: boolean;
    onChange: (patch: Partial<Draft>) => void; onMove: (section: string) => void; onDuplicate: () => void; onDelete: () => void;
}) {
    if (locked) {
        return (
            <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-bold text-slate-900">
                    <span className="mr-1 text-xs font-black text-slate-400">Q{n}</span> {q.text}
                    {q.multi && <span className="ml-1.5 text-[11px] font-bold text-slate-400">(select all that apply)</span>}
                </p>
                <ul className="space-y-1 pl-7">
                    {q.options.map((o, oi) => ({ o, oi })).filter(({ o }) => o.trim()).map(({ o, oi }) => (
                        <li key={oi} className={`flex items-center gap-1.5 text-sm ${isCorrect(q, oi) ? 'font-bold text-emerald-800' : 'text-slate-600'}`}>
                            {isCorrect(q, oi) ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5" />} {o}
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
                <Handle {...handle} label={`Move question ${n}`} />
                <span className="text-xs font-black text-slate-400">Q{n}</span>
                <input className={input} placeholder="Question" value={q.text} onChange={(e) => onChange({ text: e.target.value })} />
                {sections.length > 1 && (
                    <select
                        value={q.section}
                        onChange={(e) => onMove(e.target.value)}
                        className="max-w-[9rem] rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold text-slate-600"
                        title="Move to section"
                    >
                        {sections.map((s, si) => <option key={s.key} value={s.key}>{`${si + 1}. ${s.title || 'Untitled section'}`}</option>)}
                    </select>
                )}
                <button type="button" onClick={onDuplicate} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title="Duplicate question">
                    <Copy className="w-4 h-4" />
                </button>
                {canDelete && (
                    <button type="button" onClick={onDelete} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title="Delete question">
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-3 pl-14">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600" title="Candidates tick every option that is right; they score only if they tick exactly the right ones">
                    <input
                        type="checkbox"
                        checked={q.multi}
                        onChange={(e) => onChange(e.target.checked
                            // Turning it on keeps the current answer as the first ticked one; off keeps the first ticked.
                            ? { multi: true, answer_indexes: q.answer_index >= 0 ? [q.answer_index] : [], aiPicked: false }
                            : { multi: false, answer_index: q.answer_indexes[0] ?? -1, aiPicked: false })}
                    />
                    Multiple answers <span className="font-medium text-slate-400">(select all that apply)</span>
                </label>
                {q.aiPicked && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                        <Sparkles className="w-3 h-3" /> AI-picked answer — please check
                    </span>
                )}
            </div>
            {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2 pl-14">
                    {q.multi ? (
                        <input
                            type="checkbox"
                            checked={q.answer_indexes.includes(oi)}
                            onChange={() => onChange({
                                answer_indexes: q.answer_indexes.includes(oi) ? q.answer_indexes.filter((x) => x !== oi) : [...q.answer_indexes, oi].sort((a, b) => a - b),
                                aiPicked: false,
                            })}
                            title="Tick every correct option"
                        />
                    ) : (
                        <input type="radio" name={`answer-${q.uid}`} checked={q.answer_index === oi} onChange={() => onChange({ answer_index: oi, aiPicked: false })} title="Mark as correct" />
                    )}
                    <input
                        className={input}
                        placeholder={`Option ${oi + 1}${oi > 1 ? ' (optional)' : ''}`}
                        value={opt}
                        onChange={(e) => onChange({ options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)) })}
                    />
                </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 pl-14">
                <p className="text-xs text-slate-400">
                    {q.multi ? 'Tick every correct option.' : 'Select the circle next to the correct (or best) option.'}
                </p>
                {q.options.length < 8 && (
                    <button type="button" onClick={() => onChange({ options: [...q.options, ''] })} className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900">
                        <Plus className="w-3.5 h-3.5" /> Add option
                    </button>
                )}
            </div>
        </div>
    );
}
