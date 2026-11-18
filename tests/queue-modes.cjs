const test = require('node:test');
const assert = require('node:assert/strict');
const {shuffleTail, restoreUpcoming} = require('../src/main/queue-modes.cjs');

test('each Fisher–Yates permutation is reachable without mutating the upcoming queue', () => {
  const source = Object.freeze([{id:'a'}, {id:'a'}, {id:'b'}]);
  const permutations = new Set();
  for (let last = 0; last < 3; last++) {
    for (let middle = 0; middle < 2; middle++) {
      const picks = [(last + 0.5) / 3, (middle + 0.5) / 2];
      const shuffled = shuffleTail(source, () => picks.shift());
      const indices = shuffled.map(track => source.indexOf(track));
      assert.deepEqual(indices.slice().sort(), [0, 1, 2]);
      assert.equal(picks.length, 0);
      permutations.add(indices.join(','));
    }
  }
  assert.equal(permutations.size, 6);
  for (const upcoming of [[], [source[0]]]) {
    const result = shuffleTail(upcoming, () => assert.fail('A one-item queue needs no draw'));
    assert.deepEqual(result, upcoming);
    assert.notEqual(result, upcoming);
  }
});

test('restoring keeps surviving original occurrences and appends additions in their current order', () => {
  const first = {id:'same'}, second = {id:'same'}, replacement = {id:'same'};
  const middle = {id:'middle'}, played = {id:'played'}, removed = {id:'removed'}, addition = {id:'new'};
  const original = Object.freeze([first, played, middle, second, removed, first]);
  const remaining = Object.freeze([second, replacement, first, addition, middle]);
  const result = restoreUpcoming(original, remaining);
  const expected = [first, middle, second, replacement, addition];
  assert.equal(result.length, expected.length);
  expected.forEach((track, index) => assert.equal(result[index], track));
  assert.deepEqual(restoreUpcoming(original, []), []);
});

test('an extra occurrence of a reused reference keeps its position among newly enqueued tracks', () => {
  const a = {}, b = {}, x = {}, y = {};
  const result = restoreUpcoming([a, b, a], [b, x, a, a, y, a]);
  const expected = [a, b, a, x, y, a];
  assert.equal(result.length, expected.length);
  expected.forEach((track, index) => assert.equal(result[index], track));
});

