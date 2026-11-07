'use client';

import React, { useState } from 'react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { STATUS_LABELS, RECORD_STATUSES, type RecordStatus } from '@/backend/lib/candidates/types';
import {
    DEFENCE_OPTIONS, EDUCATION_LEVELS, EDUCATION_TYPES, NOTICE_BUCKETS, SOURCED_MONTHS,
    type EducationLevel, type EducationMode, type FieldAvailability, type NoticeBucket, type ResumeField, type SearchFilters, type SourcedMonths,
} from '@/backend/lib/candidates/filters';
import { STATUS_DOT } from './format';
import { NumberInput, OptionInput, TokenField } from './FieldPickers';
import { BTN_GHOST, Dropdown, Reveal, type DropdownOption } from './ui';

const FIELD_LABEL = 'text-[13px] font-semibold text-text-primary';
/** Owner 2026-11-07: shown greyed out until records hold this data (migration 20261107000001, then resumes). */
const RESUME_NOTE = 'Available once resumes are added';
/** Owner 2026-11-07: gender, age and disability stay greyed out, with no data stored, until HR and legal sign off. */
const APPROVAL_NOTE = 'Needs HR and legal approval';

const STATUS_FILTER_OPTIONS: DropdownOption<RecordStatus | ''>[] = [
    { value: '', label: 'Any status' },
    ...RECORD_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s], dot: STATUS_DOT[s] })),
];
const UNIT_OPTIONS: DropdownOption<SearchFilters['salaryUnit']>[] = [{ value: 'year', label: 'Lacs/yr' }, { value: 'month', label: '₹K/mo' }];
const DEFENCE_FILTER_OPTIONS: DropdownOption<SearchFilters['defence']>[] = [
    { value: '', label: 'All candidates' },
    { value: 'any', label: 'Any defence background' },
    ...DEFENCE_OPTIONS.map(d => ({ value: d.id, label: d.label })),
];
const DISABILITY_OPTIONS: DropdownOption<''>[] = [{ value: '', label: 'All candidates' }];

function Pill({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
    return (
        <button type="button" aria-pressed={on} onClick={onClick} disabled={disabled}
            className={`h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed ${on ? 'border-primary-dark bg-primary-dark text-white' : 'border-border bg-surface text-text-secondary enabled:hover:border-primary'}`}>
            {children}
        </button>
    );
}

function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
    return (
        <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
            {options.map(([id, text]) => (
                <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
                    className={`h-6 rounded-md px-2 text-xs font-semibold transition-colors ${value === id ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary'}`}>
                    {text}
                </button>
            ))}
        </div>
    );
}

/** A filter that cannot be used yet: shown, greyed out and disabled, with the reason under it. */
function Gate({ open, note, children }: { open: boolean; note: string; children: React.ReactNode }) {
    if (open) return <>{children}</>;
    return (
        <fieldset disabled className="min-w-0 space-y-1.5">
            <div className="pointer-events-none space-y-1.5 opacity-55">{children}</div>
            <p className="text-xs text-text-tertiary">{note}</p>
        </fieldset>
    );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            {htmlFor ? <label htmlFor={htmlFor} className={FIELD_LABEL}>{label}</label> : <span className={FIELD_LABEL}>{label}</span>}
            {children}
        </div>
    );
}

function Section({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
        <div>
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex h-9 w-full items-center justify-between rounded-lg px-2 text-sm font-semibold text-text-primary hover:bg-muted">
                {count ? `${title} (${count})` : title}
                <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            <Reveal open={open}>
                <div className="space-y-3.5 px-0.5 pb-2.5 pt-2.5">{children}</div>
            </Reveal>
        </div>
    );
}

const BadRange = () => <span role="alert" className="text-xs font-semibold text-error">The minimum is above the maximum.</span>;
const inverted = (min: number | null, max: number | null) => min !== null && max !== null && min > max;
const toggleIn = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
const noop = () => {};

type SectionId = 'employment' | 'education' | 'diversity';

/** The panel's contents. `onCollapse` is the small icon that closes it (the strip beside the list, or the slide-over). */
export default function FilterRail({ orgId, filters, update, availability, canClear, onClear, onCollapse, collapseLabel }: {
    orgId: string;
    filters: SearchFilters;
    update: (patch: Partial<SearchFilters>) => void;
    /** Which resume filters have data; null while loading (they stay greyed out). */
    availability: FieldAvailability | null;
    canClear: boolean;
    onClear: () => void;
    onCollapse: () => void;
    collapseLabel: string;
}) {
    const [section, setSection] = useState<SectionId | null>(null);
    const [preferredOpen, setPreferredOpen] = useState(false);
    const [showPpg, setShowPpg] = useState(false);
    const f = filters;
    const has = (field: ResumeField) => !!availability?.applied && availability.counts[field] > 0;
    const toggle = (id: SectionId) => setSection(s => (s === id ? null : id));
    const toggleNotice = (id: NoticeBucket) => update({ notice: toggleIn(f.notice, id) });
    const setEducation = (level: EducationLevel, patch: Partial<{ mode: EducationMode; picks: string[] }>) =>
        update({ education: { ...f.education, [level]: { ...f.education[level], ...patch } } });

    const employmentCount = [f.role.trim(), f.company.trim(), f.designation.trim(), f.industry.trim(), f.status, f.sourcedMonths].filter(Boolean).length;
    const educationCount = EDUCATION_LEVELS.filter(l => f.education[l.id].mode === 'none' || (f.education[l.id].mode === 'specific' && f.education[l.id].picks.length > 0)).length
        + [f.institute.trim(), f.educationTypes.length, f.degreeYearFrom !== null || f.degreeYearTo !== null].filter(Boolean).length;
    const diversityCount = [f.careerBreak, f.defence].filter(Boolean).length;
    const levels = EDUCATION_LEVELS.filter(l => l.id !== 'ppg' || showPpg || f.education.ppg.mode !== 'any');

    return (
        <div>
            <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-[15px] font-semibold text-text-primary">Filters</h2>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={onClear} disabled={!canClear} className={`${BTN_GHOST} h-8 px-2 text-[13px]`}>Clear all</button>
                    <button type="button" onClick={onCollapse} aria-label={collapseLabel} title={collapseLabel} className={`${BTN_GHOST} h-8 w-8 px-0`}>
                        <PanelLeftClose className="h-[17px] w-[17px]" aria-hidden />
                    </button>
                </div>
            </div>

            <div className="mt-3.5 space-y-[18px]">
                <div className="space-y-1.5">
                    <label htmlFor="cand-location" className={FIELD_LABEL}>Location</label>
                    <TokenField
                        id="cand-location"
                        orgId={orgId}
                        field="location"
                        compact
                        tokens={f.locations.map(text => ({ text }))}
                        onAdd={texts => update({ locations: [...f.locations, ...texts] })}
                        onRemove={text => update({ locations: f.locations.filter(l => l !== text) })}
                        placeholder="Add a city or area"
                    />
                    <Gate open={has('preferredLocations')} note={RESUME_NOTE}>
                        <label className="flex cursor-pointer items-start gap-2 text-xs font-medium leading-snug text-text-secondary">
                            <input type="checkbox" checked={f.relocate} onChange={e => update({ relocate: e.target.checked })} className="mt-px h-4 w-4 shrink-0 accent-[var(--primary-dark)]" />
                            Include candidates who prefer to relocate to above locations
                        </label>
                        <button type="button" onClick={() => setPreferredOpen(o => !o)} aria-expanded={preferredOpen} className="ml-6 text-xs font-semibold text-primary-dark hover:underline">
                            {preferredOpen ? 'Close preferred location' : f.preferredLocations.length ? `Change preferred location (${f.preferredLocations.length})` : 'Change preferred location'}
                        </button>
                        <Reveal open={preferredOpen}>
                            <div className="space-y-1 pt-1">
                                <label htmlFor="cand-preferred" className="text-xs font-medium text-text-secondary">Places they would move to (used instead of the locations above)</label>
                                <TokenField
                                    id="cand-preferred"
                                    orgId={orgId}
                                    field="location"
                                    compact
                                    tokens={f.preferredLocations.map(text => ({ text }))}
                                    onAdd={texts => update({ preferredLocations: [...f.preferredLocations, ...texts] })}
                                    onRemove={text => update({ preferredLocations: f.preferredLocations.filter(l => l !== text) })}
                                    placeholder="e.g. Mumbai"
                                />
                            </div>
                        </Reveal>
                    </Gate>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className={FIELD_LABEL}>Experience</span>
                        <Segment label="Which experience" value={f.expBasis} options={[['total', 'Total'], ['relevant', 'Relevant']]} onChange={expBasis => update({ expBasis })} />
                    </div>
                    <div className="flex items-center gap-2">
                        <NumberInput label="Minimum years of experience" placeholder="Min" value={f.expMin} onChange={expMin => update({ expMin })} />
                        <span className="text-sm text-text-secondary">to</span>
                        <NumberInput label="Maximum years of experience" placeholder="Max" value={f.expMax} onChange={expMax => update({ expMax })} />
                        <span className="text-sm text-text-secondary">yrs</span>
                    </div>
                    {inverted(f.expMin, f.expMax) && <BadRange />}
                </div>

                <div className="space-y-1.5">
                    <span className={FIELD_LABEL}>Notice period</span>
                    <div role="group" aria-label="Notice period. Choose one or more." className="flex flex-wrap gap-1.5">
                        <Pill on={f.notice.length === 0 && !f.servingNotice} onClick={() => update({ notice: [], servingNotice: false })}>Any</Pill>
                        {NOTICE_BUCKETS.map(b => <Pill key={b.id} on={f.notice.includes(b.id)} onClick={() => toggleNotice(b.id)}>{b.label} {f.notice.includes(b.id) ? '✓' : '+'}</Pill>)}
                        <span className={has('servingNotice') ? '' : 'opacity-55'} title={has('servingNotice') ? undefined : RESUME_NOTE}>
                            <Pill on={f.servingNotice} disabled={!has('servingNotice')} onClick={() => update({ servingNotice: !f.servingNotice })}>Currently serving notice {f.servingNotice ? '✓' : '+'}</Pill>
                        </span>
                    </div>
                    {!has('servingNotice') && <p className="text-xs text-text-tertiary">Currently serving notice: {RESUME_NOTE.toLowerCase()}</p>}
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className={FIELD_LABEL}>Salary</span>
                        <Segment label="Which salary" value={f.salaryBasis} options={[['current', 'Current'], ['expected', 'Expected']]} onChange={salaryBasis => update({ salaryBasis })} />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <NumberInput label="Minimum salary" placeholder="Min" value={f.salaryMin} onChange={salaryMin => update({ salaryMin })} />
                        <span className="text-sm text-text-secondary">to</span>
                        <NumberInput label="Maximum salary" placeholder="Max" value={f.salaryMax} onChange={salaryMax => update({ salaryMax })} />
                        <Dropdown variant="tight" align="right" label="Salary unit" value={f.salaryUnit} options={UNIT_OPTIONS} onChange={salaryUnit => update({ salaryUnit, salaryMin: null, salaryMax: null })} />
                    </div>
                    {inverted(f.salaryMin, f.salaryMax) && <BadRange />}
                    <label className="flex cursor-pointer items-start gap-2 text-xs font-medium leading-snug text-text-secondary">
                        <input type="checkbox" checked={f.includeNoSalary} onChange={e => update({ includeNoSalary: e.target.checked })} className="mt-px h-4 w-4 shrink-0 accent-[var(--primary-dark)]" />
                        Include candidates who did not mention their salary
                    </label>
                </div>

                <div className="space-y-1 border-t border-border-subtle pt-2.5">
                    <Section title="Employment details" count={employmentCount} open={section === 'employment'} onToggle={() => toggle('employment')}>
                        <Field label="Role sourced for" htmlFor="cand-role">
                            <OptionInput id="cand-role" orgId={orgId} field="role" value={f.role} onChange={role => update({ role })} placeholder="e.g. Leasing Manager" />
                        </Field>
                        <Field label="Current company" htmlFor="cand-company">
                            <OptionInput id="cand-company" orgId={orgId} field="company" value={f.company} onChange={company => update({ company })} placeholder="Company name" />
                        </Field>
                        <Field label="Current designation" htmlFor="cand-designation">
                            <OptionInput id="cand-designation" orgId={orgId} field="designation" value={f.designation} onChange={designation => update({ designation })} placeholder="e.g. Senior Manager" />
                        </Field>
                        <Gate open={has('industry')} note={RESUME_NOTE}>
                            <Field label="Industry" htmlFor="cand-industry">
                                <OptionInput id="cand-industry" orgId={orgId} field="industry" value={f.industry} onChange={industry => update({ industry })} placeholder="e.g. Real estate" />
                            </Field>
                        </Gate>
                        <Field label="Status">
                            <div><Dropdown label="Status" value={f.status} options={STATUS_FILTER_OPTIONS} onChange={status => update({ status })} /></div>
                        </Field>
                        <Field label="Sourced in">
                            <div role="group" aria-label="Sourced in" className="flex flex-wrap gap-1.5">
                                <Pill on={f.sourcedMonths === null} onClick={() => update({ sourcedMonths: null })}>Any time</Pill>
                                {SOURCED_MONTHS.map((m: SourcedMonths) => <Pill key={m} on={f.sourcedMonths === m} onClick={() => update({ sourcedMonths: m })}>{m === 12 ? '1 year' : `${m} months`}</Pill>)}
                            </div>
                        </Field>
                    </Section>

                    <Section title="Education details" count={educationCount} open={section === 'education'} onToggle={() => toggle('education')}>
                        {levels.map(level => {
                            const e = f.education[level.id];
                            return (
                                <Gate key={level.id} open={has(level.id)} note={RESUME_NOTE}>
                                    <Field label={`${level.label} qualification`}>
                                        <div role="group" aria-label={`${level.label} qualification`} className="flex flex-wrap gap-1.5">
                                            {([['any', 'Any'], ['specific', 'Specific'], ['none', 'None']] as [EducationMode, string][]).map(([mode, text]) => (
                                                <Pill key={mode} on={e.mode === mode} onClick={() => setEducation(level.id, { mode })}>{text}</Pill>
                                            ))}
                                        </div>
                                        <Reveal open={e.mode === 'specific'}>
                                            <div role="group" aria-label={`Choose ${level.label} qualifications`} className="mt-1.5 flex flex-wrap gap-1.5 rounded-xl bg-surface-elevated p-2">
                                                {level.options.map(option => (
                                                    <Pill key={option} on={e.picks.includes(option)} onClick={() => setEducation(level.id, { picks: toggleIn(e.picks, option) })}>{option}</Pill>
                                                ))}
                                            </div>
                                        </Reveal>
                                    </Field>
                                </Gate>
                            );
                        })}
                        {!showPpg && f.education.ppg.mode === 'any' && (
                            <button type="button" onClick={() => setShowPpg(true)} className="text-xs font-semibold text-primary-dark hover:underline">+ Add PPG/Doctorate</button>
                        )}
                        <Gate open={has('institute')} note={RESUME_NOTE}>
                            <Field label="Institute" htmlFor="cand-institute">
                                <OptionInput id="cand-institute" orgId={orgId} field="institute" value={f.institute} onChange={institute => update({ institute })} placeholder="Institute name" />
                            </Field>
                        </Gate>
                        <Gate open={has('educationType')} note={RESUME_NOTE}>
                            <Field label="Education type">
                                <div role="group" aria-label="Education type. Choose one or more." className="flex flex-wrap gap-1.5">
                                    {EDUCATION_TYPES.map(t => (
                                        <Pill key={t.id} on={f.educationTypes.includes(t.id)} onClick={() => update({ educationTypes: toggleIn(f.educationTypes, t.id) })}>
                                            {t.label} {f.educationTypes.includes(t.id) ? '✓' : '+'}
                                        </Pill>
                                    ))}
                                </div>
                            </Field>
                        </Gate>
                        <Gate open={has('degreeYear')} note={RESUME_NOTE}>
                            <Field label="Year of degree completion">
                                <div className="flex items-center gap-2">
                                    <NumberInput label="Degree completed from year" placeholder="From" value={f.degreeYearFrom} onChange={degreeYearFrom => update({ degreeYearFrom })} />
                                    <span className="text-sm text-text-secondary">to</span>
                                    <NumberInput label="Degree completed to year" placeholder="To" value={f.degreeYearTo} onChange={degreeYearTo => update({ degreeYearTo })} />
                                </div>
                                {inverted(f.degreeYearFrom, f.degreeYearTo) && <BadRange />}
                            </Field>
                        </Gate>
                    </Section>

                    <Section title="Diversity hiring" count={diversityCount} open={section === 'diversity'} onToggle={() => toggle('diversity')}>
                        <Gate open={false} note={APPROVAL_NOTE}>
                            <Field label="Gender">
                                <div className="flex flex-wrap gap-1.5">
                                    <Pill on onClick={noop}>All candidates</Pill>
                                    <Pill on={false} onClick={noop}>Male</Pill>
                                    <Pill on={false} onClick={noop}>Female</Pill>
                                </div>
                            </Field>
                        </Gate>
                        <Gate open={false} note={APPROVAL_NOTE}>
                            <Field label="Age">
                                <div className="flex items-center gap-2">
                                    <NumberInput label="Minimum age" placeholder="Min" value={null} onChange={noop} />
                                    <span className="text-sm text-text-secondary">to</span>
                                    <NumberInput label="Maximum age" placeholder="Max" value={null} onChange={noop} />
                                    <span className="text-sm text-text-secondary">yrs</span>
                                </div>
                            </Field>
                        </Gate>
                        <Gate open={has('careerBreak')} note={RESUME_NOTE}>
                            <Field label="Candidates with career break">
                                <div><Pill on={f.careerBreak} onClick={() => update({ careerBreak: !f.careerBreak })}>Returning after a career break</Pill></div>
                            </Field>
                        </Gate>
                        <Gate open={false} note={APPROVAL_NOTE}>
                            <Field label="Differently-abled">
                                <div><Dropdown label="Differently-abled" value="" options={DISABILITY_OPTIONS} onChange={noop} /></div>
                            </Field>
                        </Gate>
                        <Gate open={has('defence')} note={RESUME_NOTE}>
                            <Field label="Defence background">
                                <div><Dropdown label="Defence background" value={f.defence} options={DEFENCE_FILTER_OPTIONS} onChange={defence => update({ defence })} /></div>
                            </Field>
                        </Gate>
                    </Section>
                </div>
            </div>
        </div>
    );
}

/** The slim strip the panel collapses to. Filters stay applied, so the strip says how many are in use. */
export function FilterStrip({ activeCount, onExpand }: { activeCount: number; onExpand: () => void }) {
    return (
        <button type="button" onClick={onExpand} aria-label={activeCount ? `Show filters. ${activeCount} in use.` : 'Show filters'} title="Show filters"
            className="flex w-full flex-col items-center gap-2.5 rounded-xl py-2 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-muted hover:text-text-primary">
            <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
            {activeCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-dark px-1.5 text-xs font-bold text-white">{activeCount}</span>}
            <span className="rotate-180 [writing-mode:vertical-rl]">Filters</span>
        </button>
    );
}
