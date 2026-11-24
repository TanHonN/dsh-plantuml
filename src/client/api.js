import { en } from './messages.js';

export async function request(data, signal, image = false) {
  try {
    const url = new URL('dsh-plantuml/api', document.baseURI);
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store', signal,
      ...(data && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
    });
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (response.ok && image && (type === 'image/svg+xml' || type === 'image/png')) return response.blob();
    if (type === 'application/json') {
      const result = await response.json();
      if (!response.ok || image) {
        const code = Object.hasOwn(en, result?.error) ? result.error : 'unreachable';
        const failure = new Error(code);
        if (code === 'syntax') {
          const { line, detail } = result.diagnostic ?? {};
          failure.diagnostic = {
            line: Number.isSafeInteger(line) && line > 0 ? line : undefined,
            detail: typeof detail === 'string' ? detail.slice(0, 160) : undefined,
          };
        }
        throw failure;
      }
      return result;
    }
    throw new Error('unreachable');
  } catch (error) {
    if (signal.aborted || Object.hasOwn(en, error.message)) throw error;
    throw new Error('unreachable');
  }
}
