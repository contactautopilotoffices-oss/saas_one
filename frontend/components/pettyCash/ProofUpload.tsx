'use client';
import { useState } from 'react';
import { pcFetch, type Upload } from './workflowTypes';
export default function ProofUpload({ org, value, onChange, disabled = false, onBusyChange, label = 'Proofs' }: { org: string; value: Upload[]; onChange: (files: Upload[]) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void; label?: string }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    return <div className="pc-upload space-y-2"><label className="block text-sm font-semibold">{label} (PDF, JPEG, PNG or WebP; up to 15MB each)
        <input type="file" multiple disabled={busy || disabled} accept="application/pdf,image/png,image/jpeg,image/webp" className="block mt-2 w-full" onChange={async event => {
            const files = Array.from(event.target.files || []); event.target.value = ''; setBusy(true); onBusyChange?.(true); setError('');
            const uploaded = [...value];
            try { for (const file of files) { const form = new FormData(); form.append('file', file); uploaded.push(await pcFetch<Upload>(`/api/petty-cash/upload?org_id=${org}`, { method: 'POST', body: form })); onChange([...uploaded]); } }
            catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); } finally { setBusy(false); onBusyChange?.(false); }
        }} /></label>
        {busy && <p role="status">Uploading…</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
        {value.map(file => <p key={file.upload_id} className="text-sm text-text-secondary">Attached: {file.file_name}</p>)}
    </div>;
}
