import test from 'node:test';
import assert from 'node:assert/strict';

// Import our helper module
const {
    formatDisplayTimestamp,
    parseFilenameTimestamp,
    extractActualImageTimestamp,
    getAllowedInspectionDates
} = await import('../lib/sop/imageTimestampHelper.ts');

test('WhatsApp filename parser accurately extracts timestamp and marks isLiveCapture false', () => {
    const filename = 'WhatsApp Image 2026-10-20 at 12.01.49 PM.jpeg';
    const parsed = parseFilenameTimestamp(filename);

    assert.ok(parsed, 'Parsed object should not be null');
    assert.equal(parsed.source, 'filename_whatsapp');
    assert.equal(parsed.isLiveCapture, false);
    assert.equal(parsed.timestampStr, '20/10/2026, 12:01:49 PM');
    assert.equal(parsed.date.getFullYear(), 2026);
    assert.equal(parsed.date.getMonth(), 9); // October is month index 9
    assert.equal(parsed.date.getDate(), 20);
    assert.equal(parsed.date.getHours(), 12);
    assert.equal(parsed.date.getMinutes(), 1);
    assert.equal(parsed.date.getSeconds(), 49);
});

test('Camera filename parser extracts timestamp from standard phone camera naming', () => {
    const filename = 'IMG_20261020_143015.jpg';
    const parsed = parseFilenameTimestamp(filename);

    assert.ok(parsed, 'Parsed camera timestamp should not be null');
    assert.equal(parsed.source, 'filename_camera');
    assert.equal(parsed.isLiveCapture, false);
    assert.equal(parsed.timestampStr, '20/10/2026, 02:30:15 PM');
    assert.equal(parsed.date.getHours(), 14);
});

test('Live capture filename parser identifies in-app camera capture', () => {
    const filename = 'LIVE_CAPTURE_20261020_091530.jpg';
    const parsed = parseFilenameTimestamp(filename);

    assert.ok(parsed, 'Parsed live capture should not be null');
    assert.equal(parsed.isLiveCapture, true);
    assert.equal(parsed.timestampStr, '20/10/2026, 09:15:30 AM');
});

test('Screenshot filename parser extracts timestamp from screenshot naming', () => {
    const filename = 'Screenshot 2026-10-20 at 11.45.10 AM.png';
    const parsed = parseFilenameTimestamp(filename);

    assert.ok(parsed, 'Parsed screenshot should not be null');
    assert.equal(parsed.source, 'filename_screenshot');
    assert.equal(parsed.isLiveCapture, false);
    assert.equal(parsed.timestampStr, '20/10/2026, 11:45:10 AM');
});

test('extractActualImageTimestamp falls back to file lastModified when filename has no date', () => {
    // 2026-10-20 12:01:49 UTC in ms
    const lastModified = new Date('2026-10-20T12:01:49Z').getTime();
    const result = extractActualImageTimestamp({
        filename: 'random_photo.png',
        lastModified,
    });

    assert.ok(result, 'Result should not be null');
    assert.equal(result.source, 'last_modified');
    assert.equal(result.isLiveCapture, false);
    assert.ok(result.timestampStr.includes('20/10/2026'));
});

test('Option B Gallery Upload verification logic marks old photo with actual timestamp', () => {
    const expectedDateStr = '20/10/2026';
    const galleryFilename = 'WhatsApp Image 2026-10-20 at 12.01.49 PM.jpeg';

    const actualImageInfo = extractActualImageTimestamp({
        filename: galleryFilename,
        lastModified: 1792479036171,
    });

    // Vision model outputs missing because gallery uploads have no canvas watermark
    const modelOutput = {
        score: 85,
        timestamp_detected: 'missing',
        is_stale_image: true,
        reason: 'Surfaces look clean.',
    };

    const hasVisibleWatermark = Boolean(
        modelOutput.timestamp_detected &&
        modelOutput.timestamp_detected !== 'missing' &&
        modelOutput.timestamp_detected !== 'null'
    );
    const isLiveVerified = hasVisibleWatermark && modelOutput.timestamp_detected.includes(expectedDateStr) && !modelOutput.is_stale_image;

    let detectedWatermark = null;
    let isStale = false;
    let staleReasonMessage = '';

    if (isLiveVerified) {
        isStale = false;
        detectedWatermark = modelOutput.timestamp_detected;
    } else {
        isStale = true;
        if (actualImageInfo?.timestampStr) {
            detectedWatermark = `${actualImageInfo.timestampStr} (Gallery Upload)`;
            staleReasonMessage = `Old photo / Gallery upload detected (Actual image timestamp: "${actualImageInfo.timestampStr}", uploaded from gallery). Audits require a live camera capture with verified watermark. Please tap "Retake" to capture a fresh live photo.`;
        }
    }

    assert.equal(isStale, true, 'Gallery upload must be marked stale');
    assert.equal(detectedWatermark, '20/10/2026, 12:01:49 PM (Gallery Upload)');
    assert.ok(staleReasonMessage.includes('Old photo / Gallery upload detected'));
    assert.ok(staleReasonMessage.includes('20/10/2026, 12:01:49 PM'));
});

test('Option B Live Camera capture passes with verified watermark', () => {
    const expectedDateStr = '20/10/2026';
    const liveFilename = 'LIVE_CAPTURE_20261020_123510.jpg';

    // Model detects watermark stamped on canvas by CameraCaptureModal
    const modelOutput = {
        score: 92,
        timestamp_detected: 'LIVE AUDIT: 20/10/2026 12:35:10',
        is_stale_image: false,
        reason: 'Space is spotless.',
    };

    const hasVisibleWatermark = Boolean(
        modelOutput.timestamp_detected &&
        modelOutput.timestamp_detected !== 'missing'
    );
    const isLiveVerified = hasVisibleWatermark && modelOutput.timestamp_detected.includes(expectedDateStr) && !modelOutput.is_stale_image;

    assert.equal(isLiveVerified, true, 'Live camera capture with watermark must pass');
});

test('SS Plaza Midnight Checklist: allows cross-midnight live capture taken past 12:00 AM', () => {
    // Shift scheduled for 19/10/2026 night at 23:30
    const { allowedDates, isNightShift } = getAllowedInspectionDates({
        completionDate: '2026-10-19',
        slotTime: '23:30:00',
        title: 'SS Plaza Night Shift Lobby Cleaning',
    });

    assert.equal(isNightShift, true, '23:30 slot must be flagged as night shift');
    assert.ok(allowedDates.includes('19/10/2026'), 'Scheduled date 19/10/2026 must be allowed');
    assert.ok(allowedDates.includes('20/10/2026'), 'Cross-midnight date 20/10/2026 must be allowed');

    // Staff cleans at 00:25 AM on 20/10/2026
    const liveWatermark = 'LIVE AUDIT: 20/10/2026 00:25:12';
    const watermarkMatchesExpected = allowedDates.some(d => liveWatermark.includes(d));

    assert.equal(watermarkMatchesExpected, true, 'Photo taken at 00:25 AM must pass for 23:30 night shift');
});

test('SS Plaza Midnight Checklist: allows capture when work starts before midnight for 01:00 AM slot', () => {
    // Shift scheduled for 20/10/2026 at 01:00 AM
    const { allowedDates, isNightShift } = getAllowedInspectionDates({
        completionDate: '2026-10-20',
        slotTime: '01:00:00',
        title: 'SS Plaza Overnight Deep Washroom Sanitization',
    });

    assert.equal(isNightShift, true, '01:00 slot must be flagged as night shift');
    assert.ok(allowedDates.includes('20/10/2026'), 'Scheduled date 20/10/2026 must be allowed');
    assert.ok(allowedDates.includes('19/10/2026'), 'Pre-midnight date 19/10/2026 must be allowed');

    // Staff starts at 23:50 on 19/10/2026
    const liveWatermark = 'LIVE AUDIT: 19/10/2026 23:50:45';
    const watermarkMatchesExpected = allowedDates.some(d => liveWatermark.includes(d));

    assert.equal(watermarkMatchesExpected, true, 'Photo taken at 23:50 on 19th must pass for 01:00 AM shift on 20th');
});

test('SS Plaza Midnight Checklist: rejects old photo from 3 days ago', () => {
    const { allowedDates } = getAllowedInspectionDates({
        completionDate: '2026-10-19',
        slotTime: '23:30:00',
        title: 'SS Plaza Night Shift Lobby Cleaning',
    });

    const oldWatermark = 'LIVE AUDIT: 15/10/2026 23:30:00';
    const watermarkMatchesExpected = allowedDates.some(d => oldWatermark.includes(d));

    assert.equal(watermarkMatchesExpected, false, 'Photo from 15/10/2026 must be rejected for 19/10/2026 night shift');
});

