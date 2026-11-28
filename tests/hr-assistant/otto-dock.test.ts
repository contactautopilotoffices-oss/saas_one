import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ottoDockAt, parseOttoDock } from '../../frontend/components/hr-assistant/ottoDock';

test('Otto snaps to the closer side and stays between the top and bottom limits', () => {
  const dock = ottoDockAt(450, 120, 1000, 504, 20, 20, 64);
  assert.deepEqual(dock, { side: 'left', height: 0.25 });
  assert.deepEqual(parseOttoDock(JSON.stringify(dock)), dock);
  assert.deepEqual(ottoDockAt(900, 600, 1000, 504, 20, 80, 64), { side: 'right', height: 1 });
  assert.deepEqual(ottoDockAt(1, -50, 1000, 504, 20, 20, 64), { side: 'left', height: 0 });
  assert.equal(parseOttoDock('{"side":"middle","height":0.5}'), null);
});
