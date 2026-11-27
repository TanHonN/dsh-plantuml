import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { completedStreamingSource } from './streaming.js';

// Match the built-in document viewer's leading YAML delimiters.
const frontmatter = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u;
const options = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };
const lineEndings = /\r\n?/g;
const plantumlOpening = /^(?:`{3,}|~{3,})[ \t]*(?:plantuml|puml)(?=[ \t\n]|$)/i;

export function plantumlFenceCounts(text, eof) {
  const markdown = text.replace(/^\uFEFF/, '').replace(lineEndings, '\n').replace(frontmatter, '');
  const counts = new Map();
  const otherCode = new Set();
  function visit(node, inFootnote) {
    if (node.type === 'code' && node.value.trim()) {
      // mdast decodes entities in `lang`. Check the original fence for a literal opt-in.
      const start = node.position?.start.offset;
      const explicit = node.lang && start !== undefined && plantumlOpening.test(markdown.slice(start));
      if (inFootnote || !explicit) {
        otherCode.add(node.value);
      } else if (eof || completedStreamingSource(node.value) !== null) {
        counts.set(node.value, (counts.get(node.value) ?? 0) + 1);
      }
    }
    for (const child of node.children ?? []) visit(child, inFootnote || node.type === 'footnoteDefinition');
  }
  visit(fromMarkdown(markdown, options), false);
  for (const source of otherCode) counts.delete(source);
  return counts;
}

// DSH's generic Code label erases unsupported fence languages. Pair by exact source and
// multiplicity, excluding collisions with other code so no guess is needed about DOM order.
export function matchPlantumlFences(counts, rendered) {
  const matches = new Map();
  for (const [block, source] of rendered) {
    const code = source.replace(lineEndings, '\n');
    if (!counts.has(code)) continue;
    if (!matches.has(code)) matches.set(code, []);
    matches.get(code).push(block);
  }
  const result = new Map();
  for (const [code, blocks] of matches) {
    if (blocks.length !== counts.get(code)) continue;
    for (const block of blocks) result.set(block, code);
  }
  return result;
}
