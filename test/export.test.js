import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDiagramDownload, exportChoices } from '../src/client/export.js';

const source = '@startuml\nAlice -> Bob: 中文\n@enduml\n';
const svg = { blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }) };
const png = { blob: new Blob([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)], { type: 'image/png' }) };

const enabledFormats = preview => exportChoices(preview).filter(choice => choice.available).map(choice => choice.format);

test('the export menu and downloader enforce the same format availability', () => {
  assert.deepEqual(enabledFormats(null), ['puml']);
  assert.deepEqual(enabledFormats(png), ['png', 'puml']);
  assert.deepEqual(enabledFormats(svg), ['svg', 'png', 'transparent', 'puml']);
  assert.throws(() => createDiagramDownload('png', source, null), /exportFailed/);
  assert.throws(() => createDiagramDownload('transparent', source, png), /exportFailed/);
  assert.throws(() => createDiagramDownload('unknown', source, svg), /exportFailed/);
});

test('downloads preserve the source and original image bytes when no conversion is needed', async () => {
  const sourceDownload = createDiagramDownload('puml', source, null);
  assert.match(sourceDownload.filename, /^plantuml-[0-9a-f]{8}\.puml$/);
  assert.equal(await sourceDownload.data.text(), source);

  const svgDownload = createDiagramDownload('svg', source, svg);
  assert.equal(svgDownload.filename, sourceDownload.filename.replace(/\.puml$/, '.svg'));
  assert.equal(svgDownload.data.type, 'application/octet-stream');
  assert.equal(await svgDownload.data.text(), await svg.blob.text());

  const pngDownload = createDiagramDownload('png', source, png);
  assert.equal(pngDownload.filename, sourceDownload.filename.replace(/\.puml$/, '.png'));
  assert.equal(await pngDownload.data, png.blob);
});
