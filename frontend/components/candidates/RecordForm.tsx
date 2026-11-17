'use client';

import React, { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import { EDUCATION_TYPES, NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import {
    originLabel, RECORD_STATUSES, STATUS_LABELS,
    type CandidateExtras, type CandidateInput, type CandidateRecord, type RecordStatus,
} from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDateTime, monthsToParts, partsToMonths } from './format';
import { BTN_PRIMARY, BTN_SECONDARY, Drawer, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

/**
 * Add / edit one record. The same drawer is opened from the Candidates table ("Add candidate", "Edit") and from a
 * search result ("Open"). On edit only the fields the user changed are sent (PATCH is partial per the contract), so
 * an edit never overwrites someone else's change to a field this user did not touch.
 *
 * Owner 2026-11-11: what a resume fills in (industry, education, skills, where they would move) can be corrected here
 * too. The Candidates table hands over a record without those fields, so they are fetched before the form opens.
 */

type EducationType = NonNullable<CandidateExtras['educationType']> | '';

interface FormState {
    fullName: string; email: string; phone: string; currentOrganization: string; currentDesignation: string; location: string;
    totalYears: string; totalMonths: string; role: string; candidateSource: string; sourcingDate: string;
    relevantYears: string; relevantMonths: string; noticePeriodDays: string; currentInhand: string; expectedInhand: string;
    remark: string; status: RecordStatus;
    industry: string; ugQualification: string; pgQualification: string; ppgQualification: string; institute: string;
    educationType: EducationType; degreeYear: string; skills: string[]; preferredLocations: string[];
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
/** "none" is how a resume says "no such degree"; in the form that is an empty box. */
const degree = (v: string | null | undefined) => (v && v.toLowerCase() !== NO_QUALIFICATION ? v : '');

function toForm(r: CandidateRecord | null): FormState {
    const total = monthsToParts(r?.totalExpMonths);
    const relevant = monthsToParts(r?.relevantExpMonths);
    const x = r?.extras;
    return {
        fullName: r?.fullName ?? '', email: str(r?.email), phone: str(r?.phone),
        currentOrganization: str(r?.currentOrganization), currentDesignation: str(r?.currentDesignation), location: str(r?.location),
        totalYears: total.years, totalMonths: total.months, role: str(r?.role), candidateSource: str(r?.candidateSource),
        sourcingDate: str(r?.sourcingDate), relevantYears: relevant.years, relevantMonths: relevant.months,
        noticePeriodDays: str(r?.noticePeriodDays), currentInhand: str(r?.currentInhand), expectedInhand: str(r?.expectedInhand),
        remark: str(r?.remark), status: r?.status ?? 'new',
        industry: str(x?.industry), ugQualification: degree(x?.ugQualification), pgQualification: degree(x?.pgQualification), ppgQualification: degree(x?.ppgQualification),
        institute: str(x?.institute), educationType: x?.educationType ?? '', degreeYear: str(x?.degreeYear),
        skills: x?.skills ?? [], preferredLocations: x?.preferredLocations ?? [],
    };
}

const text = (v: string) => (v.trim() ? v.trim() : null);

/** '' -> null, otherwise a non-negative whole number or 'invalid'. Commas are allowed ("35,000"). */
function wholeNumber(v: string, max: number): number | null | 'invalid' {
    const t = v.replace(/,/g, '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : 'invalid';
}

type Errors = Partial<Record<'fullName' | 'email' | 'totalExp' | 'relevantExp' | 'noticePeriodDays' | 'currentInhand' | 'expectedInhand' | 'degreeYear', string>>;

/** `withResumeFields`: the record carries the fields a resume fills, so they are part of what is saved. */
function validate(f: FormState, withResumeFields: boolean): { input: CandidateInput; errors: Errors } {
    const errors: Errors = {};
    if (!f.fullName.trim()) errors.fullName = 'Enter the candidate’s name.';
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errors.email = 'That does not look like an email address.';
    const totalExp = partsToMonths(f.totalYears, f.totalMonths);
    if (totalExp === 'invalid') errors.totalExp = 'Use whole numbers: years, and months from 0 to 11.';
    const relevantExp = partsToMonths(f.relevantYears, f.relevantMonths);
    if (relevantExp === 'invalid') errors.relevantExp = 'Use whole numbers: years, and months from 0 to 11.';
    const notice = wholeNumber(f.noticePeriodDays, 365);
    if (notice === 'invalid') errors.noticePeriodDays = 'Days, as a whole number from 0 to 365.';
    const current = wholeNumber(f.currentInhand, 100_000_000);
    if (current === 'invalid') errors.currentInhand = 'Rupees per month, as a whole number.';
    const expected = wholeNumber(f.expectedInhand, 100_000_000);
    if (expected === 'invalid') errors.expectedInhand = 'Rupees per month, as a whole number.';
    const year = wholeNumber(f.degreeYear, 2100);
    if (withResumeFields && (year === 'invalid' || (year !== null && year < 1950))) errors.degreeYear = 'A year from 1950 to 2100.';

    const input: CandidateInput = {
        fullName: f.fullName.trim(),
        email: text(f.email), phone: text(f.phone),
        currentOrganization: text(f.currentOrganization), currentDesignation: text(f.currentDesignation), location: text(f.location),
        totalExpMonths: totalExp === 'invalid' ? null : totalExp,
        role: text(f.role), candidateSource: text(f.candidateSource), sourcingDate: text(f.sourcingDate),
        relevantExpMonths: relevantExp === 'invalid' ? null : relevantExp,
        noticePeriodDays: notice === 'invalid' ? null : notice,
        currentInhand: current === 'invalid' ? null : current,
        expectedInhand: expected === 'invalid' ? null : expected,
        remark: text(f.remark), status: f.status,
        ...(withResumeFields ? {
            industry: text(f.industry), ugQualification: text(f.ugQualification), pgQualification: text(f.pgQualification), ppgQualification: text(f.ppgQualification),
            institute: text(f.institute), educationType: f.educationType || null, degreeYear: year === 'invalid' ? null : year,
            skills: f.skills, preferredLocations: f.preferredLocations,
        } : {}),
    };
    return { input, errors };
}

const same = (a: unknown, b: unknown) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : a === b);

/** The fields of `next` that differ from `prev` (for a partial PATCH). */
function changedFields(prev: CandidateInput, next: CandidateInput): Partial<CandidateInput> {
    const out: Partial<CandidateInput> = {};
    (Object.keys(next) as (keyof CandidateInput)[]).forEach(k => {
        if (!same(next[k], prev[k])) (out as Record<string, unknown>)[k] = next[k];
    });
    return out;
}

/** A new candidate: an empty resume field is left out, so nothing is sent that nobody typed. */
function withoutEmpty(input: CandidateInput): CandidateInput {
    const out: Record<string, unknown> = { ...input };
    for (const key of ['industry', 'ugQualification', 'pgQualification', 'ppgQualification', 'institute', 'educationType', 'degreeYear', 'skills', 'preferredLocations'] as const) {
        const value = out[key];
        if (value === null || value === undefined || (Array.isArray(value) && !value.length)) delete out[key];
    }
    return out as unknown as CandidateInput;
}

function Field({ label, htmlFor, error, hint, children, className = '' }: {
    label: string; htmlFor?: string; error?: string; hint?: string; children: React.ReactNode; className?: string;
}) {
    return (
        <div className={`min-w-0 ${className}`}>
            <label htmlFor={htmlFor} className={`${LABEL} mb-1.5 block`}>{label}</label>
            {children}
            {error ? <p className="mt-1 text-xs font-medium text-error">{error}</p> : hint ? <p className="mt-1 text-xs text-text-tertiary">{hint}</p> : null}
        </div>
    );
}

function ExpField({ id, label, years, months, onYears, onMonths, error }: {
    id: string; label: string; years: string; months: string; onYears: (v: string) => void; onMonths: (v: string) => void; error?: string;
}) {
    return (
        <fieldset className="min-w-0">
            <legend className={`${LABEL} mb-1.5`}>{label}</legend>
            <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                <div className="relative">
                    <input id={`${id}-y`} inputMode="numeric" type="number" min={0} max={60} step={1} value={years} onChange={e => onYears(e.target.value)}
                        aria-label={`${label}: years`} aria-invalid={!!error} className={`${INPUT} pr-11 tabular-nums`} placeholder="0" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">yrs</span>
                </div>
                <div className="relative">
                    <input id={`${id}-m`} inputMode="numeric" type="number" min={0} max={11} step={1} value={months} onChange={e => onMonths(e.target.value)}
                        aria-label={`${label}: months`} aria-invalid={!!error} className={`${INPUT} pr-11 tabular-nums`} placeholder="0" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">mo</span>
                </div>
            </div>
            {error && <p className="mt-1 text-xs font-medium text-error">{error}</p>}
        </fieldset>
    );
}

/** A box of small labels (skills, cities): Enter or a comma adds what is typed, the cross or Backspace removes one. */
function ChipsField({ id, values, onChange, placeholder, max }: { id: string; values: string[]; onChange: (next: string[]) => void; placeholder: string; max: number }) {
    const [typed, setTyped] = useState('');
    const add = (raw: string) => {
        const fresh = raw.split(',').map(v => v.replace(/\s+/g, ' ').trim()).filter(Boolean)
            .filter((v, i, all) => all.findIndex(o => o.toLowerCase() === v.toLowerCase()) === i && !values.some(o => o.toLowerCase() === v.toLowerCase()));
        if (fresh.length) onChange([...values, ...fresh].slice(0, max));
        setTyped('');
    };
    return (
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-1.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            {values.map(value => (
                <span key={value} className={`${WELL} inline-flex max-w-full items-center gap-0.5 rounded-lg py-0.5 pl-2 pr-0.5 text-xs font-medium text-text-primary`}>
                    <span className="truncate">{value}</span>
                    <button type="button" onClick={() => onChange(values.filter(v => v !== value))} aria-label={`Remove ${value}`} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-tertiary hover:bg-muted hover:text-text-primary">
                        <X className="h-3 w-3" aria-hidden />
                    </button>
                </span>
            ))}
            <input
                id={id}
                value={typed}
                onChange={e => (e.target.value.includes(',') ? add(e.target.value) : setTyped(e.target.value))}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); add(typed); }
                    else if (e.key === 'Backspace' && !typed && values.length) onChange(values.slice(0, -1));
                }}
                onBlur={() => { if (typed.trim()) add(typed); }}
                disabled={values.length >= max}
                placeholder={values.length >= max ? `At most ${max}` : values.length ? '' : placeholder}
                className="h-7 min-w-[120px] flex-1 bg-transparent px-1 text-base text-text-primary outline-none placeholder:text-text-tertiary sm:text-sm"
            />
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-4">
            <h3 className="font-display text-sm font-semibold text-text-primary">{title}</h3>
            {children}
        </section>
    );
}

interface FormProps {
    orgId: string;
    /** null = add a new candidate. */
    record: CandidateRecord | null;
    open: boolean;
    onClose: () => void;
    onSaved: (record: CandidateRecord, created: boolean) => void;
}

/**
 * Mount with a `key` per record so the form re-initialises when a different record is opened. A record that comes
 * without the resume fields (from the Candidates table) is fetched in full first, so the form can show and save them.
 */
export default function RecordForm(props: FormProps) {
    const { orgId, record, open, onClose } = props;
    const { reportError } = useUi();
    const needsFull = record !== null && record.extras === undefined;
    const recordId = record?.id ?? null;
    const [full, setFull] = useState<{ record: CandidateRecord } | 'failed' | null>(null);
    useEffect(() => {
        if (!needsFull || !open || full || !recordId) return;
        const ctrl = new AbortController();
        void api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(recordId)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setFull({ record: res.data.record });
            else { if (res.noAccess) reportError(res); setFull('failed'); }
        });
        return () => ctrl.abort();
    }, [needsFull, open, full, recordId, orgId, reportError]);

    if (needsFull && !full) {
        return (
            <Drawer open={open} onClose={onClose} labelId="candidate-form-title" title={`Edit ${record?.fullName ?? 'candidate'}`}>
                <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading the details</p>
            </Drawer>
        );
    }
    // If the full record could not be fetched, the form still opens with what the table had (the resume fields stay out).
    const loaded = needsFull && full && full !== 'failed' ? { ...full.record, ...record, extras: full.record.extras, hasResume: full.record.hasResume } : record;
    return <RecordFormBody {...props} record={loaded} />;
}

function RecordFormBody({ orgId, record, open, onClose, onSaved }: FormProps) {
    const { notify, reportError } = useUi();
    // A new candidate may be given the resume fields too; an existing record only when it carries them.
    const withResumeFields = record === null || record.extras !== undefined;
    const [form, setForm] = useState<FormState>(() => toForm(record));
    const [initial] = useState<CandidateInput>(() => validate(toForm(record), withResumeFields).input);
    const [errors, setErrors] = useState<Errors>({});
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState('');

    const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));
    const bind = (k: Exclude<keyof FormState, 'status' | 'educationType' | 'skills' | 'preferredLocations'>) => ({
        value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k)(e.target.value),
    });

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const { input, errors: errs } = validate(form, withResumeFields);
        setErrors(errs);
        setServerError('');
        if (Object.keys(errs).length) return;

        if (record) {
            const patch = changedFields(initial, input);
            if (Object.keys(patch).length === 0) { onClose(); return; }
            setSaving(true);
            const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}`, { method: 'PATCH', json: { orgId, ...patch } });
            setSaving(false);
            if (!res.ok) { setServerError(res.error); if (res.noAccess) reportError(res); return; }
            notify('Candidate saved', 'success');
            onSaved(res.data.record, false);
        } else {
            setSaving(true);
            const res = await api<{ record: CandidateRecord }>('/api/candidates', { method: 'POST', json: { orgId, ...withoutEmpty(input) } });
            setSaving(false);
            if (!res.ok) { setServerError(res.error); if (res.noAccess) reportError(res); return; }
            notify('Candidate added', 'success');
            onSaved(res.data.record, true);
        }
    };

    const formId = 'candidate-record-form';
    return (
        <Drawer
            open={open}
            onClose={() => { if (!saving) onClose(); }}
            labelId="candidate-form-title"
            title={record ? `Edit ${record.fullName}` : 'Add candidate'}
            footer={
                <>
                    <button type="button" onClick={onClose} disabled={saving} className={`${BTN_SECONDARY} flex-1 sm:flex-none`}>Cancel</button>
                    <button type="submit" form={formId} disabled={saving} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>
                        {saving && <Spinner />}{record ? 'Save changes' : 'Add candidate'}
                    </button>
                </>
            }
        >
            <form id={formId} onSubmit={submit} noValidate className="space-y-8">
                {serverError && <p role="alert" className="rounded-xl border-l-2 border-error bg-surface-elevated px-3 py-2.5 text-sm text-text-primary">{serverError}</p>}

                {record && (
                    <p className="text-xs text-text-tertiary">
                        {record.sheetName ? <>From sheet <span className="font-semibold text-text-secondary">{record.sheetName}</span>{record.sourceRow ? <>, row <span className="tabular-nums">{record.sourceRow}</span></> : null}</> : originLabel(record)}
                        {' · '}Updated <span className="tabular-nums">{formatDateTime(record.updatedAt)}</span>
                    </p>
                )}

                <Section title="Person">
                    <div className={`${WELL} flex gap-2.5 px-3 py-2.5 text-xs leading-relaxed text-text-secondary`}>
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                        <p>Name, email, phone, organisation, designation, location and total experience are shared by every record of the same person. Changing them here changes them on all of that person’s records.</p>
                    </div>
                    <Field label="Full name *" htmlFor="cf-name" error={errors.fullName}>
                        <input id="cf-name" autoFocus required autoComplete="off" {...bind('fullName')} aria-invalid={!!errors.fullName} className={INPUT} />
                    </Field>
                    <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                        <Field label="Email" htmlFor="cf-email" error={errors.email}>
                            <input id="cf-email" type="email" inputMode="email" autoComplete="off" {...bind('email')} aria-invalid={!!errors.email} className={INPUT} />
                        </Field>
                        <Field label="Phone" htmlFor="cf-phone">
                            <input id="cf-phone" type="tel" inputMode="tel" autoComplete="off" {...bind('phone')} className={`${INPUT} tabular-nums`} />
                        </Field>
                        <Field label="Current organisation" htmlFor="cf-org">
                            <input id="cf-org" {...bind('currentOrganization')} className={INPUT} />
                        </Field>
                        <Field label="Current designation" htmlFor="cf-desig">
                            <input id="cf-desig" {...bind('currentDesignation')} className={INPUT} />
                        </Field>
                        <Field label="Location" htmlFor="cf-loc">
                            <input id="cf-loc" {...bind('location')} className={INPUT} placeholder="e.g. Thane" />
                        </Field>
                        <ExpField id="cf-total" label="Total experience" years={form.totalYears} months={form.totalMonths}
                            onYears={set('totalYears')} onMonths={set('totalMonths')} error={errors.totalExp} />
                    </div>
                </Section>

                <Section title="This application">
                    <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                        <Field label="Role sourced for" htmlFor="cf-role">
                            <input id="cf-role" {...bind('role')} className={INPUT} placeholder="e.g. BMS Operator" />
                        </Field>
                        <ExpField id="cf-rel" label="Relevant experience" years={form.relevantYears} months={form.relevantMonths}
                            onYears={set('relevantYears')} onMonths={set('relevantMonths')} error={errors.relevantExp} />
                        <Field label="Candidate source" htmlFor="cf-src">
                            <input id="cf-src" {...bind('candidateSource')} className={INPUT} placeholder="e.g. Naukri, referral" />
                        </Field>
                        <Field label="Sourcing date" htmlFor="cf-date">
                            <input id="cf-date" type="date" {...bind('sourcingDate')} className={`${INPUT} tabular-nums`} />
                        </Field>
                        <Field label="Notice period (days)" htmlFor="cf-notice" error={errors.noticePeriodDays}>
                            <input id="cf-notice" type="number" inputMode="numeric" min={0} max={365} step={1} {...bind('noticePeriodDays')} aria-invalid={!!errors.noticePeriodDays} className={`${INPUT} tabular-nums`} />
                        </Field>
                        <Field label="Status" htmlFor="cf-status">
                            <select id="cf-status" value={form.status} onChange={e => set('status')(e.target.value as RecordStatus)} className={INPUT}>
                                {RECORD_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                            </select>
                        </Field>
                        <Field label="Current in-hand (₹/month)" htmlFor="cf-cur" error={errors.currentInhand}>
                            <input id="cf-cur" inputMode="numeric" {...bind('currentInhand')} aria-invalid={!!errors.currentInhand} className={`${INPUT} tabular-nums`} placeholder="e.g. 28000" />
                        </Field>
                        <Field label="Expected in-hand (₹/month)" htmlFor="cf-exp" error={errors.expectedInhand}>
                            <input id="cf-exp" inputMode="numeric" {...bind('expectedInhand')} aria-invalid={!!errors.expectedInhand} className={`${INPUT} tabular-nums`} placeholder="e.g. 35000" />
                        </Field>
                    </div>
                    <Field label="Remark" htmlFor="cf-remark">
                        <textarea id="cf-remark" rows={3} {...bind('remark')} className={`${INPUT} h-auto resize-y py-2.5`} />
                    </Field>
                </Section>

                {withResumeFields && (
                    <Section title="Education and skills">
                        <div className={`${WELL} flex gap-2.5 px-3 py-2.5 text-xs leading-relaxed text-text-secondary`}>
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                            <p>These are filled in from the resume when one is read. Correct anything that is wrong: a resume read later only fills what is still empty, so your changes stay.</p>
                        </div>
                        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                            <Field label="Industry" htmlFor="cf-industry">
                                <input id="cf-industry" {...bind('industry')} className={INPUT} placeholder="e.g. Real estate" />
                            </Field>
                            <Field label="Institute" htmlFor="cf-institute">
                                <input id="cf-institute" {...bind('institute')} className={INPUT} placeholder="e.g. University of Mumbai" />
                            </Field>
                            <Field label="Graduation (UG)" htmlFor="cf-ug">
                                <input id="cf-ug" {...bind('ugQualification')} className={INPUT} placeholder="e.g. B.Com" />
                            </Field>
                            <Field label="Post graduation (PG)" htmlFor="cf-pg">
                                <input id="cf-pg" {...bind('pgQualification')} className={INPUT} placeholder="e.g. MBA" />
                            </Field>
                            <Field label="Doctorate (PPG)" htmlFor="cf-ppg">
                                <input id="cf-ppg" {...bind('ppgQualification')} className={INPUT} placeholder="e.g. PhD" />
                            </Field>
                            <Field label="Year of the highest degree" htmlFor="cf-year" error={errors.degreeYear}>
                                <input id="cf-year" inputMode="numeric" {...bind('degreeYear')} aria-invalid={!!errors.degreeYear} className={`${INPUT} tabular-nums`} placeholder="e.g. 2018" />
                            </Field>
                            <Field label="Education type" htmlFor="cf-edu-type">
                                <select id="cf-edu-type" value={form.educationType} onChange={e => set('educationType')(e.target.value as EducationType)} className={INPUT}>
                                    <option value="">Not known</option>
                                    {EDUCATION_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </select>
                            </Field>
                        </div>
                        <Field label="Skills" htmlFor="cf-skills" hint="Type a skill and press Enter or a comma.">
                            <ChipsField id="cf-skills" values={form.skills} onChange={set('skills')} placeholder="e.g. BMS, HVAC" max={40} />
                        </Field>
                        <Field label="Would move to" htmlFor="cf-move" hint="Cities other than where they live now.">
                            <ChipsField id="cf-move" values={form.preferredLocations} onChange={set('preferredLocations')} placeholder="e.g. Pune" max={10} />
                        </Field>
                    </Section>
                )}
            </form>
        </Drawer>
    );
}
