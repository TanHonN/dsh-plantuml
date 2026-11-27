import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchPlantumlFences, plantumlFenceCounts } from '../src/client/sidebar-markdown.js';

const fence = (language, source) => ['```' + language, source, '```'].join('\n');
const diagram = '@startuml\nAlice -> Bob: Hello\n@enduml';

const markdown = [
  ['\uFEFF---', 'demo: |', fence('plantuml', 'frontmatter'), '...'].join('\n'),
  ['<!--', fence('puml', 'commented out'), '-->'].join('\n'),
  '    indented code',
  fence('text', diagram),
  ['````markdown', fence('plantuml', 'example'), '````'].join('\n'),
  ['> ~~~PuMl extra info', '> nested', '> ~~~'].join('\n'),
  ['- ```plantuml', '  listed', '  ```'].join('\n'),
  ['[^1]: ```plantuml', '    footnote', '    ```'].join('\n'),
].join('\n\n').replaceAll('\n', '\r\n');

test('the sidebar reads explicit fenced languages in Markdown and skips examples, frontmatter, and footnotes', () => {
  const text = [markdown, fence('plantuml', 'standalone')].join('\r\n\r\n');
  assert.deepEqual(plantumlFenceCounts(text, true), new Map([
    ['nested', 1], ['listed', 1], ['standalone', 1],
  ]));
});

test('the sidebar requires a literal PlantUML language tag in the opening fence', () => {
  const encoded = fence('p&#117;ml', 'entity-encoded language');
  const nested = ['> ~~~~ PuMl extra info', '> nested', '> ~~~~'].join('\n');
  const indented = ['    ```puml', '    example', '    ```'].join('\n');
  assert.deepEqual(plantumlFenceCounts([encoded, nested, indented].join('\n\n'), true), new Map([['nested', 1]]));
  assert.deepEqual(plantumlFenceCounts(`\uFEFF${fence('puml', diagram)}`, true), new Map([[diagram, 1]]));
  assert.deepEqual(plantumlFenceCounts([fence('puml', diagram), fence('p&#117;ml', diagram)].join('\n\n'), true), new Map());
});

test('the sidebar waits for a complete source or the last page and preserves spaces exactly', () => {
  const partial = `${fence('puml', diagram)}\n\n\`\`\`plantuml\nAlice -> Bob  `;
  assert.deepEqual(plantumlFenceCounts(partial, false), new Map([[diagram, 1]]));
  assert.deepEqual(plantumlFenceCounts(partial, true), new Map([[diagram, 1], ['Alice -> Bob  ', 1]]));
});

test('the sidebar keeps native blocks when a diagram source collides with another language or DOM multiplicity differs', () => {
  const sameSource = [fence('plantuml', diagram), fence('puml', diagram)].join('\n\n');
  const counts = plantumlFenceCounts(sameSource, true);
  assert.deepEqual(counts, new Map([[diagram, 2]]));
  assert.deepEqual(matchPlantumlFences(counts, [['svg-a', diagram]]), new Map());
  assert.deepEqual(matchPlantumlFences(counts, [['svg-a', diagram], ['svg-b', diagram], ['svg-c', diagram]]), new Map());
  assert.deepEqual(matchPlantumlFences(counts, [['svg-a', diagram], ['other', diagram + '\n'], ['svg-b', diagram]]), new Map([
    ['svg-a', diagram], ['svg-b', diagram],
  ]));
  for (const other of [fence('text', diagram), fence('', diagram), fence('unknown', diagram), diagram.replaceAll(/^/gm, '    ')]) {
    assert.deepEqual(plantumlFenceCounts(`${sameSource}\n\n${other}`, true), new Map());
  }
});
