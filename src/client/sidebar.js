import { createPortal } from 'react-dom';
import { request } from './api.js';
import { matchPlantumlFences, plantumlFenceCounts } from './sidebar-markdown.js';
import { React, h } from './ui.js';

export const DOCUMENT_ACTION = 'sidebar.right.tab.document.action';
export const MARKDOWN_VIEWER = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown';

const frameSelector = `[data-document-preview="${MARKDOWN_VIEWER}"]`;
const documentSelector = '[data-textpreview-body] [data-document-markdown]';
const seatAttribute = 'data-dsh-plantuml-sidebar-seat';
const seatSelector = `[${seatAttribute}]`;
// Keep the native block in React's tree and restore it whenever the plugin's card is absent.
const style = `${frameSelector} ${documentSelector} ${seatSelector}:has([data-dsh-plantuml-sidebar-card]):not(:has([data-dsh-plantuml-native-source])) + .md-code-block:not(:focus-within) { display: none; }`;

const { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

function* renderedFences(markdown) {
  for (const block of markdown?.querySelectorAll('.md-code-block') ?? []) {
    if (block.closest('[data-document-markdown]') !== markdown || block.closest(seatSelector)) continue;
    const code = block.querySelector(':scope > [data-code-block-content] pre > code');
    if (code) yield [block, code.textContent];
  }
}

function watchMarkdown(frame, publish) {
  const cards = new Map();
  let nextId = 0;
  let counts = new Map();
  let markdown = null;

  function reconcile(current = frame.querySelector(documentSelector)) {
    markdown = current;
    const matches = counts.size ? matchPlantumlFences(counts, renderedFences(markdown)) : new Map();
    let changed = false;
    for (const [block, code] of matches) {
      let card = cards.get(block);
      if (card?.code !== code) {
        const seat = card?.seat ?? frame.ownerDocument.createElement('div');
        seat.setAttribute(seatAttribute, '');
        card = { id: ++nextId, seat, code };
        cards.set(block, card);
        changed = true;
      }
      if (card.seat.nextElementSibling !== block || card.seat.parentNode !== block.parentNode) block.before(card.seat);
    }
    for (const [block, card] of cards) {
      if (matches.has(block)) continue;
      card.seat.remove();
      cards.delete(block);
      changed = true;
    }
    if (changed) publish([...cards.values()]);
  }

  const observer = new MutationObserver(records => {
    // The toolbar action can outlive the rendered Markdown when the host replaces the body.
    const current = frame.querySelector(documentSelector);
    if (current !== markdown) {
      reconcile(current);
      return;
    }
    if (!current) return;
    const contentChanged = records.some(({ target, type, addedNodes, removedNodes }) => {
      const element = target.nodeType === 1 ? target : target.parentElement;
      if (!element || !current.contains(element) || element.closest(seatSelector)) return false;
      return type !== 'childList' || [...addedNodes, ...removedNodes].some(node => !node.matches?.(seatSelector));
    });
    if (contentChanged) reconcile(current);
  });
  observer.observe(frame, { childList: true, characterData: true, subtree: true });
  return {
    update(text, eof) {
      try {
        counts = plantumlFenceCounts(text, eof);
      } catch {
        // Keep the native preview usable if the companion parser cannot parse this document.
        counts = new Map();
      }
      reconcile();
    },
    dispose() {
      observer.disconnect();
      for (const { seat } of cards.values()) seat.remove();
      cards.clear();
    },
  };
}

function useSidebarBackend(active, config) {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    function finish(next) {
      if (!controller.signal.aborted) setResult({ config, reload, ...next });
    }
    void request(null, controller.signal).then(status => {
      const { mode, serverUrl, sidebarAutoServerUrl } = status?.config ?? {};
      if (mode === 'auto' || mode === 'jar') finish({ mode });
      else if (mode === 'server' && serverUrl && !status.problem) {
        finish({ mode, serverUrl, autoServer: sidebarAutoServerUrl === serverUrl });
      } else finish({ error: status?.problem ?? 'bad_config' });
    }).catch(error => finish({ error: error.message }));
    return () => controller.abort();
  }, [active, config, reload]);
  const backend = result?.config === config && result.reload === reload ? result : null;
  return { backend, reload: () => setReload(value => value + 1) };
}

export function createMarkdownAction(Card, revision) {
  function MarkdownCards({ text, eof }) {
    const anchor = useRef(null);
    const watcher = useRef(null);
    const [cards, setCards] = useState([]);
    const config = useSyncExternalStore(revision.subscribe, revision.snapshot);
    const sidebar = useSidebarBackend(cards.length > 0, config);

    useLayoutEffect(() => {
      const frame = anchor.current.closest(frameSelector);
      if (!frame) return;
      const watch = watchMarkdown(frame, setCards);
      watcher.current = watch;
      return () => { watcher.current = null; watch.dispose(); };
    }, []);
    useLayoutEffect(() => { watcher.current?.update(text, eof); }, [text, eof]);

    return h(React.Fragment, null, h('span', { ref: anchor, hidden: true }), h('style', null, style),
      cards.map(({ id, seat, code }) => createPortal(h(Card, { code, sidebar }), seat, id)));
  }

  return function MarkdownAction({ content, useTabInfo }) {
    const { tab } = useTabInfo();
    if (!tab.visible || content.kind !== 'text') return null;
    return h(MarkdownCards, { key: JSON.stringify([tab.id, tab.contentId]), text: content.text, eof: content.eof });
  };
}
