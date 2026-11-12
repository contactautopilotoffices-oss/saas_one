import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const nextServer = require('next/server');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const Papa = require('papaparse');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadRoute(relPath, mocks = {}) {
    return readFile(path.join(ROOT, relPath), 'utf8').then((source) => {
        const js = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText;
        const mod = { exports: {} };
        const customRequire = (id) => {
            if (mocks[id]) return mocks[id];
            if (id === 'next/server') return nextServer;
            if (id === 'exceljs') return ExcelJS;
            if (id === 'xlsx') return XLSX;
            if (id === 'papaparse') return Papa;
            if (id.startsWith('@/')) {
                const target = path.join(ROOT, id.slice(2));
                if (mocks[target]) return mocks[target];
            }
            return require(id);
        };
        const fn = vm.runInThisContext(
            `(function(require, module, exports) {\n${js}\n})`,
            { filename: path.join(ROOT, relPath) },
        );
        fn(customRequire, mod, mod.exports);
        return mod.exports;
    });
}

function makeSupabaseMock({ userId = 'u1', tables = {} } = {}) {
    const inserted = [];
    const buildQuery = (table) => {
        const rows = tables[table] || [];
        let filters = [];
        let op = 'select';
        let payload = null;
        const api = {
            select: () => api,
            eq: (k, v) => { filters.push((r) => r[k] === v); return api; },
            neq: (k, v) => { filters.push((r) => r[k] !== v); return api; },
            in: (k, arr) => { filters.push((r) => arr.includes(r[k])); return api; },
            insert: (data) => { op = 'insert'; payload = data; inserted.push({ table, data }); return api; },
            upsert: (data) => { op = 'upsert'; payload = data; inserted.push({ table, data }); return api; },
            delete: () => { op = 'delete'; return api; },
            then: (resolve) => {
                if (op === 'select') {
                    const matched = rows.filter((r) => filters.every((f) => f(r)));
                    return resolve({ data: matched, error: null });
                }
                if (op === 'insert' || op === 'upsert') {
                    return resolve({ data: Array.isArray(payload) ? payload : [payload], error: null });
                }
                return resolve({ data: null, error: null });
            },
        };
        return api;
    };
    return {
        inserted,
        client: {
            auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
            from: buildQuery,
        },
    };
}

function makeMockFile(name, buffer, type) {
    return {
        name,
        type,
        size: buffer.length,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        text: async () => Buffer.from(buffer).toString('utf8'),
    };
}

test('PPM template downloads valid .xlsx and round-trips through POST /api/ppm/upload', async () => {
    const sb = makeSupabaseMock();
    const templateHelpers = await loadRoute('backend/lib/excel/templateHelpers.ts');
    const mocks = {
        '@/frontend/utils/supabase/server': { createClient: async () => sb.client },
        '@/backend/lib/supabase/admin': { supabaseAdmin: sb.client },
        '@/backend/lib/excel/templateHelpers': templateHelpers,
    };

    const ppmTemplate = await loadRoute('app/api/ppm/template/route.ts', mocks);
    const res = await ppmTemplate.GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /PPM_Schedule_Template\.xlsx/);

    const buf = Buffer.from(await res.arrayBuffer());
    const ppmUpload = await loadRoute('app/api/ppm/upload/route.ts', mocks);
    const req = {
        formData: async () => ({
            get: (k) => {
                if (k === 'file') return makeMockFile('PPM_Schedule_Template.xlsx', buf);
                if (k === 'organization_id') return 'org-1';
                if (k === 'property_id') return 'prop-1';
                return null;
            },
        }),
    };
    const uploadRes = await ppmUpload.POST(req);
    const body = await uploadRes.json();
    assert.equal(uploadRes.status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.ok(body.inserted >= 4, `Expected >=4 parsed PPM records, got ${body.inserted}`);

    const insertedRows = sb.inserted.filter((x) => x.table === 'ppm_schedules').flatMap((x) => x.data);
    assert.equal(insertedRows[0].system_name, 'HVAC / Chiller');
    assert.equal(insertedRows[0].status, 'done');
    assert.ok(/^\d{4}-10-10$/.test(insertedRows[0].planned_date), `Unexpected planned_date: ${insertedRows[0].planned_date}`);
});

test('Roster template downloads valid .xlsx and round-trips through POST /api/roster/import', async () => {
    const sb = makeSupabaseMock({
        tables: {
            shift_configurations: [
                { id: 'sh-1', property_id: 'prop-1', code: 'A', name: 'Morning', start_time: '09:00:00', end_time: '18:00:00', is_working_day: true },
                { id: 'sh-wo', property_id: 'prop-1', code: 'W/O', name: 'Week Off', is_working_day: false },
                { id: 'sh-lv', property_id: 'prop-1', code: 'L', name: 'Leave', is_working_day: false },
            ],
            property_memberships: [
                { user_id: 'u-staff-1', property_id: 'prop-1', role: 'mst', custom_designation: 'MST', is_active: true, users: { full_name: 'Ravi Kumar' } },
            ],
            offline_roster_staff: [],
        },
    });
    const templateHelpers = await loadRoute('backend/lib/excel/templateHelpers.ts');
    const mocks = {
        '@/frontend/utils/supabase/server': { createClient: async () => sb.client },
        '@/backend/lib/excel/templateHelpers': templateHelpers,
    };

    const rosterTemplate = await loadRoute('app/api/roster/template/route.ts', mocks);
    const getReq = { nextUrl: new URL('http://localhost/api/roster/template?propertyId=prop-1&month=2026-11') };
    const res = await rosterTemplate.GET(getReq);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /Roster_Template_2026-11\.xlsx/);

    // Fill shift 'A' for Ravi Kumar on day 1 and import back
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('Roster');
    sheet.getRow(4).getCell(3).value = 'A';
    sheet.getRow(4).getCell(4).value = 'W/O';
    const editedBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const rosterImport = await loadRoute('app/api/roster/import/route.ts', mocks);
    const postReq = {
        nextUrl: new URL('http://localhost/api/roster/import?propertyId=prop-1&year=2026&month=11'),
        formData: async () => ({ get: (k) => (k === 'file' ? makeMockFile('Roster_Template_2026-11.xlsx', editedBuf) : null) }),
    };
    const importRes = await rosterImport.POST(postReq);
    const body = await importRes.json();
    assert.equal(importRes.status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.assignments.length, 2);
    assert.equal(body.assignments[0].user_id, 'u-staff-1');
    assert.equal(body.assignments[0].roster_date, '2026-11-01');
    assert.equal(body.assignments[0].shift_id, 'sh-1');
    assert.equal(body.assignments[1].shift_id, 'sh-wo');
});

test('Snag template downloads .xlsx & .csv and round-trips through POST /api/tickets/bulk-import preview', async () => {
    const sb = makeSupabaseMock();
    const templateHelpers = await loadRoute('backend/lib/excel/templateHelpers.ts');
    const mocks = {
        '@/frontend/utils/supabase/server': { createClient: async () => sb.client },
        '@/backend/lib/excel/templateHelpers': templateHelpers,
        '@/backend/lib/ticketing': { classifyTicket: () => ({ issue_code: 'HVAC-01', skill_group: 'technical', confidence: 'high' }) },
        '@/backend/lib/ticketing/assignment': { processIntelligentAssignment: async () => {} },
    };

    const snagTemplate = await loadRoute('app/api/tickets/bulk-import/template/route.ts', mocks);
    const snagImport = await loadRoute('app/api/tickets/bulk-import/route.ts', mocks);

    for (const format of ['xlsx', 'csv']) {
        const res = await snagTemplate.GET({ nextUrl: new URL(`http://localhost/api/tickets/bulk-import/template?format=${format}`) });
        assert.equal(res.status, 200);
        const buf = Buffer.from(await res.arrayBuffer());
        const previewRes = await snagImport.POST({
            formData: async () => ({
                get: (k) => {
                    if (k === 'file') return makeMockFile(`snag_import_template.${format}`, buf);
                    if (k === 'propertyId') return 'prop-1';
                    if (k === 'organizationId') return 'org-1';
                    if (k === 'confirmImport') return 'false';
                    return null;
                },
            }),
        });
        const body = await previewRes.json();
        assert.equal(previewRes.status, 200, JSON.stringify(body));
        assert.equal(body.totalRows, 2);
        assert.equal(body.validRows, 2, `Expected 2 valid rows for ${format}, errors: ${JSON.stringify(body.errors)}`);
        assert.equal(body.invalidRows, 0);
    }
});

test('Internal Audit template downloads .xlsx with expected columns', async () => {
    const sb = makeSupabaseMock();
    const templateHelpers = await loadRoute('backend/lib/excel/templateHelpers.ts');
    const mocks = {
        '@/frontend/utils/supabase/server': { createClient: async () => sb.client },
        '@/backend/lib/excel/templateHelpers': templateHelpers,
    };

    const auditTemplate = await loadRoute('app/api/audit/template/route.ts', mocks);
    const res = await auditTemplate.GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /Internal_Audit_Template\.xlsx/);

    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    assert.equal(rows.length, 3);
    assert.ok(rows[0]['Sl. No.'] !== undefined);
    assert.ok(rows[0]['Category']);
    assert.ok(rows[0]['Data Required']);
    assert.ok(rows[0]['SPOC']);
    assert.ok(rows[0]['Period']);
});
