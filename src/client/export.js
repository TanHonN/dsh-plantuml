import { decodeImage, imageDataUrl } from './images.js';

async function withoutSvgBackground(preview) {
  const doc = new DOMParser().parseFromString(await preview.blob.text(), 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg') throw new Error('bad_image');
  const background = root.style.backgroundColor;
  root.style.removeProperty('background');
  root.style.removeProperty('background-color');
  // PlantUML can paint its canvas with a leading, unclassed rectangle as well as root CSS.
  const group = [...root.children].find(node => node.localName === 'g');
  const rect = group?.firstElementChild;
  if (background && rect?.localName === 'rect' && !rect.hasAttribute('class') && !rect.hasAttribute('id')
    && rect.style.stroke === 'none' && Number(rect.getAttribute('x')) === 0 && Number(rect.getAttribute('y')) === 0
    && Math.abs(Number(rect.getAttribute('width')) - preview.width) <= 1
    && Math.abs(Number(rect.getAttribute('height')) - preview.height) <= 1) {
    const color = doc.createElementNS(root.namespaceURI, 'rect');
    color.style.backgroundColor = rect.getAttribute('fill') ?? '';
    if (color.style.backgroundColor === background) rect.remove();
  }
  return imageDataUrl(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
}

async function asPng(preview, transparent) {
  if (preview.blob.type === 'image/png') return preview.blob;
  const image = await decodeImage(transparent ? await withoutSvgBackground(preview) : preview.url);
  const { width, height } = preview;
  const scale = Math.min(3, 8192 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('exportFailed');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('exportFailed')), 'image/png');
    });
  } finally {
    canvas.width = canvas.height = 1;
  }
}

const FORMATS = {
  svg: {
    label: 'exportSvg', extension: 'svg', requires: 'svg',
    build: (_, preview) => new Blob([preview.blob], { type: 'application/octet-stream' }),
  },
  png: {
    label: 'exportPng', extension: 'png', requires: 'image',
    build: (_, preview) => asPng(preview, false),
  },
  transparent: {
    label: 'exportTransparent', extension: 'transparent.png', requires: 'svg',
    build: (_, preview) => asPng(preview, true),
  },
  puml: {
    label: 'exportSource', extension: 'puml',
    build: source => new Blob([source], { type: 'text/plain;charset=utf-8' }),
  },
};

export function canExportDiagram(format, preview) {
  if (!Object.hasOwn(FORMATS, format)) return false;
  const { requires } = FORMATS[format];
  if (requires === 'svg') return preview?.blob.type === 'image/svg+xml';
  if (requires === 'image') return Boolean(preview);
  return true;
}

export function exportChoices(preview) {
  return Object.entries(FORMATS).map(([format, { label }]) => ({ format, label, available: canExportDiagram(format, preview) }));
}

export function createDiagramDownload(format, source, preview) {
  if (!canExportDiagram(format, preview)) throw new Error('exportFailed');
  const { build, extension } = FORMATS[format];
  return { data: build(source, preview), filename: diagramFilename(source, extension) };
}

function diagramFilename(source, extension) {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `plantuml-${(hash >>> 0).toString(16).padStart(8, '0')}.${extension}`;
}
