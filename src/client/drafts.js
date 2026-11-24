const FENCE = 'conversation.chat.markdown.fence';
const fenceSelector = `[data-slot="${FENCE}"]`;
const MAX_DRAFT_SIZE = 128_000;
const MAX_RETAINED_DRAFTS = 40;

export { FENCE };

export function cardDraftKey(node, sessionId) {
  const fence = node.closest(fenceSelector);
  const row = fence?.closest('[data-chat-flow-key]');
  const rowKey = row?.getAttribute('data-chat-flow-key');
  if (!sessionId || !rowKey || row.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') !== sessionId) {
    return null;
  }
  const index = Array.from(row.querySelectorAll(fenceSelector)).indexOf(fence);
  return index < 0 ? null : JSON.stringify([sessionId, rowKey, index]);
}

export function canKeepDraft(code, draft) {
  return code.length + draft.length <= MAX_DRAFT_SIZE;
}

export function createDraftStore() {
  const saved = new Map();
  return {
    get(key, code) {
      const entry = saved.get(key);
      return entry?.code === code ? entry.draft : null;
    },
    update(key, code, draft) {
      if (!key) return;
      saved.delete(key);
      if (code === draft || !canKeepDraft(code, draft)) return;
      if (saved.size >= MAX_RETAINED_DRAFTS) saved.delete(saved.keys().next().value);
      saved.set(key, { code, draft });
    },
  };
}
