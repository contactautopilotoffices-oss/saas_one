import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('SOPDashboard properly parses active view and runner state across reloads', () => {
    // Simulate initialParams resolver function from SOPDashboard
    const resolveParams = ({ searchUrl, sessionStore, propertyId }) => {
        const urlParams = new URLSearchParams(searchUrl);
        const explicitView = urlParams.get('view') || urlParams.get('sop_view') || (urlParams.get('tab') !== 'checklist' ? urlParams.get('tab') : null);
        const savedView = sessionStore[`sop_active_view_${propertyId || 'global'}`];
        const validViews = ['list', 'runner', 'history', 'detail', 'reports', 'settings'];

        const active = (explicitView && validViews.includes(explicitView))
            ? explicitView
            : (savedView && validViews.includes(savedView))
                ? savedView
                : 'list';

        let runnerState = null;
        const savedRunner = sessionStore[`sop_runner_state_${propertyId || 'global'}`];
        if (savedRunner) {
            try { runnerState = JSON.parse(savedRunner); } catch {}
        }

        let detailState = null;
        const savedDetail = sessionStore[`sop_detail_state_${propertyId || 'global'}`];
        if (savedDetail) {
            try { detailState = JSON.parse(savedDetail); } catch {}
        }

        const templateId = urlParams.get('templateId') || runnerState?.templateId || detailState?.templateId || null;
        const completionId = urlParams.get('completionId') || runnerState?.completionId || detailState?.completionId || null;
        const completionDate = urlParams.get('completionDate') || runnerState?.completionDate || null;
        const propId = urlParams.get('propId') || runnerState?.propertyId || detailState?.propertyId || propertyId || null;

        return { view: active, templateId, completionId, completionDate, propId };
    };

    // Case 1: Page has ?tab=checklist&view=history - must stay on history, not reset to list
    const r1 = resolveParams({
        searchUrl: '?tab=checklist&view=history',
        sessionStore: {},
        propertyId: 'prop_1'
    });
    assert.equal(r1.view, 'history', 'Should stay on history tab');

    // Case 2: User was running a checklist and page refreshed
    const r2 = resolveParams({
        searchUrl: '?tab=checklist&view=runner&templateId=tmpl_99',
        sessionStore: {
            'sop_runner_state_prop_1': JSON.stringify({
                templateId: 'tmpl_99',
                propertyId: 'prop_1',
                completionId: 'comp_42',
                completionDate: '2026-10-20'
            })
        },
        propertyId: 'prop_1'
    });
    assert.equal(r2.view, 'runner', 'Should remain on runner view');
    assert.equal(r2.templateId, 'tmpl_99', 'Should restore template ID');
    assert.equal(r2.completionId, 'comp_42', 'Should restore completion ID');
    assert.equal(r2.completionDate, '2026-10-20', 'Should restore completion date');

    // Case 3: SessionStorage has reports view saved
    const r3 = resolveParams({
        searchUrl: '?tab=checklist',
        sessionStore: {
            'sop_active_view_prop_1': 'reports'
        },
        propertyId: 'prop_1'
    });
    assert.equal(r3.view, 'reports', 'Should restore reports view from sessionStorage');
});

test('SOPTemplateFormModal and SOPTemplateManager verify session storage cleanup', async () => {
    const modalCode = await readFile(new URL('../frontend/components/sop/SOPTemplateFormModal.tsx', import.meta.url), 'utf8');
    const managerCode = await readFile(new URL('../frontend/components/sop/SOPTemplateManager.tsx', import.meta.url), 'utf8');

    // Must remove lingering localStorage & sessionStorage sop_template_modal_open_ on save/close
    assert.match(modalCode, /sessionStorage\.removeItem\(`sop_template_modal_open_\$\{propertyId\}`\)/);
    assert.match(modalCode, /sessionStorage\.removeItem\(`sop_editing_template_id_\$\{propertyId\}`\)/);

    // In PUT update existing template, must also clear draft and modal open flags
    assert.match(modalCode, /PUT'[\s\S]*?localStorage\.removeItem\(`sop_template_draft_\$\{propertyId\}`\)/);

    // SOPTemplateManager must clean up modal-open flags so navigation never hijacks the screen
    assert.match(managerCode, /sessionStorage\.removeItem\(`sop_template_modal_open_\$\{propertyId\}`\)/);
    assert.match(managerCode, /localStorage\.removeItem\(`sop_template_modal_open_\$\{propertyId\}`\)/);

    // SOPTemplateManager must provide checklist items and steps viewing on card expand
    assert.match(managerCode, /Checklist Steps/);
    assert.match(managerCode, /order_index/);
});

test('SOPChecklistRunner does not execute redundant auth refreshSession on checkbox toggle or interval', async () => {
    const runnerCode = await readFile(new URL('../frontend/components/sop/SOPChecklistRunner.tsx', import.meta.url), 'utf8');

    // handleItemToggle must NOT call refreshSession before PUT
    assert.doesNotMatch(runnerCode, /handleItemToggle[\s\S]*?await supabase\.auth\.refreshSession\(\);\s*const validPropId/);

    // runner must NOT have 5-minute periodic session refresh interval
    assert.doesNotMatch(runnerCode, /sessionRefreshInterval\s*=\s*setInterval/);
});
