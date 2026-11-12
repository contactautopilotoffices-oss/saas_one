import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getAllConfiguredAssigneeIds,
    getLevelAssigneeIds,
    getLevelAssigneeCandidates,
    getTicketLevelAssigneeCandidates,
    getTicketLevelAssigneeIds,
    getTicketPropertyId,
    pickTicketPropertyId,
    validatePropertyRules
} from '../../backend/lib/hr/levelAssignees';

const ETPL = 'prop-etpl';
const RABALE = 'prop-rabale';
const SS_PLAZA = 'prop-ss-plaza';
const MAFATLAL = 'prop-mafatlal';

const config = {
    flow_assignees: {
        hr_query: { '1': ['default-l1'], '2': ['hr-manager'] },
        grievance: { '2': ['grv-default-l2'] },
        confidential_feedback: { '1': ['director'] }
    },
    flow_assignees_by_property: {
        hr_query: {
            '1': [
                { property_ids: [ETPL, RABALE], assignees: ['hr-a'] },
                { property_ids: [SS_PLAZA], assignees: ['hr-b', 'hr-b2'] }
            ]
        },
        grievance: {
            '2': [{ property_ids: [MAFATLAL], assignees: ['grv-ho-l2'] }]
        },
        // Not a property-routed type: must be ignored
        confidential_feedback: {
            '1': [{ property_ids: [ETPL], assignees: ['should-not-be-used'] }]
        }
    },
    primary_property_id: MAFATLAL
};

test('property rule wins at its level', () => {
    assert.deepEqual(getLevelAssigneeIds(config, 'hr_query', 1, ETPL), ['hr-a']);
    assert.deepEqual(getLevelAssigneeIds(config, 'hr_query', 1, RABALE), ['hr-a']);
    assert.deepEqual(getLevelAssigneeIds(config, 'hr_query', '1', SS_PLAZA), ['hr-b', 'hr-b2']);
});

test('candidates include property rule assignees first, then default assignees as fallback', () => {
    assert.deepEqual(getLevelAssigneeCandidates(config, 'hr_query', 1, ETPL), ['hr-a', 'default-l1']);
    assert.deepEqual(getLevelAssigneeCandidates(config, 'hr_query', 1, 'prop-thane'), ['default-l1']);
    assert.deepEqual(getTicketLevelAssigneeCandidates(config, { ticket_type: 'hr_query', employee_snapshot: { property_id: ETPL } }, 1), ['hr-a', 'default-l1']);
});

test('resolving owner skips the submitter and falls through to next candidate or default', () => {
    const candidates = getLevelAssigneeCandidates(config, 'hr_query', 1, ETPL);
    const pickOwner = (submitterId: string) => candidates.find(id => id !== submitterId) || null;

    assert.equal(pickOwner('employee-1'), 'hr-a');
    assert.equal(pickOwner('hr-a'), 'default-l1');
    assert.equal(candidates.filter(id => id !== 'hr-a' && id !== 'default-l1')[0] || null, null);
});

test('property without a rule, or level without rules, uses default people', () => {
    assert.deepEqual(getLevelAssigneeIds(config, 'hr_query', 1, 'prop-thane'), ['default-l1']);
    assert.deepEqual(getLevelAssigneeIds(config, 'hr_query', 2, ETPL), ['hr-manager']);
    assert.deepEqual(getLevelAssigneeIds(config, 'grievance', 2, ETPL), ['grv-default-l2']);
    assert.deepEqual(getLevelAssigneeIds(config, 'grievance', 2, MAFATLAL), ['grv-ho-l2']);
});

test('no property (old tickets) uses default people', () => {
    assert.deepEqual(getLevelAssigneeIds(config, 'hr_query', 1, null), ['default-l1']);
    assert.deepEqual(getTicketLevelAssigneeIds(config, { ticket_type: 'hr_query', employee_snapshot: {} }, 1), ['default-l1']);
});

test('confidential and anonymous ignore property rules', () => {
    assert.deepEqual(getLevelAssigneeIds(config, 'confidential_feedback', 1, ETPL), ['director']);
    assert.deepEqual(getLevelAssigneeIds(config, 'anonymous_feedback', 1, ETPL), []);
});

test('config without property rules behaves like the old lookup', () => {
    const legacy = { flow_assignees: { flow_assignees: { hr_query: { '1': ['x'] } } } };
    assert.deepEqual(getLevelAssigneeIds(legacy, 'hr_query', 1, ETPL), ['x']);
    assert.deepEqual(getLevelAssigneeIds({}, 'hr_query', 1, ETPL), []);
    assert.deepEqual(getLevelAssigneeIds(null, 'hr_query', 1, ETPL), []);
});

test('ticket property comes from the frozen snapshot', () => {
    assert.equal(getTicketPropertyId({ employee_snapshot: { property_id: ETPL } }), ETPL);
    assert.equal(getTicketPropertyId({ employee_snapshot: { property_id: null } }), null);
    assert.equal(getTicketPropertyId({ employee_snapshot: { property_id: '  ' } }), null);
    assert.equal(getTicketPropertyId(null), null);
    assert.deepEqual(
        getTicketLevelAssigneeIds(config, { ticket_type: 'hr_query', employee_snapshot: { property_id: SS_PLAZA } }, 1),
        ['hr-b', 'hr-b2']
    );
});

test('access set includes default people and every property rule of the type', () => {
    const ids = getAllConfiguredAssigneeIds(config, 'hr_query');
    assert.deepEqual([...ids].sort(), ['default-l1', 'hr-a', 'hr-b', 'hr-b2', 'hr-manager']);
    const confidential = getAllConfiguredAssigneeIds(config, 'confidential_feedback');
    assert.deepEqual([...confidential], ['director']);
});

test('ticket property: single membership, else primary property, else none', () => {
    assert.equal(pickTicketPropertyId([ETPL], MAFATLAL), ETPL);
    assert.equal(pickTicketPropertyId([ETPL, ETPL], MAFATLAL), ETPL);
    assert.equal(pickTicketPropertyId([], MAFATLAL), MAFATLAL);
    assert.equal(pickTicketPropertyId([ETPL, SS_PLAZA], MAFATLAL), MAFATLAL);
    assert.equal(pickTicketPropertyId([], null), null);
    assert.equal(pickTicketPropertyId([ETPL, SS_PLAZA], undefined), null);
});

test('validation: a property can be in only one rule per level', () => {
    assert.equal(validatePropertyRules(undefined), null);
    assert.equal(validatePropertyRules(config.flow_assignees_by_property.hr_query ? { hr_query: config.flow_assignees_by_property.hr_query } : {}), null);
    // Same property at different levels is fine
    assert.equal(validatePropertyRules({
        hr_query: {
            '1': [{ property_ids: [ETPL], assignees: ['a'] }],
            '2': [{ property_ids: [ETPL], assignees: ['b'] }]
        }
    }), null);
    assert.match(validatePropertyRules({
        hr_query: { '1': [
            { property_ids: [ETPL, RABALE], assignees: ['a'] },
            { property_ids: [RABALE], assignees: ['b'] }
        ] }
    }) || '', /only one rule per level/);
});

test('validation: rejects incomplete rules and unsupported types', () => {
    assert.match(validatePropertyRules({ hr_query: { '1': [{ property_ids: [], assignees: ['a'] }] } }) || '', /at least one property/);
    assert.match(validatePropertyRules({ grievance: { '1': [{ property_ids: [ETPL], assignees: [] }] } }) || '', /at least one property/);
    assert.match(validatePropertyRules({ anonymous_feedback: {} }) || '', /only supported for Grievance and HR Query/);
    assert.match(validatePropertyRules('bad') || '', /Invalid/);
});
