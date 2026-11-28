import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('recruitment messaging, candidate profiles, document changes and offers', { timeout: 90_000 }, async () => {
    const root = process.cwd();
    const bundle = await build({
        stdin: { contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import BulkOutreachDialog from './frontend/components/candidates/BulkOutreachDialog';
import PipelineView from './frontend/components/candidates/PipelineView';
import OutreachView from './frontend/components/candidates/OutreachView';
import ResumesView from './frontend/components/candidates/ResumesView';
import OffersView from './frontend/components/candidates/OffersView';
import ApplyPage from './app/apply/[token]/page';
const candidateParams = Promise.resolve({token:'candidate-docs'});
function Harness(){
 const [panel, setPanel] = useState('');
 const common = {orgId:'org'};
 if(location.pathname === '/resumes') return <ResumesView {...common} importRequest={1}/>;
 if(location.pathname === '/pipeline') return <PipelineView {...common} dataVersion={0} onDataChanged={()=>{}}/>;
 if(location.pathname === '/offers') return <OffersView {...common}/>;
 if(location.pathname === '/documents') return <ApplyPage params={candidateParams}/>;
 if(location.pathname === '/applications') return <OutreachView {...common}/>;
 return <>
   <button onClick={()=>setPanel('search')}>Search outreach</button>
   {panel === 'search' && <BulkOutreachDialog {...common} applicationIds={['record-1']} open onClose={()=>setPanel('')}/>}
 </>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`, loader: 'tsx', resolveDir: root },
        bundle: true, write: false, format: 'iife', tsconfig: resolve('tsconfig.json'), define: { 'process.env': '{}' },
        plugins: [{ name: 'test-folder', setup(builder) {
            builder.onResolve({ filter: /^\.\/folder-store$/ }, () => ({ path: 'folder-store', namespace: 'test' }));
            builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
                export const canRememberFolder = () => true;
                export const ensureReadable = () => true;
                export const forgetFolder = () => null;
                export const loadFolder = () => ({ name: 'Test source folder' });
                export const pickFolder = loadFolder;
                export const listFolderFiles = () => [{ file: new File(['test'], 'Synced resume.pdf', { type: 'application/pdf' }), folder: 'Test source folder' }];
            ` }));
        } }],
    });
    const css = (await postcss([tailwind()]).process(`@import "tailwindcss" source(none);
@source "./frontend/components/candidates";`, { from: resolve('recruitment-test.css') })).css;
    const base = 'http://localhost';
    const html = `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`;
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync) });
        const page = await browser.newPage({ viewport: { width: 1150, height: 850 }, reducedMotion: 'reduce' });
        page.setDefaultTimeout(7500);
        await page.route(`${base}/**`, route => route.fulfill({ body: html, contentType: 'text/html' }));
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const requests = [];
        let duplicatesCleared = false;
        let candidateReads = 0;
        let uploadedPhoto = false;
        let savedFeedback;
        let offerStatus = 'rejected';
        let letterFileName = null;
        const candidate = {
            id: 'record-1', candidateId: 'person-1', fullName: 'Asha Rao', email: 'asha@example.com', phone: '9876543210',
            currentDesignation: 'Engineer', currentOrganization: 'Example', location: 'Mumbai', role: 'Engineer', status: 'in_process',
            totalExpMonths: 12, relevantExpMonths: 12, noticePeriodDays: 30, currentInhand: null, expectedInhand: null,
            sheetId: null, sheetName: null, sourceRow: null, candidateSource: null, sourcingDate: '2026-11-10', remark: null,
            createdAt: '2026-11-10', updatedAt: '2026-11-20', deletedAt: null, indexed: true,
        };
        const position = { id: 'position-1', title: 'Engineer', location: 'Mumbai', status: 'open', filters: {}, prefer: {} };
        const file = { id: 'existing', fileName: 'Asha CV.pdf', fileSize: 1000, createdAt: '2026-11-20', downloadedAt: null, sourceKind: null,
            candidateId: candidate.candidateId, candidateName: candidate.fullName, textStatus: 'ready', extractStatus: 'done', removed: false, other: false };
        const application = { id: 'form-1', candidateId: candidate.candidateId, applicationId: candidate.id, positionId: position.id, positionTitle: position.title,
            name: candidate.fullName, email: candidate.email, phone: candidate.phone, hasResume: true, createdAt: '2026-11-23', answers: { email: candidate.email, phone: candidate.phone } };
        const form = { fields: [{ id:'email', label:'Email', type:'email', target:'email' }, { id:'phone', label:'Mobile number', type:'phone', target:'phone' }] };

        const interview = { id:'interview-1', positionId:position.id, positionTitle:position.title, mode:'online', round:'Director Interview',
            at:'2035-11-23T11:00', meetingId:'meeting-1', joinUrl:'https://example.test/room', meeting:{status:'scheduled',summary:null},
            status:'scheduled', followUpId:'interview-1', scorecards:[] };
        const offer = { id:'offer-1', candidateName:candidate.fullName, positionTitle:position.title, proposedCtc:550000, breakup:{ Basic:18000 },
            joiningDate:'2035-12-01', letter:'Here is the letter.', letterGaps:[], events:[], responseReason:'Update the CTC.', selectedNote:'First note' };

        await page.route('**/api/**', route => {
            const { pathname, searchParams } = new URL(route.request().url());
            const method = route.request().method();
            const contentType = route.request().headers()['content-type'] || '';
            const body = contentType.startsWith('application/json') ? route.request().postDataJSON() : route.request().postData();
            requests.push({ pathname, method, body, search: searchParams.toString() });
            const path = pathname.replace('/api/candidates', '');
            let json = {};
            if (path === '/interviews') json = { interviews: [interview] };
            if (path === '/offers') json = searchParams.has('handovers') ? { handovers:[] } : { offers:[{ ...offer, status:offerStatus, letterFileName }] };
            if (path === '/offers/offer-1' && method === 'PATCH') {
                offerStatus = 'pending';
                json = { offer:{ ...offer, status:offerStatus, proposedCtc:body.proposedCtc, currentApproverName:'Recruitment Approver' } };
            }
            if (path === '/offers/offer-1' && method === 'POST') {
                letterFileName = 'Offer letter.pdf';
                json = { offer:{ ...offer, status:offerStatus, letterFileName } };
            }
            if (path === '/api/public/apply/candidate-docs') {
                if (method === 'POST') {
                    uploadedPhoto = true;
                    json = { thanks:'Replacement received.' };
                } else json = { companyName:'Example', kind:'documents', role:'Engineer', form:{
                    title:'Your documents', intro:'Add or replace requested documents.', consentText:'I agree to send these files.', fields:[
                        { id:'doc_1', label:'PAN card', type:'file', required:false },
                        { id:'doc_2', label:'Payslip', type:'file', required:false },
                    ],
                }, documents: {
                    doc_1: uploadedPhoto ? { fileName:'clear.png', status:'uploaded' } : { fileName:'old.jpg', status:'rejected', reviewNote:'Please send a clearer photo.' },
                    doc_2: { fileName:'pay.pdf', status:'verified' },
                } };
            }
            if (path === '/outreach/settings') json = { settings: { offer:{ earnings:['Basic'], deductions:[], benefits:[] }, rejectionEmailTemplateId:'email_rejection', templates: [{ id:'wa_job_opening', channel:'whatsapp' }, { id:'email_job_opening', channel:'email' }] } };
            if (path === '/outreach/campaigns') json = method === 'POST'
                ? { done: true, campaign: { status:'done', counts:{ sent:1, failed:0, skipped:0, queued:0, sending:0, unknown:0 } } }
                : { campaigns: [], mailboxes: [{ id:'box', address:'hr@example.com' }] };
            if (path === '/outreach/preview') json = { preview: { canSend: true, checks:{withinHours:true}, stageUpdate:{defaultText:'Thank you for applying.'} } };
            if (path === '/positions') json = { positions: [position] };
            if (path.endsWith('/positions') && path !== '/positions') json = { memberships: [{
                position, member: { id:'member-1', positionId:position.id, candidateId:candidate.candidateId, applicationId:candidate.id, stage:'sourced', stageChangedAt:'2026-11-23' },
            }] };
            if (path === '/positions/position-1') json = { position, score: null };
            if (path === '/stages') json = { stages: [
                { key:'sourced', name:'Sourced', column:'Sourced', kind:'progress', tone:'blue', whatsapp:false, needsRemark:false, hidden:false },
                { key:'final_reject', name:'Final round reject', column:'Final', kind:'rejected', tone:'red', whatsapp:true, needsRemark:true, hidden:false },
            ], source:'database' };
            if (path.endsWith('/members')) json = { members: [{
                id:'member-1', positionId:position.id, record:candidate, applicationId:candidate.id, candidateId:candidate.candidateId,
                stage:'final_reject', stageChangedAt:'2026-11-23', addedAt:'2026-11-23', remark:null,
            }] };
            if (path === '/resume-mail') json = { connections: [] };
            if (path === '/resumes/summary') json = { total: 1, linked: 1, unlinked: 0, totalBytes: 1000, devices: [], textPending: 0, extractPending: 0, unreadable: 0 };
            if (path === '/resumes/repeats') {
                if (method === 'POST') { duplicatesCleared = true; json = { ok: true }; }
                else json = { repeats: [], total: 0 };
            }
            if (path === '/resumes') {
                const link = searchParams.get('link');
                if (link === 'duplicate' && !duplicatesCleared) json = { files: [{ ...file, id: 'dupe', fileName: searchParams.get('page') === '2' ? 'Later duplicate.pdf' : 'First duplicate.pdf' }], total: 22 };
                else if (link || searchParams.has('candidateId')) json = { files: [], total: 0 };
                else json = { files: [file], total: 1 };
            }
            if (path === '/applications') json = { applications: [application], total: 1, form };
            if (path === '/record-1' || path === '/person-1') {
                candidateReads += 1;
                json = { record: candidate };
            }
            if (path.endsWith('/actions')) {
                if (method === 'POST' && body.note?.kind === 'feedback') savedFeedback = { id:'feedback', action:'remark', toValue:'Interview feedback',
                    remark:body.note.note, meta:{ kind:'feedback', round:body.note.round, rating:body.note.rating, recommendation:body.note.recommendation }, byName:'Recruiter', at:'2026-11-26' };
                json = { actions: [savedFeedback, { id:'note', action:'remark', remark:'42inhand', meta:{bullets:[{label:'Current Salary', value:'₹42,000/month (in-hand)'}]}, byName:'Recruiter', at:'2026-11-25' }].filter(Boolean) };
            }
            if (path === '/calls') json = { calls: [] };
            if (path === '/messages') json = { messages: [] };
            return route.fulfill({ json });
        });

        await page.goto(base);
        await page.getByRole('button', { name: 'Search outreach' }).click();
        const search = page.getByRole('dialog');
        await search.getByRole('combobox', { name: /Position/ }).selectOption(position.id);
        await search.getByRole('checkbox', { name: 'WhatsApp', exact: true }).check();
        await search.getByRole('checkbox', { name: 'Email', exact: true }).check();
        await search.getByRole('button', { name: 'Send to 1 candidate' }).click();
        await search.getByText(/1 sent/).waitFor();
        const searchSends = requests.filter(x => x.pathname.endsWith('/outreach/campaigns') && x.method === 'POST');
        assert.equal(searchSends.length, 1);
        assert.deepEqual([searchSends[0].body.action, searchSends[0].body.whatsappTemplateId, searchSends[0].body.emailTemplateId], ['send','wa_job_opening','email_job_opening']);
        await search.getByRole('button', { name: 'Close', exact: true }).last().click();
        await page.goto(`${base}/pipeline`);
        await page.getByRole('button', { name: /^table$/i }).click().catch(error => { throw new Error(`${error.message}\n${errors.join('\n')}`); });
        await page.getByRole('button', { name: 'Notify candidate', exact: true }).click();
        const stage = page.getByRole('dialog', { name: 'Notify Asha Rao?' });
        await stage.getByRole('checkbox', { name: /^WhatsApp/ }).check();
        await stage.getByRole('checkbox', { name: /^Email/ }).check();
        await stage.getByRole('button', { name: 'Send', exact: true }).click();
        await stage.waitFor({ state: 'hidden' });
        const stageSends = requests.filter(x => x.method === 'POST' && x.body.expectedStage === 'final_reject');
        assert.deepEqual(stageSends.map(x => x.pathname).sort(), ['/api/candidates/outreach','/api/candidates/outreach/campaigns']);

        await page.goto(`${base}/resumes`);
        await page.getByRole('button', { name: 'Bulk upload folder' }).waitFor();
        await page.getByRole('button', { name: 'Upload resume files' }).waitFor();
        await page.getByRole('button', { name: 'Sync folder' }).click();
        await page.getByText('Synced resume.pdf', { exact: true }).waitFor();
        assert.equal(requests.filter(x => x.pathname.endsWith('/resumes') && x.method === 'POST').length, 0);
        await page.getByRole('button', { name: 'View duplicates' }).click();
        const dupe = page.getByRole('dialog', { name: 'Resume duplicate review' });
        await dupe.getByRole('button', { name: 'Next', exact: true }).click();
        await dupe.getByText('Later duplicate.pdf').waitFor();
        await dupe.getByRole('button', { name: 'Clear lists', exact: true }).click();
        await dupe.getByRole('button', { name: 'Clear both lists', exact: true }).click();
        await dupe.getByText('No new CVs waiting for review.').waitFor();
        await dupe.getByRole('button', { name: 'Close', exact: true }).last().click();
        await page.getByRole('button', { name: 'Resume library', exact: true }).click();
        await page.getByRole('button', { name: 'Asha Rao', exact: true }).click();
        const profile = page.getByRole('dialog', { name: 'Asha Rao' });
        await profile.getByRole('tab', { name: 'Overview' }).waitFor();
        await profile.getByText('₹42,000/month (in-hand)', { exact: false }).waitFor();
        await profile.getByRole('button', { name: 'Schedule interview', exact: true }).waitFor();
        await profile.getByRole('button', { name: 'Add feedback', exact: true }).click();
        await profile.getByRole('combobox', { name: 'Interview round' }).selectOption('Director Interview');
        await profile.getByRole('radio', { name: '4 of 5' }).click();
        await profile.getByRole('radio', { name: 'Move ahead', exact: true }).click();
        await profile.getByLabel('Feedback *', { exact: true }).fill('Clear work examples.');
        await profile.getByRole('button', { name: 'Save feedback', exact: true }).click();
        const remarks = profile.getByRole('region', { name: 'Candidate remarks' });
        await remarks.getByText(/Feedback · Director Interview · 4\/5/).waitFor();
        await remarks.getByText('Clear work examples.', { exact: true }).waitFor();
        await profile.getByRole('tab', { name: 'Interviews', exact: true }).click();
        await profile.getByRole('button', { name: 'Join call', exact: true }).waitFor();
        await profile.getByRole('button', { name: 'Copy', exact: true }).waitFor();
        assert.equal(await profile.getByRole('link', { name: 'Share on WhatsApp' }).count(), 0);
        assert.equal(await profile.getByRole('button', { name: 'Send update', exact: true }).count(), 0);
        const reads = candidateReads;
        await profile.getByRole('button', { name:'Refresh profile' }).click();
        await profile.getByRole('button', { name:'Refresh profile' }).waitFor();
        await page.waitForFunction(async () => !document.querySelector('button[aria-label="Refresh profile"]')?.disabled);
        assert.ok(candidateReads > reads);
        await profile.getByRole('tab', { name: /^Activity/ }).click();
        await profile.getByRole('button', { name:'Close', exact:true }).click();
        await page.getByRole('button', { name: 'Asha Rao', exact: true }).click();
        assert.equal(await profile.getByRole('tab', { name:'Overview', exact:true }).getAttribute('aria-selected'), 'true');

        await page.goto(`${base}/applications`);
        await page.getByRole('button', { name:'Applications', exact:true }).click();
        await page.getByRole('button', { name: /Asha Rao/ }).click();
        const drawer = page.getByRole('dialog', { name: 'Asha Rao' });
        await drawer.getByRole('button', { name: 'Copy email address' }).waitFor();
        await drawer.getByRole('button', { name: 'Copy phone number' }).waitFor();
        await drawer.getByRole('button', { name: 'Open candidate profile' }).click();
        await drawer.getByRole('tab', { name: 'Overview', exact:true }).waitFor();
        await page.goto(`${base}/documents`);
        await page.getByText('Please send a clearer photo.', { exact: true }).waitFor();
        assert.equal(await page.locator('#f-doc_2').count(), 0);
        const photo = page.locator('#f-doc_1');
        assert.match(await photo.getAttribute('accept'), /image\/png/);
        await photo.setInputFiles({ name:'clear.png', mimeType:'image/png', buffer:Buffer.from('test upload') });
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name:'Upload documents', exact:true }).click();
        await page.getByText('Replacement received.', { exact:true }).waitFor();
        await page.getByText(/Waiting for review · clear.png/).waitFor();
        assert.ok(requests.some(request => request.pathname === '/api/public/apply/candidate-docs' && request.method === 'POST' && request.body.includes('clear.png')));

        await page.goto(`${base}/offers`);
        await page.getByRole('button', { name:'All', exact:true }).click();
        await page.getByRole('button', { name:'Revise offer', exact:true }).click();
        const revise = page.getByRole('dialog', { name:/Revise offer/ });
        await revise.getByText('Update the CTC.').waitFor();
        assert.equal(await revise.getByLabel('Offer CTC (lakhs per year)').inputValue(), '5.5');
        await revise.getByLabel('Offer CTC (lakhs per year)').fill('5.2');
        await revise.getByRole('button', { name:'Save and send for approval' }).click();
        await revise.waitFor({ state:'hidden' });
        assert.ok(requests.some(request => request.pathname.endsWith('/offers/offer-1') && request.body?.action === 'revise_offer' && request.body.proposedCtc === 520000));
        offerStatus = 'approved';
        await page.reload();
        await page.getByLabel('Offer letter PDF', { exact:true }).setInputFiles({ name:'Offer letter.pdf', mimeType:'application/pdf', buffer:Buffer.from('%PDF-1.7') });
        await page.getByRole('button', { name:'Attach PDF', exact:true }).click();
        await page.getByRole('link', { name:'Offer letter.pdf', exact:true }).waitFor();
        assert.ok(requests.some(request => request.pathname.endsWith('/offers/offer-1') && request.method === 'POST' && request.body.includes('Offer letter.pdf')));
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
    }
});
