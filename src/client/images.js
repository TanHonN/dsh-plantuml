import { request } from './api.js';

function previewUrl(blob) {
  if (blob.type.split(';')[0] === 'image/png') return URL.createObjectURL(blob);
  return imageDataUrl(blob);
}

function imageDataUrl(blob) {
  // A standalone data URL has an opaque origin even if opened outside <img>.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('bad_image'));
    reader.readAsDataURL(blob);
  });
}

function releasePreviewUrl(url) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

async function decodeImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode().catch(() => { throw new Error('bad_image'); });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('bad_image');
  return image;
}

export { decodeImage, imageDataUrl, releasePreviewUrl };

// A successful result transfers URL ownership to the caller. Failure and
// cancellation before that point release any object URL here.
export async function loadPreview(payload, signal, { dataUrl = false } = {}) {
  const blob = await request(payload, signal, true);
  signal.throwIfAborted();
  const url = await (dataUrl ? imageDataUrl(blob) : previewUrl(blob));
  try {
    signal.throwIfAborted();
    const image = await decodeImage(url);
    signal.throwIfAborted();
    return { blob, url, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) {
    releasePreviewUrl(url);
    throw error;
  }
}
