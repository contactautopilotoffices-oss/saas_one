import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeUsageReport } from '../../backend/lib/reports/taskManagerUsage/metrics';
import { buildReportHtml } from '../../backend/lib/reports/taskManagerUsage/reportHtml';
import { done, input, sampleInput } from './fixture';

/** The HTML without its embedded fonts and logo, which are long base64 strings. */
const visible = (html: string) => html.replace(/base64,[A-Za-z0-9+/=]+/g, '');
const render = (tasks = sampleInput().tasks) => visible(buildReportHtml(computeUsageReport(sampleInput({ tasks }))));
const titled = (title: string) => done('2026-11-03T05:00:00Z', '2026-11-08T05:00:00Z', { title, employee_id: 'asha', assigned_by: 'asha' });

describe('report HTML', () => {
    it('never carries a confidentiality marking', () => {
        assert.equal(/confidential/i.test(render()), false);
    });

    it('prints no broken values, with data and without', () => {
        for (const html of [render(), visible(buildReportHtml(computeUsageReport(input())))]) {
            assert.equal(/\bNaN\b|undefined|\bnull\b/.test(html), false);
        }
    });

    it('escapes task titles', () => {
        const html = render([...sampleInput().tasks, titled('<script>alert(1)</script>')]);
        assert.equal(html.includes('<script>alert'), false);
        assert.ok(html.includes('&lt;script&gt;alert'));
    });

    it('drops emoji and invisible marks, which print as boxes on Vercel, and keeps the words', () => {
        const html = render([...sampleInput().tasks, titled('Book ✅ flight ✈️ now 🎯⁠')]);
        assert.equal(/[✅✈️⁠]|\u{1F3AF}/u.test(html), false);
        assert.ok(/Book\s+flight\s+now/.test(html));
    });

    it('shows a dash for a title that was only emoji', () => {
        const html = render([titled('✅')]);
        assert.equal(html.includes('✅'), false);
        assert.ok(html.includes('—'));
    });

    it('keeps the trademark sign, which the fonts can print', () => {
        assert.ok(render([...sampleInput().tasks, titled('Renew Acme™ licence')]).includes('Acme™'));
    });
});
