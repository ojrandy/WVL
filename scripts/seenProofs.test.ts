// Tests for the console's seen-proof bookkeeping (update.md H.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSeenProofs, parseSeenProofs } from '../src/admin/seenProofs.ts';

test('parseSeenProofs reads a stored id list and ignores anything malformed', () => {
  assert.deepEqual(parseSeenProofs('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseSeenProofs('["a",1,null,{"x":1},"b"]'), ['a', 'b']);
  assert.deepEqual(parseSeenProofs(null), []);
  assert.deepEqual(parseSeenProofs(''), []);
  assert.deepEqual(parseSeenProofs('not json'), []);
  assert.deepEqual(parseSeenProofs('{"a":1}'), []);
  assert.deepEqual(parseSeenProofs('"a"'), []);
});

test('nextSeenProofs returns only proofs not announced yet, in order', () => {
  const waiting = [{ id: 'p3' }, { id: 'p2' }, { id: 'p1' }];
  assert.deepEqual(nextSeenProofs(waiting, ['p1']).unseen, [{ id: 'p3' }, { id: 'p2' }]);
  assert.deepEqual(nextSeenProofs(waiting, ['p1', 'p2', 'p3']).unseen, []);
  assert.deepEqual(nextSeenProofs(waiting, []).unseen, waiting);
});

test('nextSeenProofs prunes the seen list to the proofs still waiting', () => {
  const result = nextSeenProofs([{ id: 'p2' }, { id: 'p4' }], new Set(['p1', 'p2', 'p3']));
  assert.deepEqual(result.unseen, [{ id: 'p4' }]);
  assert.deepEqual(result.seen, ['p2', 'p4']);
  assert.deepEqual(nextSeenProofs([], ['p1']).seen, []);
});
