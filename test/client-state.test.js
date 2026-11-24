import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createDraftStore } from '../src/client/drafts.js';
import { createPreviewQueue } from '../src/client/preview-queue.js';
import { completedStreamingSource, requestedPreviewSource } from '../src/client/streaming.js';

test('the preview queue keeps two renders active and skips cancelled work', async () => {
  const enqueue = createPreviewQueue(2);
  const live = new AbortController();
  const cancelled = new AbortController();
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const third = Promise.withResolvers();
  const started = [];
  const start = (name, work) => () => {
    started.push(name);
    return work;
  };

  enqueue(live.signal, start('first', first.promise));
  enqueue(live.signal, start('second', second.promise));
  enqueue(cancelled.signal, start('aborted', Promise.resolve()));
  const dequeue = enqueue(live.signal, start('removed', Promise.resolve()));
  enqueue(live.signal, start('third', third.promise));
  assert.deepEqual(started, ['first', 'second']);
  cancelled.abort();
  dequeue();
  first.resolve();
  await setImmediate();
  assert.deepEqual(started, ['first', 'second', 'third']);
  second.resolve();
  third.resolve();
  await setImmediate();
});

test('the draft store restores edits only for the original source and clears restored drafts', () => {
  const store = createDraftStore();
  store.update('one', 'original', 'edited');
  assert.equal(store.get('one', 'original'), 'edited');
  assert.equal(store.get('one', 'other'), null);
  assert.equal(store.get('two', 'original'), null);
  store.update('one', 'original', 'original');
  assert.equal(store.get('one', 'original'), null);
  store.update(null, 'original', 'local only');
  assert.equal(store.get(null, 'original'), null);
});

test('the draft store bounds retained edit size and evicts its oldest entry', () => {
  const store = createDraftStore();
  for (let i = 0; i < 41; i++) store.update(`card-${i}`, 'a', 'b');
  assert.equal(store.get('card-0', 'a'), null);
  assert.equal(store.get('card-1', 'a'), 'b');
  store.update('card-1', 'a', 'x'.repeat(128_000));
  assert.equal(store.get('card-1', 'a'), null);
  store.update('card-1', 'a', 'x'.repeat(127_999));
  assert.equal(store.get('card-1', 'a')?.length, 127_999);
});

const sequence = '@startuml\nAlice -> Bob: Ready\n@enduml';

test('streaming previews wait for matching start and end directives', () => {
  for (const partial of [
    '', 'Alice -> Bob: Bare', sequence.slice(0, -1),
    sequence.replace('@enduml', '@endditaa'), `${sequence}\n@startuml`,
    sequence.replace('Ready', 'x'.repeat(65_536)),
  ]) {
    assert.equal(completedStreamingSource(partial), null);
  }
  assert.equal(completedStreamingSource(`${sequence}\n`), sequence);
  const json = '@startjson\r\n{}\r\n@endjson';
  assert.equal(completedStreamingSource(`${json}\r\n`), json);
});

test('the stream and final fence share one render key until settings or source change', () => {
  const config = 1;
  const early = { source: sequence, config };
  assert.equal(requestedPreviewSource(sequence, true, null, config), null);
  assert.equal(requestedPreviewSource(sequence, true, early, config), sequence);
  const changed = sequence.replace('Ready', 'Complete');
  assert.equal(requestedPreviewSource(changed, true, early, config), sequence);
  assert.equal(requestedPreviewSource(`${sequence}\r\n`, false, early, config), sequence);
  assert.equal(requestedPreviewSource(changed, false, early, config), changed);
  assert.equal(requestedPreviewSource(changed, true, early, config + 1), null);
  assert.equal(requestedPreviewSource(changed, false, early, config + 1), changed);
});
