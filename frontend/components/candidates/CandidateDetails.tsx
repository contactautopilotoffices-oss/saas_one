'use client';

import React from 'react';
import { PencilLine } from 'lucide-react';
import { DEFENCE_OPTIONS, EDUCATION_TYPES, NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { STATUS_LABELS, type CandidateRecord } from '@/backend/lib/candidates/types';
import { formatDate, formatInr, formatMonths, formatNotice } from './format';
import { BTN_PRIMARY, BTN_SECONDARY, Drawer, LABEL } from './ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className={LABEL}>{label}</dt>
            <dd className="mt-0.5 break-words text-sm text-text-primary">{value || '—'}</dd>
        </div>
    );
}

/** One candidate read-only, so opening a card cannot change anything by accident. Edit details opens the record form. */
export default function CandidateDetails({ record, open, onClose, onEdit }: {
    record: CandidateRecord; open: boolean; onClose: () => void; onEdit: () => void;
}) {
    const r = record;
    const x = r.extras;
    const qualifications = x ? [x.ugQualification, x.pgQualification, x.ppgQualification].filter(q => q && q.toLowerCase() !== NO_QUALIFICATION) : [];
    const resumeRows: [string, React.ReactNode][] = x ? [
        ['Industry', x.industry],
        ['Education', qualifications.join(', ')],
        ['Institute', [x.institute, x.degreeYear].filter(Boolean).join(', ')],
        ['Education type', EDUCATION_TYPES.find(t => t.id === x.educationType)?.label],
        ['Would move to', x.preferredLocations.join(', ')],
        ['Career break', x.careerBreak === null ? null : x.careerBreak ? 'Yes' : 'No'],
        ['Defence background', DEFENCE_OPTIONS.find(d => d.id === x.defenceBackground)?.label],
        ['Serving notice', x.servingNotice === null ? null : x.servingNotice ? 'Yes' : 'No'],
    ].filter(([, value]) => !!value) as [string, React.ReactNode][] : [];
    return (
        <Drawer
            open={open}
            onClose={onClose}
            labelId="candidate-details-title"
            title={r.fullName}
            footer={
                <>
                    <button type="button" onClick={onClose} className={`${BTN_SECONDARY} flex-1 sm:flex-none`}>Close</button>
                    <button type="button" onClick={onEdit} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}><PencilLine className="h-4 w-4" />Edit details</button>
                </>
            }
        >
            <p className="text-sm text-text-secondary">{[r.currentDesignation, r.currentOrganization].filter(Boolean).join(' at ')}</p>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Row label="Status" value={STATUS_LABELS[r.status]} />
                <Row label="Location" value={r.location} />
                <Row label="Total experience" value={formatMonths(r.totalExpMonths)} />
                <Row label="Relevant experience" value={formatMonths(r.relevantExpMonths)} />
                <Row label="Notice period" value={formatNotice(r.noticePeriodDays)} />
                <Row label="Role sourced for" value={r.role} />
                <Row label="Current in-hand" value={formatInr(r.currentInhand)} />
                <Row label="Expected in-hand" value={formatInr(r.expectedInhand)} />
                <Row label="Source" value={r.candidateSource} />
                <Row label="Sourced" value={r.sourcingDate ? formatDate(r.sourcingDate) : null} />
                <Row label="Phone" value={r.phone} />
                <Row label="Email" value={r.email} />
                <Row label="Sheet" value={r.sheetName ?? 'Added by hand'} />
                {resumeRows.map(([label, value]) => <Row key={label} label={label} value={value} />)}
            </dl>
            <div className="mt-4">
                <p className={LABEL}>Remark</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text-primary">{r.remark || 'No remark'}</p>
            </div>
        </Drawer>
    );
}
