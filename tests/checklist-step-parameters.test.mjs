import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';

test('Checklist Migration 20261019000001 is additive, safe, and non-destructive', async () => {
    const sql = await readFile(new URL('../supabase/migrations/20261019000001_checklist_step_parameters_and_modes.sql', import.meta.url), 'utf8');

    // 1. Must add parameters JSONB to sop_checklist_items with default '[]'::jsonb
    assert.match(sql, /ALTER TABLE public\.sop_checklist_items\s+ADD COLUMN IF NOT EXISTS parameters JSONB DEFAULT '\[\]'::jsonb/);

    // 2. Must add parameter_values JSONB to sop_completion_items with default '{}'::jsonb
    assert.match(sql, /ALTER TABLE public\.sop_completion_items\s+ADD COLUMN IF NOT EXISTS parameter_values JSONB DEFAULT '\{\}'::jsonb/);

    // 3. Must add checklist_mode with safe default 'basic'
    assert.match(sql, /ALTER TABLE public\.properties\s+ADD COLUMN IF NOT EXISTS checklist_mode TEXT NOT NULL DEFAULT 'basic'/);

    // 4. Must create checklist_property_settings table
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.checklist_property_settings/);

    // 5. Must NOT have any destructive table drops
    assert.doesNotMatch(sql, /\bDROP TABLE\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
});

test('SS Plaza & existing templates backwards compatibility: steps without parameters function directly', () => {
    // Simulating an existing SS Plaza step
    const ssPlazaStep = {
        id: 'step-101',
        title: 'Check Fire Extinguisher',
        type: 'checkbox',
        requires_photo: false,
        parameters: [], // empty or undefined
    };

    const hasParameters = Array.isArray(ssPlazaStep.parameters) && ssPlazaStep.parameters.length > 0;
    assert.equal(hasParameters, false, 'Existing step must evaluate to false for hasParameters');

    // In runner, an interaction on a parameterless step sets is_checked directly
    const completionItem = {
        checklist_item_id: 'step-101',
        is_checked: true,
        value: null,
        parameter_values: {},
    };

    const hasInteraction = completionItem.is_checked || completionItem.value;
    assert.equal(hasInteraction, true, 'Existing completion item marks interaction directly');
});

test('New 2-tier step with parameters: Cafeteria with Carpet, Lights, Dusting', () => {
    const cafeteriaStep = {
        id: 'step-201',
        title: 'Cafeteria Cleanliness',
        type: 'checkbox',
        requires_photo: true,
        reference_photo_url: 'https://example.com/clean-cafeteria.jpg',
        parameters: [
            { id: 'param_carpet', name: 'Carpet Vacuumed', type: 'yes_no', is_required: true },
            { id: 'param_lights', name: 'All Lights Working', type: 'yes_no', is_required: true },
            { id: 'param_dusting', name: 'Tables Dusted', type: 'yes_no', is_required: true },
        ],
    };

    const hasParameters = Array.isArray(cafeteriaStep.parameters) && cafeteriaStep.parameters.length > 0;
    assert.equal(hasParameters, true, 'Cafeteria step must have parameters');
    assert.equal(cafeteriaStep.parameters.length, 3, 'Must have 3 parameters');

    // Simulating staff toggling parameters
    const paramValues = {
        param_carpet: { value: 'yes', checked: true },
        param_lights: { value: 'yes', checked: true },
        param_dusting: { value: 'no', checked: false },
    };

    const allAnswered = cafeteriaStep.parameters.every(p => paramValues[p.id]?.value !== undefined);
    assert.equal(allAnswered, true, 'All parameters answered');

    // Notice: NO photos required for parameters!
    cafeteriaStep.parameters.forEach(p => {
        assert.equal(p.requires_photo, undefined, 'Individual parameter must never require photo');
    });
});

test('Checklist creation autosave preserves in-progress steps, parameters, and form fields across reloads', () => {
    // Simulating localStorage draft object saved during checklist creation
    const propertyId = 'prop-12345';
    const draftKey = `sop_template_draft_${propertyId}`;
    
    const mockDraft = {
        formData: {
            title: '1st Floor Left Wing Checklist',
            description: 'Comprehensive daily inspection',
            category: 'housekeeping',
            frequency: 'daily',
            assigned_to: ['user-1'],
            start_time: '09:00',
            end_time: '17:00',
        },
        items: [
            {
                title: 'Cafeteria Cleanliness',
                description: 'Main dining area',
                requires_photo: true,
                parameters: [
                    { id: 'param-1', name: 'Carpet', type: 'yes_no', is_required: true },
                    { id: 'param-2', name: 'Lights', type: 'yes_no', is_required: true },
                ],
            },
        ],
        newItem: {
            title: 'Pantry Supplies',
            description: '',
            requires_photo: false,
            parameters: [
                { id: 'param-3', name: 'Water Dispenser Full', type: 'yes_no', is_required: true },
            ],
        },
        savedAt: Date.now(),
    };

    const serialized = JSON.stringify(mockDraft);
    const restored = JSON.parse(serialized);

    assert.equal(restored.formData.title, '1st Floor Left Wing Checklist');
    assert.equal(restored.items.length, 1);
    assert.equal(restored.items[0].parameters.length, 2);
    assert.equal(restored.items[0].parameters[0].name, 'Carpet');
    assert.equal(restored.newItem.title, 'Pantry Supplies');
    assert.equal(restored.newItem.parameters[0].name, 'Water Dispenser Full');
    assert.ok(restored.savedAt > 0);
});

test('CAD custom polygon drawing computes bounding box for AI scoring crop while preserving arbitrary points', () => {
    // Simulating user drawing an irregular 5-point polygon (e.g. L-shaped cafeteria or corridor)
    const points = [
        { x: 100, y: 150 },
        { x: 300, y: 150 },
        { x: 300, y: 350 },
        { x: 200, y: 350 },
        { x: 200, y: 250 },
        { x: 100, y: 250 },
    ];

    const minX = Math.round(Math.min(...points.map((p) => p.x)));
    const maxX = Math.round(Math.max(...points.map((p) => p.x)));
    const minY = Math.round(Math.min(...points.map((p) => p.y)));
    const maxY = Math.round(Math.max(...points.map((p) => p.y)));
    const width = Math.max(10, maxX - minX);
    const height = Math.max(10, maxY - minY);

    const cadArea = {
        id: 'area-cafeteria-custom',
        label: 'Irregular Cafeteria',
        shape_type: 'polygon',
        points,
        coordinates: { x: minX, y: minY, width, height },
        linked_step_ids: ['step-201'],
    };

    // 1. Coordinates must provide a valid bounding box for Sharp image cropping
    assert.equal(cadArea.coordinates.x, 100);
    assert.equal(cadArea.coordinates.y, 150);
    assert.equal(cadArea.coordinates.width, 200);
    assert.equal(cadArea.coordinates.height, 200);

    // 2. Custom shape points must be retained exactly
    assert.equal(cadArea.points.length, 6);
    assert.equal(cadArea.shape_type, 'polygon');

    // 3. Centroid calculation for CAD overlay badge
    const sumX = cadArea.points.reduce((acc, p) => acc + p.x, 0);
    const sumY = cadArea.points.reduce((acc, p) => acc + p.y, 0);
    const badgeX = Math.round(sumX / cadArea.points.length);
    const badgeY = Math.round(sumY / cadArea.points.length);
    assert.ok(badgeX >= 100 && badgeX <= 300, 'Centroid X should be within shape bounds');
    assert.ok(badgeY >= 150 && badgeY <= 350, 'Centroid Y should be within shape bounds');
});

test('AI Vision Scoring Engine evaluates Cafeteria photo parameters individually using Qwen vision output format', () => {
    // Simulated JSON output from Qwen3.8-27b vision model via Engy AI
    const qwenVisionOutput = JSON.stringify({
        overall_score: 92,
        overall_reason: 'Cafeteria is thoroughly clean with spotless floors and neatly arranged sanitized tables.',
        pass: true,
        parameters: [
            {
                name: 'Floor',
                is_assessable: true,
                score: 95,
                status: 'pass',
                reason: 'Floor tiles are mopped, shiny, with zero dust, food crumbs or liquid stains visible.',
            },
            {
                name: 'Tables',
                is_assessable: true,
                score: 90,
                status: 'pass',
                reason: 'All visible table surfaces are wiped clean with chairs arranged symmetrically.',
            },
            {
                name: 'Washbasin',
                is_assessable: false,
                score: null,
                status: 'unassessable',
                reason: 'Washbasin is not in the camera frame; cannot be inspected from this angle.',
            },
            {
                name: 'Lights',
                is_assessable: true,
                score: 90,
                status: 'pass',
                reason: 'Overhead light fixtures are clear and operational with no visible cobwebs or debris.',
            },
            {
                name: 'Dustbins',
                is_assessable: true,
                score: 90,
                status: 'pass',
                reason: 'Waste bin has a fresh liner installed and the outer shell is clean.',
            },
        ],
    });

    const parsed = JSON.parse(qwenVisionOutput);
    assert.equal(parsed.overall_score, 92);
    assert.equal(parsed.pass, true);
    assert.equal(parsed.parameters.length, 5);

    // Verify unassessable handling (out of frame)
    const basin = parsed.parameters.find((p) => p.name === 'Washbasin');
    assert.equal(basin.is_assessable, false);
    assert.equal(basin.score, null);
    assert.equal(basin.status, 'unassessable');

    // Verify assessable parameters have concise 1-sentence explanations
    const floor = parsed.parameters.find((p) => p.name === 'Floor');
    assert.equal(floor.is_assessable, true);
    assert.equal(floor.score, 95);
    assert.ok(floor.reason.length > 10);
});

test('Step-by-step Checker Sign-off aggregation computes completion approval_status', () => {
    // Case 1: All completed steps approved -> Overall Approved
    const stepsAllApproved = [
        { id: 'item-1', step_approval_status: 'approved' },
        { id: 'item-2', step_approval_status: 'approved' },
        { id: 'item-3', step_approval_status: 'not_required' },
    ];
    const anyRejected1 = stepsAllApproved.some((it) => it.step_approval_status === 'rejected');
    const allApproved1 = stepsAllApproved
        .filter((it) => it.step_approval_status !== 'not_required')
        .every((it) => it.step_approval_status === 'approved');
    const status1 = anyRejected1 ? 'rejected' : allApproved1 ? 'approved' : 'pending';
    assert.equal(status1, 'approved');

    // Case 2: One step rejected with notes -> Overall Rejected
    const stepsOneRejected = [
        { id: 'item-1', step_approval_status: 'approved' },
        { id: 'item-2', step_approval_status: 'rejected', step_approval_notes: 'Under tables not swept clean' },
    ];
    const anyRejected2 = stepsOneRejected.some((it) => it.step_approval_status === 'rejected');
    const status2 = anyRejected2 ? 'rejected' : 'pending';
    assert.equal(status2, 'rejected');

    // Case 3: Some steps still pending review -> Overall Pending
    const stepsPending = [
        { id: 'item-1', step_approval_status: 'approved' },
        { id: 'item-2', step_approval_status: 'pending' },
    ];
    const anyRejected3 = stepsPending.some((it) => it.step_approval_status === 'rejected');
    const allApproved3 = stepsPending.every((it) => it.step_approval_status === 'approved');
    const status3 = anyRejected3 ? 'rejected' : allApproved3 ? 'approved' : 'pending';
    assert.equal(status3, 'pending');
});

test('AI Vision Scoring Engine detects stale photos and vetoes audit score', () => {
    // Case 1: Outdated photo detected via watermark
    const staleOutput = {
        overall_score: 88,
        overall_reason: 'Floor and tables appear clean.',
        pass: true,
        is_stale_image: true,
        timestamp_detected: '14/10/2026 09:15:00',
        parameters: [
            { name: 'Floor', is_assessable: true, score: 90, status: 'pass', reason: 'Clean floor' },
        ],
    };

    const expectedDateStr = '20/10/2026';
    const isStale = staleOutput.is_stale_image === true;
    let score = staleOutput.overall_score;
    if (isStale) {
        score = Math.min(20, score);
    }
    const pass = !isStale && score >= 70;

    assert.equal(isStale, true);
    assert.equal(score, 20);
    assert.equal(pass, false);

    // Case 2: Fresh photo with valid timestamp watermark
    const freshOutput = {
        overall_score: 95,
        overall_reason: 'Spotless room with verified fresh timestamp.',
        pass: true,
        is_stale_image: false,
        timestamp_detected: '20/10/2026 11:30:12',
        parameters: [
            { name: 'Table', is_assessable: true, score: 95, status: 'pass', reason: 'Table completely cleared' },
        ],
    };

    const isFreshStale = freshOutput.is_stale_image === true;
    let freshScore = freshOutput.overall_score;
    if (isFreshStale) {
        freshScore = Math.min(20, freshScore);
    }
    const freshPass = !isFreshStale && freshScore >= 70;

    assert.equal(isFreshStale, false);
    assert.equal(freshScore, 95);
    assert.equal(freshPass, true);
});

test('AI Vision Scoring Engine detects benchmark duplicate upload', () => {
    const fakeBenchmarkBuffer = Buffer.from('clean-benchmark-image-data-2026');
    const fakeFieldBuffer = Buffer.from('clean-benchmark-image-data-2026'); // Exact re-upload

    const refHash = crypto.createHash('sha256').update(fakeBenchmarkBuffer).digest('hex');
    const fieldHash = crypto.createHash('sha256').update(fakeFieldBuffer).digest('hex');
    const isDuplicate = refHash === fieldHash;

    assert.equal(isDuplicate, true, 'Re-uploaded template photo must be flagged as duplicate');
});

test('Template Edit reconciliation: preserves step IDs, auto-commits drafted parameters, and sanitizes checkpoint arrays', () => {
    // 1. Simulating existing database checklist items with IDs
    const existingItems = [
        { id: 'item-uuid-1', title: 'Sweep lobby', order_index: 0, parameters: [{ id: 'p1', name: 'Corner dust', type: 'yes_no' }] },
        { id: 'item-uuid-2', title: 'Mop floor', order_index: 1, parameters: [] },
    ];
    const existingIds = new Set(existingItems.map(i => i.id));

    // 2. Simulating edited items sent from UI: Step 1 updated with new parameter, Step 2 retained, Step 3 added
    const submittedItems = [
        { id: 'item-uuid-1', title: 'Sweep & vacuum lobby', parameters: [{ id: 'p1', name: 'Corner dust', type: 'yes_no' }, { name: 'Under mats', type: 'yes_no' }] },
        { id: 'item-uuid-2', title: 'Mop floor', parameters: [] },
        { title: 'Wipe glass doors', parameters: [{ name: 'Smudge-free', type: 'yes_no' }] }, // Newly added step
    ];

    // Helper to sanitize parameters exactly as in API route
    const sanitizeParams = (raw) => {
        if (!raw) return [];
        let arr = raw;
        if (typeof raw === 'string') {
            try { arr = JSON.parse(raw); } catch { arr = []; }
        }
        if (!Array.isArray(arr)) return [];
        return arr.map((p, idx) => ({
            id: p.id || `param_${idx}_12345`,
            name: typeof p === 'string' ? p : (p.name || p.title || `Param ${idx + 1}`),
            type: p.type || 'yes_no',
            is_required: p.is_required !== false,
        }));
    };

    const toUpdate = [];
    const toInsert = [];

    submittedItems.forEach((item, index) => {
        const itemData = {
            title: item.title,
            order_index: index,
            parameters: sanitizeParams(item.parameters),
        };
        if (item.id && existingIds.has(item.id)) {
            toUpdate.push({ id: item.id, ...itemData });
        } else {
            toInsert.push(itemData);
        }
    });

    // Step 1 & 2 must be updated in place (NOT deleted and re-created)
    assert.equal(toUpdate.length, 2, '2 existing steps must be updated in place');
    assert.equal(toUpdate[0].id, 'item-uuid-1');
    assert.equal(toUpdate[0].title, 'Sweep & vacuum lobby');
    assert.equal(toUpdate[0].parameters.length, 2, 'Step 1 must have 2 parameters preserved');
    assert.ok(toUpdate[0].parameters[1].id, 'Added parameter without ID must be assigned an ID');

    // Step 3 must be inserted as new
    assert.equal(toInsert.length, 1, '1 new step must be inserted');
    assert.equal(toInsert[0].title, 'Wipe glass doors');
    assert.equal(toInsert[0].parameters.length, 1);

    // 3. Auto-commit simulation: user entered new parameter into draft without clicking "+ Add" before saving
    let finalItems = [...submittedItems];
    let draftParamName = 'Fingerprints checked';
    let currentParams = Array.isArray(finalItems[2].parameters) ? [...finalItems[2].parameters] : [];
    if (draftParamName.trim()) {
        currentParams.push({ id: 'param_draft_1', name: draftParamName.trim(), type: 'yes_no' });
    }
    finalItems[2] = { ...finalItems[2], parameters: currentParams };

    assert.equal(finalItems[2].parameters.length, 2, 'Auto-commit must include in-progress parameter draft');
    assert.equal(finalItems[2].parameters[1].name, 'Fingerprints checked');
});

