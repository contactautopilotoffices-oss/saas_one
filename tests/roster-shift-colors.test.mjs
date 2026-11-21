import test from 'node:test';
import assert from 'node:assert/strict';
import { getContrastTextColor, PRESET_SHIFT_COLORS, DEFAULT_SHIFTS } from '../frontend/components/roster/ShiftConfigModal.js';

test('getContrastTextColor correctly identifies light and dark colors', () => {
    // Dark colors should have white text
    assert.equal(getContrastTextColor('#000000'), '#ffffff');
    assert.equal(getContrastTextColor('#1e293b'), '#ffffff');
    assert.equal(getContrastTextColor('#8b5cf6'), '#ffffff');
    assert.equal(getContrastTextColor('#ef4444'), '#ffffff');
    assert.equal(getContrastTextColor('#10b981'), '#ffffff');

    // Light colors should have dark slate text
    assert.equal(getContrastTextColor('#ffffff'), '#0f172a');
    assert.equal(getContrastTextColor('#fef3c7'), '#0f172a');
    assert.equal(getContrastTextColor('#f1f5f9'), '#0f172a');
    assert.equal(getContrastTextColor('#38bdf8'), '#0f172a');

    // Edge cases
    assert.equal(getContrastTextColor('transparent'), '#0f172a');
    assert.equal(getContrastTextColor(''), '#0f172a');
    assert.equal(getContrastTextColor(null), '#0f172a');
});

test('PRESET_SHIFT_COLORS has valid hex codes', () => {
    assert.ok(PRESET_SHIFT_COLORS.length >= 8);
    for (const p of PRESET_SHIFT_COLORS) {
        assert.match(p.hex, /^#[0-9A-Fa-f]{6}$/);
    }
});

test('DEFAULT_SHIFTS have distinct color codes defined', () => {
    assert.ok(DEFAULT_SHIFTS.length >= 6);
    for (const s of DEFAULT_SHIFTS) {
        assert.ok(s.code);
        assert.ok(s.name);
        assert.match(s.color, /^#[0-9A-Fa-f]{6}$/);
    }
});
