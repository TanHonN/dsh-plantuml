import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { encodeSource, findCommand, renderDiagram, SAMPLE } from '../renderer.js';

// A single-pixel PNG suffices for transport and validation tests.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=', 'base64');

const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>');

await test('the PlantUML server protocol prefers SVG, supports PNG-only endpoints, and preserves errors', { timeout: 5000 }, async () => {
  const sample = '@startuml\nAlice -> Bob: Authentication Request\nBob --> Alice: Authentication Response\n@enduml';
  // Reference value produced by `plantuml -pipe -encodeurl`.
  const encoded = 'Syp9J4vLqBLJSCfFibB8ICt9oGS0';
  assert.equal(encodeSource('Alice -> Bob: hello'), encoded);
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url.startsWith('/syntax/')) res.writeHead(400, {
      'x-plantuml-diagram-error': 'Cannot include /private/renderer/source.puml',
      'x-plantuml-diagram-error-line': '4',
    }).end('Private renderer output');
    else if (req.url.startsWith('/generic/')) res.writeHead(400).end();
    else if (req.url.startsWith('/unmapped/')) res.writeHead(400, {
      'x-plantuml-diagram-error': 'Syntax Error?',
      'x-plantuml-diagram-error-line': '1',
    }).end();
    else if (req.url.startsWith('/redirect/')) res.writeHead(302, { location: '/plantuml/svg/redirected' }).end();
    else if (req.url.startsWith('/legacy/svg/')) res.writeHead(404).end();
    else if (req.url.startsWith('/legacy/png/')) res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    else if (req.url.startsWith('/ditaa/svg/')) res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(PNG);
    else res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' }).end(SVG);
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = base => ({ mode: 'server', serverUrl: origin + base });
    assert.deepEqual(await renderDiagram(url('/plantuml'), sample), { bytes: SVG, type: 'image/svg+xml' });
    assert.deepEqual(await renderDiagram(url('/legacy'), sample), { bytes: PNG, type: 'image/png' });
    assert.deepEqual(await renderDiagram(url('/ditaa'), sample), { bytes: PNG, type: 'image/png' });
    const themedConfig = { appearance: { theme: 'dark' } };
    await assert.rejects(renderDiagram({ ...url('/syntax'), ...themedConfig }, sample), {
      code: 'syntax', diagnostic: { detail: 'Cannot include referenced resource', line: 3 },
    });
    const includes = sample.replace('@startuml\n', '@startuml\n!include <some/diagram>\n');
    await assert.rejects(renderDiagram(url('/syntax'), includes), {
      code: 'syntax', diagnostic: { detail: 'Cannot include referenced resource', line: undefined },
    });
    await assert.rejects(renderDiagram(url('/generic'), sample), {
      code: 'syntax', diagnostic: { detail: undefined, line: undefined },
    });
    await assert.rejects(renderDiagram({ ...url('/unmapped'), ...themedConfig }, sample), {
      code: 'syntax', diagnostic: { detail: 'Syntax error', line: undefined },
    });
    await assert.rejects(renderDiagram(url('/redirect'), sample), { code: 'server_unreachable' });
    const themed = sample.replace('@startuml\n', '@startuml\n!theme cyborg\nskinparam BackgroundColor #15191D\n');
    assert.deepEqual(requests, [
      ...['/plantuml/svg', '/legacy/svg', '/legacy/png', '/ditaa/svg'].map(path => `${path}/${encodeSource(sample)}`),
      `/syntax/svg/${encodeSource(themed)}`, `/syntax/svg/${encodeSource(includes)}`, `/generic/svg/${encodeSource(sample)}`,
      `/unmapped/svg/${encodeSource(themed)}`, `/redirect/svg/${encodeSource(sample)}`,
    ]);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
  }
});

await test('an installed plantuml CLI renders bare source as SVG, preserves Ditaa PNG, and rejects syntax errors', { timeout: 50_000 }, async t => {
  if (!await findCommand('plantuml')) return t.skip('plantuml is unavailable on this Host');
  const image = await renderDiagram({ mode: 'auto' }, 'Alice -> Bob: 你好');
  assert.equal(image.type, 'image/svg+xml');
  assert.match(image.bytes.toString('utf8'), /<svg\b[\s\S]*<\/svg>/);
  const style = { theme: 'light', drawing: 'handwritten', background: '#102030', textColor: '#E0F0FF', arrowColor: '#FEDCBA', font: 'Courier New', fontSize: '18' };
  const styled = await renderDiagram({ mode: 'auto', appearance: style }, 'Alice -> Bob: 你好');
  const styledSvg = styled.bytes.toString();
  assert.match(styledSvg, /background:#102030/);
  assert.match(styledSvg, /<text\b(?=[^>]*fill="#E0F0FF")(?=[^>]*font-family="Courier New")(?=[^>]*font-size="18")/);
  assert.match(styledSvg, /#FEDCBA/);
  assert.match(styledSvg, /<path\b/);
  assert.doesNotMatch(styledSvg, /deprecated/);
  const ditaa = await renderDiagram({ mode: 'auto', appearance: style }, '@startditaa\n+---+\n| A |\n+---+\n@endditaa');
  assert.equal(ditaa.type, 'image/png');
  assert.equal(ditaa.bytes.toString('ascii', 12, 16), 'IHDR');
  const broken = '\r\n@startuml\r\nAlice -> Bob: Hello\r\ninvalid statement\r\n@enduml';
  await assert.rejects(renderDiagram({ mode: 'auto', appearance: style }, broken), {
    code: 'syntax', diagnostic: { line: 4, detail: 'Syntax Error? (Assumed diagram type: sequence)' },
  });
  const multiple = '@startuml\nAlice -> Bob: Hello\n@enduml\n\n@startuml\nAlice -> Bob: Hello\ninvalid statement\n@enduml';
  await assert.rejects(renderDiagram({ mode: 'auto' }, multiple), {
    code: 'syntax', diagnostic: { line: 7, detail: 'Syntax Error? (Assumed diagram type: sequence)' },
  });
  const pipeDirective = '@startuml\nAlice -> Bob: Hello\n@@@format svg\ninvalid statement\n@enduml';
  await assert.rejects(renderDiagram({ mode: 'auto' }, pipeDirective), error => (
    error.code === 'syntax' && error.diagnostic?.line === undefined
  ));
});

await test('an explicitly supplied PlantUML JAR renders and reports error lines in bare source', { timeout: 20_000 }, async t => {
  const jarPath = process.env.DSH_PLANTUML_TEST_JAR;
  if (!jarPath) return t.skip('DSH_PLANTUML_TEST_JAR is unset');
  const config = { mode: 'jar', jarPath };
  const image = await renderDiagram(config, SAMPLE);
  assert.equal(image.type, 'image/svg+xml');
  assert.match(image.bytes.toString('utf8'), /<svg\b[\s\S]*<\/svg>/);
  await assert.rejects(renderDiagram(config, 'Alice -> Bob: Hello\ninvalid statement'), {
    code: 'syntax', diagnostic: { line: 2, detail: 'Syntax Error? (Assumed diagram type: sequence)' },
  });
});
