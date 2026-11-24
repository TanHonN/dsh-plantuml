import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { apply, Config } from 'dsh-plantuml';
import { DEFAULT_APPEARANCE, encodeSource, SAMPLE } from '../src/host/renderer.js';

await test('the Host settings route rejects cross-site and unauthenticated requests, saves, and detects stale settings', { timeout: 5000 }, async () => {
  let route;
  let dispose;
  let settings = {};
  const config = Config(settings);
  const entry = {};
  const editor = {
    async edit(target, change) {
      assert.equal(target, entry);
      settings = change(settings);
      Object.assign(config, Config(settings));
    },
  };
  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
  apply({
    fiber: { entry },
    get(key) { return key === 'configEditor' ? editor : undefined; },
    connection: { admit: req => req.headers.authorization ? { peer } : { rejection: 401 } },
    webServer: { register: registered => { route = registered; return () => { route = null; }; } },
    effect(callback) { dispose = callback(); },
  }, config);
  assert.equal(route.path, '/dsh-plantuml/api');
  assert.equal(route.kind, 'exact');

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
  const renderedSources = [];
  const brokenSource = 'Alice -> Bob: Hello\ninvalid statement';
  const brokenEncoded = encodeSource(`@startuml\nskinparam BackgroundColor #203040\n${brokenSource}\n@enduml`);
  const server = createServer((req, res) => {
    if (req.url === route.path) return route.handler(req, res);
    if (req.url === `/plantuml/svg/${brokenEncoded}`) {
      return res.writeHead(400, {
        'x-plantuml-diagram-error': 'Syntax Error? (Assumed diagram type: sequence)',
        'x-plantuml-diagram-error-line': '3',
      }).end();
    }
    if (req.url.startsWith('/plantuml/svg/')) {
      renderedSources.push(req.url.slice('/plantuml/svg/'.length));
      return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg);
    }
    return res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}${route.path}`;
    const authorized = { authorization: 'test-owner' };
    const post = (payload, extraHeaders = {}) => fetch(url, {
      method: 'POST', headers: { ...authorized, 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify(payload),
    });
    const unauthenticated = await fetch(url);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), { error: 'denied' });

    const initial = await (await fetch(url, { headers: authorized })).json();
    assert.equal(initial.writable, true);
    assert.deepEqual(initial.config, { mode: 'auto', jarPath: '', serverUrl: '', appearance: DEFAULT_APPEARANCE });
    const serverUrl = new URL('/plantuml/', url).href;
    const draft = { action: 'save', config: { mode: 'server', serverUrl }, previous: initial.config };
    const crossSite = await post(draft, { 'sec-fetch-site': 'cross-site' });
    assert.equal(crossSite.status, 403);
    assert.deepEqual(settings, {});
    const saved = await post(draft, { 'sec-fetch-site': 'same-origin' });
    assert.equal(saved.status, 200);
    const next = await saved.json();
    assert.deepEqual(next.config, { mode: 'server', jarPath: '', serverUrl, appearance: DEFAULT_APPEARANCE });
    const image = await post({ action: 'test', previous: next.config });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/svg+xml');
    assert.match(image.headers.get('content-security-policy'), /^sandbox;/);
    assert.equal(await image.text(), svg);

    const background = '#203040';
    const preview = { action: 'preview', previous: next.config, appearance: { background } };
    const styled = await post({ ...preview, config: { mode: 'server', serverUrl: `${serverUrl}wrong/` }, source: 'Ignored' });
    assert.equal(styled.status, 200);
    assert.equal(await styled.text(), svg);
    assert.deepEqual((await (await fetch(url, { headers: authorized })).json()).config, next.config);
    const unchanged = await post({ action: 'render', source: SAMPLE });
    assert.equal(unchanged.status, 200);
    assert.equal(await unchanged.text(), svg);
    const malformed = await post({ ...preview, appearance: { background: '#203040\n!theme cyborg' } });
    assert.equal(malformed.status, 422);
    assert.deepEqual(await malformed.json(), { error: 'bad_appearance' });
    const styledSave = await post({ action: 'save', previous: next.config, config: { ...next.config, appearance: { background } } });
    assert.equal(styledSave.status, 200);
    const styledConfig = (await styledSave.json()).config;
    assert.deepEqual(styledConfig.appearance, { ...DEFAULT_APPEARANCE, background });
    const changed = await post({ action: 'render', source: SAMPLE });
    assert.equal(changed.status, 200);
    assert.equal(await changed.text(), svg);
    const staleAppearance = await post(preview);
    assert.equal(staleAppearance.status, 409);
    assert.deepEqual(await staleAppearance.json(), { error: 'conflict' });
    const plain = encodeSource(SAMPLE);
    const themed = encodeSource(SAMPLE.replace('@startuml\n', `@startuml\nskinparam BackgroundColor ${background}\n`));
    assert.deepEqual(renderedSources, [plain, themed, plain, themed]);

    const stale = await post(draft);
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: 'conflict' });
    const staleTest = await post({ action: 'test', previous: initial.config });
    assert.equal(staleTest.status, 409);
    assert.deepEqual(await staleTest.json(), { error: 'conflict' });
    const invalid = await post({ action: 'save', previous: styledConfig, config: { mode: 'jar', jarPath: 'relative.jar' } });
    assert.equal(invalid.status, 422);
    assert.deepEqual(await invalid.json(), { error: 'jar_path' });

    const empty = await post({ action: 'render', source: '' });
    assert.equal(empty.status, 422);
    assert.deepEqual(await empty.json(), { error: 'empty_source' });
    const broken = await post({ action: 'render', source: brokenSource });
    assert.equal(broken.status, 422);
    assert.deepEqual(await broken.json(), {
      error: 'syntax', diagnostic: { line: 2, detail: 'Syntax Error? (Assumed diagram type: sequence)' },
    });
    const reset = await post({ action: 'save', previous: styledConfig, config: { mode: 'auto' } });
    assert.equal(reset.status, 200);
    assert.deepEqual(await reset.json(), initial);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
    dispose();
  }
  assert.equal(route, null);
});
