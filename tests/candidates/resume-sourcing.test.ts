import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sourceFromResumeName } from '../../backend/lib/candidates/resume-source';
import { listResumeFiles, parseResumeQuery, prepareResumeUploads, resumeManifest, resumeWorkbook, updateResumeMetadata, type ResumeStorage } from '../../backend/lib/candidates/resumes';
import { freshDb, RESUME_SOURCING_MIGRATION } from './db-stub';
import { pgliteSupabase } from './pglite-supabase';

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const USER = { id: '00000000-0000-0000-0000-000000000001', email: 'hr@example.com' };
const storage = {
    createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}`, token: 'test', path }, error: null }),
} as ResumeStorage;
const file = (index: number, name: string, extra = {}) => ({ index, name, size: 1000, sha256: createHash('sha256').update(name).digest('hex'), ...extra });
const query = (params = {}) => parseResumeQuery(new URLSearchParams(params));

it('detects filename sources case-insensitively and leaves conflicting markers unknown', () => {
    assert.deepEqual(sourceFromResumeName('NAUKRI_Asha.pdf'), { kind: 'naukri', name: null });
    assert.deepEqual(sourceFromResumeName('Bilal_LinkedIn123.pdf'), { kind: 'portal', name: 'LinkedIn' });
    for (const name of ['CV.pdf', 'Naukri_LinkedIn.pdf']) assert.deepEqual(sourceFromResumeName(name), { kind: null, name: null });
});

describe('resume sourcing and assigned designations', () => {
    let db: PGlite;
    let client: SupabaseClient;
    before(async () => {
        db = await freshDb(); client = pgliteSupabase(db);
        await db.query('insert into public.organizations (id) values ($1), ($2)', [ORG, OTHER]);
        await db.query('insert into auth.users (id) values ($1)', [USER.id]);
    });
    after(async () => { await db.close(); });

    it('stores mixed sources and per-file role overrides; duplicates preserve the first labels', async () => {
        const input = { device: 'HR user', sourcedRole: 'Facility Manager', files: [
            file(0, 'Asha_Naukri.pdf'), file(1, 'Bilal_LinkedIn.pdf', { sourcedRole: 'Engineer' }),
            file(2, 'Chetan_LinkedIn.pdf', { source: { kind: null, name: null }, sourcedRole: null }),
            file(3, 'Deepa_Naukri.pdf', { source: { kind: 'vendor', name: 'Talent Hub' } }),
        ] };
        const prepared = await prepareResumeUploads(client, storage, ORG, USER, input);
        assert.ok(prepared.files.every(f => f.outcome === 'upload'));
        await db.query("update public.candidate_resume_files set status='ready' where organization_id=$1", [ORG]);
        const files = (await listResumeFiles(client, ORG, query())).files.sort((a, b) => a.fileName.localeCompare(b.fileName));
        assert.deepEqual(files.map(f => [f.sourceKind, f.sourceName, f.sourcedRole]), [
            ['naukri', null, 'Facility Manager'], ['portal', 'LinkedIn', 'Engineer'], [null, null, null], ['vendor', 'Talent Hub', 'Facility Manager'],
        ]);
        const duplicate = await prepareResumeUploads(client, storage, ORG, USER, { ...input, sourcedRole: 'Wrong role', source: { kind: 'own', name: null } });
        assert.ok(duplicate.files.every(f => f.outcome === 'duplicate'));
        assert.equal((await listResumeFiles(client, ORG, query({ source: 'naukri' }))).files[0].sourcedRole, 'Facility Manager');
        const batch = await prepareResumeUploads(client, storage, ORG, USER, { device: 'HR user', source: { kind: 'own', name: null }, files: [file(0, 'Batch_Naukri.pdf')] });
        const row = await db.query<{ source_kind: string }>('select source_kind from public.candidate_resume_files where id=$1', [batch.files[0].id]);
        assert.equal(row.rows[0].source_kind, 'own');
        await prepareResumeUploads(client, storage, ORG, USER, { device: 'HR user', files: [file(0, 'Batch_Naukri.pdf')] });
        const retried = await db.query<{ source_kind: string }>('select source_kind from public.candidate_resume_files where id=$1', [batch.files[0].id]);
        assert.equal(retried.rows[0].source_kind, 'own', 'an unfinished upload keeps its source when a legacy caller retries without labels');
    });

    it('uses the same source/designation filters for the list, ZIP and Excel', async () => {
        const q = query({ source: 'linkedin', sourcedRole: 'engineer' });
        const list = await listResumeFiles(client, ORG, q);
        assert.deepEqual(list.files.map(f => f.fileName), ['Bilal_LinkedIn.pdf']);
        const manifest = await resumeManifest(client, ORG, q);
        assert.deepEqual(manifest.files.map(f => f.id), list.files.map(f => f.id));
        const { workbook, count } = await resumeWorkbook(client, ORG, q, 'https://app.test/resumes');
        assert.equal(count, 1);
        const sheet = workbook.getWorksheet('Resume files')!;
        assert.equal(sheet.getRow(2).getCell('source').value, 'LinkedIn');
        assert.equal(sheet.getRow(2).getCell('role').value, 'Engineer');
        assert.equal((await listResumeFiles(client, ORG, query({ source: 'unknown' }))).total, 1);
        assert.equal((await listResumeFiles(client, ORG, query({ source: 'portal' }))).total, 0);
        assert.equal((await listResumeFiles(client, ORG, query({ sourcedRole: '%' }))).total, 0, 'wildcards are literal');
        assert.equal((await listResumeFiles(client, OTHER, q)).total, 0);
    });

    it('allows corrections only in the file’s organization, without changing the candidate', async () => {
        const f = (await listResumeFiles(client, ORG, query({ source: 'naukri' }))).files[0];
        const candidateId = '00000000-0000-0000-0000-000000000099';
        await db.query("insert into public.candidates (id, organization_id, full_name, current_designation) values ($1,$2,'Asha','Executive')", [candidateId, ORG]);
        await db.query('update public.candidate_resume_files set candidate_id=$1 where id=$2', [candidateId, f.id]);
        const metadata = { source: { kind: 'portal', name: 'LinkedIn' }, sourcedRole: 'Manager' };
        await assert.rejects(updateResumeMetadata(client, OTHER, f.id, metadata), /no longer here/);
        await updateResumeMetadata(client, ORG, f.id, metadata);
        assert.equal((await listResumeFiles(client, ORG, query({ sourcedRole: 'Manager', source: 'linkedin' }))).total, 1);
        const person = await db.query<{ current_designation: string }>('select current_designation from public.candidates where id=$1', [candidateId]);
        assert.equal(person.rows[0].current_designation, 'Executive');
        await assert.rejects(updateResumeMetadata(client, ORG, f.id, { ...metadata, sourcedRole: 'x'.repeat(201) }), /Check/);
        await assert.rejects(prepareResumeUploads(client, storage, ORG, USER, { device: 'HR user', files: [file(0, 'Bad.pdf', { source: { kind: 'invalid', name: null } })] }), /Send files/);
    });
});

it('backfills only unlabelled legacy files once and reports missing migration without losing the role', async () => {
    const db = await freshDb({ resumeSourcing: false });
    try {
        await db.query('insert into public.organizations (id) values ($1)', [ORG]);
        await db.query('insert into auth.users (id) values ($1)', [USER.id]);
        const client = pgliteSupabase(db);
        const prepared = await prepareResumeUploads(client, storage, ORG, USER, { device: 'HR user', files: [file(0, 'Legacy_Naukri.pdf'), file(1, 'Legacy_LinkedIn.pdf'), file(2, 'Known_Naukri.pdf', { source: { kind: 'vendor', name: 'Original vendor' } }), file(3, 'Both_Naukri_LinkedIn.pdf')] });
        await db.query('update public.candidate_resume_files set source_kind=null, source_name=null where id=any($1::uuid[])', [prepared.files.slice(0, 2).map(f => f.id)]);
        await assert.rejects(prepareResumeUploads(client, storage, ORG, USER, { device: 'HR user', sourcedRole: 'Engineer', files: [file(0, 'NeedsMigration.pdf')] }), /20261122000001/);
        await db.exec(RESUME_SOURCING_MIGRATION);
        const labels = (await db.query<{ file_name: string; source_kind: string | null; source_name: string | null }>('select file_name, source_kind, source_name from public.candidate_resume_files order by file_name')).rows;
        assert.deepEqual(labels.map(r => [r.source_kind, r.source_name]), [[null, null], ['vendor', 'Original vendor'], ['portal', 'LinkedIn'], ['naukri', null]]);
        await db.query('update public.candidate_resume_files set source_kind=null, source_name=null where id=$1', [prepared.files[0].id]);
        await db.exec(RESUME_SOURCING_MIGRATION);
        const corrected = await db.query<{ source_kind: string | null }>('select source_kind from public.candidate_resume_files where id=$1', [prepared.files[0].id]);
        assert.equal(corrected.rows[0].source_kind, null, 'rerunning preserves HR’s explicit Unknown correction');
    } finally { await db.close(); }
});
