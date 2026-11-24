import { createFence } from './card.js';
import { createDraftStore, FENCE } from './drafts.js';
import { en, zh } from './messages.js';
import { createPreviewQueue } from './preview-queue.js';
import { createSettings } from './settings.js';
import { React } from './ui.js';
import { createViewport } from './viewport.js';

const { useSyncExternalStore } = React;

const NS = 'dsh-plantuml';
const SETTINGS = 'plugins.bundle.config';
// The Host runs up to three renders. Reserve a slot for the settings sample.
const previewQueue = createPreviewQueue(2);

export const inject = ['slots', 'locale'];

export function apply(ctx) {
  const listeners = new Set();
  let value = 0;
  const revision = {
    snapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  function refresh() {
    value++;
    for (const listener of listeners) listener();
  }
  const subscribeLocale = listener => ctx.locale.subscribe(listener);
  const localeSnapshot = () => ctx.locale.getSnapshot();
  function useText() {
    useSyncExternalStore(subscribeLocale, localeSnapshot);
    return ctx.locale.bind(NS);
  }

  const viewport = createViewport(useText);
  const Fence = createFence({ ...viewport, useText, revision, drafts: createDraftStore(), previewQueue });
  const Settings = createSettings(useText, refresh);
  ctx.effect(() => ctx.locale.register(NS, 'en', en));
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh));
  for (const key of ['plantuml', 'puml']) {
    ctx.effect(() => ctx.slots.inject(FENCE, () => ctx.slots.register({ name: FENCE, id: `${NS}/fence`, key }, Fence)));
  }
  ctx.effect(() => ctx.slots.inject(SETTINGS, () => ctx.slots.register({ name: SETTINGS, key: NS }, Settings)));
}
