'use client';

import { useId, useState } from 'react';
import { MAX_BRIEF_BYTES, type BriefAttachment } from '@/backend/lib/candidates/outreach-settings';
import { api, qs } from './api';

export function uploadBrief(orgId: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    return api<{ attachment: BriefAttachment }>(`/api/candidates/assignments/brief${qs({ orgId })}`, { form });
}

export function BriefAttachmentField({ name, onChange }: { name?: string; onChange: (file: File | null) => void }) {
    const id = useId();
    const [error, setError] = useState('');
    return (
        <div className="space-y-1 text-sm sm:col-span-2">
            <label htmlFor={id} className="block font-medium">Assignment attachment (optional)</label>
            <p id={id + '-help'} className="text-text-secondary">PDF or Word · Up to 4 MB</p>
            <label className="inline-flex cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 font-medium focus-within:outline focus-within:outline-2">
                {name ? 'Replace file' : 'Choose file'}
                <input id={id} type="file" accept=".pdf,.doc,.docx" aria-describedby={id + '-help'} className="sr-only" onChange={e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (!/\.(pdf|docx?)$/i.test(file.name) || !file.size || file.size > MAX_BRIEF_BYTES) {
                        setError('Choose a non-empty PDF or Word file of up to 4 MB.');
                        return;
                    }
                    setError('');
                    onChange(file);
                }} />
            </label>
            {name && <div className="flex items-center gap-3"><span className="break-all">{name}</span><button type="button" className="underline" onClick={() => { setError(''); onChange(null); }}>Remove attachment</button></div>}
            {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
    );
}
