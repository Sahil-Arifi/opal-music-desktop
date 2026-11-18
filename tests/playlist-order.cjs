const test = require('node:test');
const assert = require('node:assert/strict');
const {applyOrder, validateOrder, resolveVisibleOrder} = require('../src/main/playlist-order.cjs');

const one = '0123456789a', two = '0123456789b', three = '0123456789c', removed = '0123456789d';
const fixture = Object.freeze([one, two, one, three, two].map((id, i) => Object.freeze({id, occurrence: i})));

test('a complete reorder keeps repeated tracks distinct in their original occurrence order', () => {
  const ids = Object.freeze([two, one, two, three, one]);
  const result = validateOrder(fixture, ids);
  assert.deepEqual(result.map(t => t.occurrence), [1, 0, 4, 3, 2]);
  assert.equal(result[0], fixture[1]);
  assert.deepEqual(applyOrder(fixture, ids), result);
  assert.deepEqual(fixture.map(t => t.occurrence), [0, 1, 2, 3, 4]);
});

test('reopening reconciles removed entries and preserves the remote order of all newly added occurrences', () => {
  const saved = [removed, two, one, removed, one, one];
  assert.deepEqual(applyOrder(fixture, saved).map(t => t.occurrence), [1, 0, 2, 3, 4]);
  assert.deepEqual(applyOrder([], saved), []);
  for (const order of [undefined, null, {}, [], Array(20001).fill(one)]) {
    const result = applyOrder(fixture, order);
    assert.deepEqual(result, fixture);
    assert.notEqual(result, fixture);
  }
});

test('saving rejects unknown IDs, omissions, excess duplicates, unloaded and oversize inputs', () => {
  for (const ids of [[one,one,two,two,removed], [one,one,one,two,three], [one,two,three]]) {
    assert.throws(() => validateOrder(fixture, ids), /playlist changed/i);
  }
  for (const id of [4, {}, '', 'short', '://abcefg12']) {
    assert.throws(() => validateOrder(fixture, [one,two,three,two,id]), /invalid track id/i);
  }
  assert.throws(() => validateOrder(undefined, []), /open the playlist/i);
  assert.throws(() => validateOrder(fixture, {}), /invalid playlist order/i);
  assert.throws(() => validateOrder([], Array(20001).fill(one)), /20,000/);
  assert.deepEqual(validateOrder([], []), []);
  const tracks = Array.from({length:20000}, () => ({id:one}));
  assert.equal(validateOrder(tracks, Array(20000).fill(one)).length, 20000);
});

test('a visible snapshot keeps the chosen occurrences during a refresh and appends new source entries',()=>{
  const view=Object.freeze([{id:one,title:'Visible one'},{id:two,title:'Removed from source'},{id:one,title:'Visible repeated one'}]);
  const source=Object.freeze([{id:three},{id:one,title:'Fresh first'},{id:one,title:'Fresh second'},{id:one,title:'Recent extra'}]);
  const ordered=resolveVisibleOrder(source,view.map(t=>t.id),view);
  const expected=[source[1],view[1],source[2],source[0],source[3]];
  assert.equal(ordered.length,expected.length);
  expected.forEach((track,i)=>assert.equal(ordered[i],track));
  assert.throws(()=>resolveVisibleOrder(source,[one,two,one],[view[0],view[2],view[1]]),/snapshot/i);
  assert.throws(()=>resolveVisibleOrder(source,['wrong'],[{id:'wrong'}]),/invalid/i);
});

