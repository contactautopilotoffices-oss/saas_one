'use client';

import { useEffect, useRef, useState } from 'react';
import type { CandidateRecord, Position, PositionMember } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import CandidateDetails from './CandidateDetails';
import RecordForm from './RecordForm';
import { INPUT, useUi } from './ui';

export function useCandidateProfile(orgId: string, onChanged?: () => void) {
    const { notify, reportError } = useUi();
    const [profile, setProfile] = useState<{ record: CandidateRecord; positionId?: string } | null>(null);
    const [activePosition, setActivePosition] = useState<string | null>(null);
    const [roles, setRoles] = useState<Pick<Position, 'id' | 'title'>[]>([]);
    const [editing, setEditing] = useState(false);
    const [nonce, setNonce] = useState(0);
    const [membership, setMembership] = useState<{ applicationId: string; position: Position; member: Omit<PositionMember, 'record'> } | null>(null);
    const lookup = useRef<AbortController | null>(null);
    useEffect(() => () => lookup.current?.abort(), [orgId]);

    const show = async (id: string, byCandidate = false, positionId?: string | null, silentMissing = false) => {
        lookup.current?.abort();
        const ctrl = new AbortController();
        lookup.current = ctrl;
        const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(id)}${qs({ orgId, by: byCandidate ? 'candidate' : undefined })}`, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return false;
        if (!res.ok) { if (!silentMissing || res.status !== 404) notify(res.error, 'error'); if (res.noAccess) reportError(res); return false; }
        if (res.data.record.deletedAt) {
            if (!silentMissing) notify('This candidate record is archived.', 'info');
            return false;
        }
        setMembership(null);
        setActivePosition(null);
        setRoles([]);
        setProfile({ record: res.data.record, positionId: positionId ?? undefined });
        return true;
    };

    const applicationId = profile?.record.id;
    const profileCandidateId = profile?.record.candidateId;
    const preferredPosition = profile?.positionId;
    useEffect(() => {
        if (!applicationId) return;
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        void (async () => {
            const res = await api<{ memberships: { member: Omit<PositionMember, 'record'>; position: Pick<Position, 'id' | 'title' | 'status'> }[] }>(
                `/api/candidates/${encodeURIComponent(applicationId)}/positions${qs({ orgId })}`, { signal });
            if (signal.aborted || !res.ok) return;
            const active = res.data.memberships.filter(row => row.position.status === 'open');
            setRoles(active.map(item => item.position));
            const requested = activePosition ?? preferredPosition;
            const row = requested ? active.find(item => item.position.id === requested) : active[0];
            if (!row) { setMembership(null); return; }
            const position = await api<{ position: Position; score?: PositionMember['score'] }>(`/api/candidates/positions/${encodeURIComponent(row.position.id)}${qs({ orgId, candidateId: profileCandidateId })}`, { signal });
            if (!signal.aborted && position.ok) setMembership({ applicationId, member: { ...row.member, score: position.data.score }, position: position.data.position });
        })();
        return () => ctrl.abort();
    }, [orgId, applicationId, preferredPosition, profileCandidateId, activePosition, nonce]);

    const changed = () => { setNonce(n => n + 1); onChanged?.(); };
    const record = profile?.record;
    const link = membership?.applicationId === record?.id ? membership : null;
    return {
        show,
        drawer: record && (
            <>
                <CandidateDetails key={record.id} record={record} open={!editing} onClose={() => setProfile(null)} onEdit={() => setEditing(true)} orgId={orgId} onChanged={changed}
                    positionPicker={(roles.length > 1 || (preferredPosition && !link && roles.length > 0)) && <label className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-text-secondary">
                        Position in this profile
                        <select className={`${INPUT} h-8 w-auto max-w-full`} value={link?.position.id ?? ''} onChange={e => { setActivePosition(e.target.value); setMembership(null); }}>
                            {!link && <option value="">Choose a position</option>}
                            {roles.map(role => <option key={role.id} value={role.id}>{role.title}</option>)}
                        </select>
                    </label>}
                    pipeline={link ? { position: link.position, member: { ...link.member, record }, index: 1, total: 1, scopeLabel: link.position.title,
                        onPrev: null, onNext: null, onMoved: changed, onRemoved: () => { setMembership(null); changed(); } } : null} />
                {editing && <RecordForm orgId={orgId} record={record} open onClose={() => setEditing(false)} onSaved={saved => {
                    setProfile(current => current && { ...current, record: saved });
                    setEditing(false);
                    changed();
                }} />}
            </>
        ),
    };
}
