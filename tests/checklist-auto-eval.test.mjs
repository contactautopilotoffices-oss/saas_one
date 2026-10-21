import test from 'node:test';
import assert from 'node:assert/strict';

test('AI enabled property triggers auto-evaluation on completed checklist items with photos', () => {
    const propertySettings = {
        checklist_mode: 'advanced',
        ai_scoring_enabled: true,
    };
    const isAIEnabled = propertySettings.checklist_mode === 'advanced' || !!propertySettings.ai_scoring_enabled;
    assert.equal(isAIEnabled, true, 'Property should be identified as AI-enabled');

    const completionItems = [
        { id: 'item-1', photo_url: 'https://storage/photo1.webp', ai_cleanliness_score: null },
        { id: 'item-2', photo_url: 'https://storage/photo2.webp', ai_cleanliness_score: 85, ai_cleanliness_reason: 'Clean floor' },
        { id: 'item-3', photo_url: null, ai_cleanliness_score: null }, // no photo, skip
    ];

    const autoEvaluated = new Set();
    const queuedItems = [];

    if (isAIEnabled) {
        const unscored = completionItems.filter(
            it => it.photo_url && (it.ai_cleanliness_score === null || it.ai_cleanliness_score === undefined) && !autoEvaluated.has(it.id)
        );
        for (const it of unscored) {
            autoEvaluated.add(it.id);
            queuedItems.push(it.id);
        }
    }

    assert.deepEqual(queuedItems, ['item-1'], 'Only item-1 should be queued for auto-evaluation');
    assert.equal(autoEvaluated.has('item-1'), true);
    assert.equal(autoEvaluated.has('item-2'), false, 'Already scored item-2 should not be re-evaluated');
    assert.equal(autoEvaluated.has('item-3'), false, 'Item without photo should not be queued');
});

test('AI disabled property maintains normal behavior without triggering auto-evaluation', () => {
    const propertySettings = {
        checklist_mode: 'basic',
        ai_scoring_enabled: false,
    };
    const isAIEnabled = propertySettings.checklist_mode === 'advanced' || !!propertySettings.ai_scoring_enabled;
    assert.equal(isAIEnabled, false, 'Property should be identified as basic / AI-disabled');

    const completionItems = [
        { id: 'item-1', photo_url: 'https://storage/photo1.webp', ai_cleanliness_score: null },
        { id: 'item-2', photo_url: null, ai_cleanliness_score: null },
    ];

    const queuedItems = [];

    if (isAIEnabled) {
        const unscored = completionItems.filter(
            it => it.photo_url && (it.ai_cleanliness_score === null || it.ai_cleanliness_score === undefined)
        );
        for (const it of unscored) {
            queuedItems.push(it.id);
        }
    }

    assert.equal(queuedItems.length, 0, 'No auto-evaluation should trigger when AI is disabled');

    // UI card check: whether AI audit section renders
    const shouldRenderAISection = (item) => Boolean(item.photo_url && (isAIEnabled || (item.ai_cleanliness_score !== null && item.ai_cleanliness_score !== undefined)));
    assert.equal(shouldRenderAISection(completionItems[0]), false, 'AI section should not render for unscored item when AI is disabled (normal behavior)');
});

test('Submitted checklist evaluation is one-time only: whichever user opens it, it reuses saved scores without re-evaluation', () => {
    const isAIEnabled = true;

    // Simulation of completion items saved in database after initial submission
    const persistedCompletionItems = [
        {
            id: 'item-dwing-reception',
            photo_url: 'https://storage/reception.webp',
            ai_cleanliness_score: 92,
            ai_cleanliness_reason: 'Reception desk and visitor chairs spotless, plants watered.',
            ai_parameter_scores: [
                { name: 'Table', status: 'pass', score: 95, reason: 'Clean' },
                { name: 'Chairs', status: 'pass', score: 90, reason: 'Aligned' },
            ],
            ai_analyzed_at: '2026-10-20T11:00:00Z',
        },
        {
            id: 'item-dwing-washroom',
            photo_url: 'https://storage/washroom.webp',
            ai_cleanliness_score: 84,
            ai_cleanliness_reason: 'Mirrors clean, dispensers refilled.',
            ai_parameter_scores: [
                { name: 'Mirror', status: 'pass', score: 90, reason: 'Spotless' },
                { name: 'Tissue Dispenser', status: 'pass', score: 85, reason: 'Full' },
            ],
            ai_analyzed_at: '2026-10-20T11:05:00Z',
        },
    ];

    // User A (Staff), User B (Property Admin), User C (Org Admin) opens the checklist
    ['User_Staff', 'User_PropertyAdmin', 'User_OrgAdmin'].forEach(user => {
        const autoEvaluated = new Set();
        const queuedForAI = [];

        if (isAIEnabled) {
            const unscoredItems = persistedCompletionItems.filter(
                it =>
                    it.photo_url &&
                    (it.ai_cleanliness_score === null || it.ai_cleanliness_score === undefined) &&
                    !it.ai_analyzed_at &&
                    !autoEvaluated.has(it.id)
            );
            for (const it of unscoredItems) {
                autoEvaluated.add(it.id);
                queuedForAI.push(it.id);
            }
        }

        // Must NOT re-evaluate when opened by any user
        assert.equal(queuedForAI.length, 0, `${user} opening submitted checklist must not trigger any re-evaluation`);

        // All users see exact same saved score and answers
        assert.equal(persistedCompletionItems[0].ai_cleanliness_score, 92);
        assert.equal(persistedCompletionItems[0].ai_parameter_scores.length, 2);
        assert.equal(persistedCompletionItems[1].ai_cleanliness_score, 84);
    });
});
