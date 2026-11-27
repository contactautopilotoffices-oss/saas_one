import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormDocument } from '../../frontend/components/recruitment/PublicFormPage';

test('pasted role details retain their order, headings, lists and safe text', () => {
    const text = 'Overview\r\n\r\nLocation: Noida\nWebsite: https://example.com/\n*About the company*\n- Operations\n- <sample>\nWebsite: javascript:alert(1)';
    const html = renderToStaticMarkup(createElement(FormDocument, { text }));
    assert.match(html, /Overview.*<dl.*<dt>Location<\/dt><dd>Noida.*href="https:\/\/example.com\/".*<h3>About the company<\/h3>.*<ul.*Operations.*&lt;sample&gt;/s);
    assert.match(html, /<dd>javascript:alert\(1\)<\/dd>/);
});
