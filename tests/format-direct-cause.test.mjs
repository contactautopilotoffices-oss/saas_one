import test from 'node:test';
import assert from 'node:assert/strict';

// Test implementation matching formatDirectCause in SOPCompletionDetail.tsx
function formatDirectCause(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.trim();

    // 1. Gallery upload with timestamp
    const timeMatch = cleaned.match(/Actual image timestamp:\s*["']([^"']+)["']/i) ||
                      cleaned.match(/Actual image timestamp:\s*([^\r\n()]+)/i) ||
                      cleaned.match(/Taken:\s*["']?([^"')]+)["']?/i) ||
                      cleaned.match(/timestamp:\s*["']?([^"')]+)["']?/i);

    if (/gallery/i.test(cleaned) && timeMatch) {
        return `Gallery upload (Taken: ${timeMatch[1].trim()}) · Live camera capture required`;
    }

    if (/duplicate benchmark/i.test(cleaned) || /sample benchmark photo re-uploaded/i.test(cleaned)) {
        return 'Duplicate benchmark reference photo uploaded · Live capture required';
    }

    // 2. Outdated watermark timestamp
    const watermarkMatch = cleaned.match(/watermark.*?shows\s*["']?([^"']+)["']?/i) ||
                           cleaned.match(/watermark\s*\(([^)]+)\)/i);
    const shiftMatch = cleaned.match(/shift dates? (?:are|is)\s*["']?([^"']+)["']?/i) ||
                       cleaned.match(/scheduled.*?\(([^)]+)\)/i);

    if (watermarkMatch && shiftMatch) {
        return `Outdated watermark (${watermarkMatch[1].trim()}) · Scheduled: ${shiftMatch[1].trim()}`;
    }

    if (/gallery upload/i.test(cleaned) && (/missing verification watermark/i.test(cleaned) || /without live/i.test(cleaned))) {
        return 'Gallery upload without live watermark · Live camera capture required';
    }

    // 3. Strip verbose AI guidance / boilerplate
    cleaned = cleaned
        .replace(/Audits require a live camera capture with verified watermark\.?/gi, '')
        .replace(/Please tap ["']?Retake["']? to capture a fresh live photo\.?/gi, '')
        .replace(/Please tap ["']?Retake["']? to capture a fresh photo now\.?/gi, '')
        .replace(/Please tap ["']?Retake["']? to snap a live photo of the cleaned space\.?/gi, '')
        .replace(/Audits must show your actual on-site work\.?/gi, '')
        .replace(/Based on the visual comparison against the reference benchmark,?\s*/gi, '')
        .replace(/Based on the visual comparison,?\s*/gi, '')
        .replace(/According to (?:our|the) visual inspection,?\s*/gi, '')
        .replace(/Upon careful analysis of the provided image,?\s*/gi, '')
        .replace(/In comparison with the CAD benchmark,?\s*/gi, '')
        .replace(/In comparison with the reference photo,?\s*/gi, '')
        .replace(/The photo reveals that\s*/gi, '')
        .replace(/The inspection indicates that\s*/gi, '')
        .trim();

    cleaned = cleaned.replace(/^[-–—·.,\s]+|[-–—·.,\s]+$/g, '').trim();

    if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned || text;
}

test('Transforms verbose existing DB text to direct cause', () => {
    const input = 'Old photo / Gallery upload detected (Actual image timestamp: "20/10/2026, 12:01:49 PM", uploaded from gallery). Audits require a live camera capture with verified watermark. Please tap "Retake" to capture a fresh live photo.';
    const output = formatDirectCause(input);
    assert.equal(output, 'Gallery upload (Taken: 20/10/2026, 12:01:49 PM) · Live camera capture required');
});

test('Transforms duplicate benchmark reference upload', () => {
    const input = 'Sample benchmark photo re-uploaded. Audits must show your actual on-site work. Please tap "Retake" to snap a live photo of the cleaned space.';
    const output = formatDirectCause(input);
    assert.equal(output, 'Duplicate benchmark reference photo uploaded · Live capture required');
});

test('Strips boilerplate from AI vision observation', () => {
    const input = 'Based on the visual comparison against the reference benchmark, minor grease stains detected on lower exhaust filter.';
    const output = formatDirectCause(input);
    assert.equal(output, 'Minor grease stains detected on lower exhaust filter');
});
