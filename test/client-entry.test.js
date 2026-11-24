import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const FENCE = 'conversation.chat.markdown.fence';
const SETTINGS = 'plugins.bundle.config';

test('the published Client registers both fence aliases and the bundle settings in DSH', async () => {
  const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  let entry;
  runInNewContext(code, { window: { __ModuleLoader__: { load(value) { entry = value; } } } });
  assert.equal(entry.id, 'dsh-plantuml');
  const imports = [];
  const plugin = entry.factory(name => {
    imports.push(name);
    // Only check the loader and slot contract, without rendering React components.
    return {};
  });
  assert.deepEqual(imports, ['react']);
  assert.deepEqual([...plugin.inject], ['slots', 'locale']);

  const registrations = [];
  const locales = [];
  const releases = [];
  let injection;
  plugin.apply({
    effect(run) { releases.push(run()); },
    locale: {
      register(namespace, language, messages) {
        assert.equal(namespace, 'dsh-plantuml');
        assert.equal(typeof messages.bad_image, 'string');
        locales.push(language);
        return () => locales.splice(locales.indexOf(language), 1);
      },
    },
    slots: {
      inject(name, register) {
        injection = name;
        try { return register(); } finally { injection = undefined; }
      },
      register({ name, id, key }, component) {
        assert.equal(injection, name);
        const record = { name, id, key, component };
        registrations.push(record);
        return () => registrations.splice(registrations.indexOf(record), 1);
      },
    },
  });
  assert.deepEqual(locales, ['en', 'zh']);
  assert.deepEqual(registrations.map(({ name, id, key }) => [name, id, key]), [
    [FENCE, 'dsh-plantuml/fence', 'plantuml'],
    [FENCE, 'dsh-plantuml/fence', 'puml'],
    [SETTINGS, undefined, 'dsh-plantuml'],
  ]);
  assert.equal(typeof registrations[0].component, 'function');
  assert.equal(registrations[0].component, registrations[1].component);
  for (const release of releases.reverse()) release();
  assert.deepEqual(registrations, []);
  assert.deepEqual(locales, []);
});
