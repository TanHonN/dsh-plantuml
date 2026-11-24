import Schema from '@deepseek-ai/schemastery';
import path from 'node:path';
import {
  backendFor, DEFAULT_APPEARANCE, MAX_SOURCE, normalizeAppearance, RenderError, renderDiagram, SAMPLE, serverBase,
} from './renderer.js';

export const inject = ['connection', 'webServer'];
export const Config = Schema.object({
  mode: Schema.union(['auto', 'jar', 'server']).default('auto').volatile(),
  jarPath: Schema.string().default('').volatile(),
  serverUrl: Schema.string().default('').volatile(),
  appearance: Schema.object({
    theme: Schema.union(['default', 'light', 'dark']).default(DEFAULT_APPEARANCE.theme),
    drawing: Schema.union(['standard', 'handwritten']).default(DEFAULT_APPEARANCE.drawing),
    background: Schema.string().default(''),
    textColor: Schema.string().default(''),
    arrowColor: Schema.string().default(''),
    font: Schema.string().default(''),
    fontSize: Schema.string().default(''),
  }).default({}).volatile(),
});

const API = '/dsh-plantuml/api';
const MAX_BODY = MAX_SOURCE * 6 + 1024;
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function send(res, status, data, contentType) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    ...HEADERS,
    'content-type': contentType ?? 'application/json; charset=utf-8',
    // The client uses an image element. Constrain document rendering too.
    ...(contentType === 'image/svg+xml' && {
      'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    }),
  });
  res.end(contentType ? data : JSON.stringify(data));
}

async function readRequest(req) {
  const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new RenderError('body_type', 415);
  if (Number(req.headers['content-length']) > MAX_BODY) {
    req.resume();
    throw new RenderError('source_limit', 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.resume();
      throw new RenderError('source_limit', 413);
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Respond with a bounded error below. */ }
  throw new RenderError('body_invalid', 400);
}

function savedFields(config) {
  return {
    mode: config.mode ?? 'auto', jarPath: config.jarPath ?? '', serverUrl: config.serverUrl ?? '',
    appearance: { ...DEFAULT_APPEARANCE, ...config.appearance },
  };
}

function validateDraft(draft) {
  if (!draft || !['auto', 'jar', 'server'].includes(draft.mode)) throw new RenderError('bad_config');
  const config = { mode: draft.mode, appearance: normalizeAppearance(draft.appearance) };
  if (draft.mode === 'jar') {
    const jarPath = typeof draft.jarPath === 'string' ? draft.jarPath.trim() : '';
    if (!path.isAbsolute(jarPath) || jarPath.length > 4096 || path.extname(jarPath).toLowerCase() !== '.jar' || jarPath.includes('\0')) {
      throw new RenderError('jar_path');
    }
    config.jarPath = jarPath;
  }
  if (draft.mode === 'server') config.serverUrl = serverBase(draft.serverUrl).href;
  return config;
}

function sameSettings(a, b) {
  if (a.mode !== b.mode || a.jarPath !== b.jarPath || a.serverUrl !== b.serverUrl) return false;
  return Object.keys(DEFAULT_APPEARANCE).every(key => a.appearance[key] === (b.appearance?.[key] ?? DEFAULT_APPEARANCE[key]));
}

async function status(config, writable) {
  const current = savedFields(config);
  try {
    const selected = await backendFor(config);
    return { config: current, executable: selected.executable, writable };
  } catch (error) {
    return { config: current, problem: error instanceof RenderError ? error.code : 'render_failed', writable };
  }
}

export function apply(ctx, config) {
  const entry = ctx.fiber.entry;
  const editor = ctx.get('configEditor');
  const writable = Boolean(entry && editor);
  const read = () => ({
    mode: config.mode.get(),
    jarPath: config.jarPath.get(),
    serverUrl: config.serverUrl.get(),
    appearance: config.appearance.get(),
  });
  ctx.effect(() => {
    const lifetime = new AbortController();
    let running = 0;
    let saving = false;
    const unregister = ctx.webServer.register({
      kind: 'exact', path: API,
      async handler(req, res) {
        const admission = ctx.connection.admit(req);
        if ('rejection' in admission || admission.peer.principal.kind !== 'owner'
          || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
          req.resume();
          return send(res, admission.rejection ?? 403, { error: 'denied' });
        }
        const disconnect = new AbortController();
        const onClose = () => disconnect.abort();
        res.once('close', onClose);
        const signal = AbortSignal.any([disconnect.signal, lifetime.signal, admission.peer.signal]);
        try {
          if (req.method === 'GET') return send(res, 200, await status(read(), writable));
          if (req.method !== 'POST') {
            res.setHeader('allow', 'GET, POST');
            return send(res, 405, { error: 'method' });
          }
          const body = await readRequest(req);
          if (body.action === 'save') {
            if (!writable) throw new RenderError('read_only', 403);
            if (saving || !sameSettings(savedFields(read()), body.previous ?? {})) throw new RenderError('conflict', 409);
            const next = validateDraft(body.config);
            saving = true;
            try {
              await editor.edit(entry, current => {
                const updated = { ...current, mode: next.mode };
                delete updated.jarPath;
                delete updated.serverUrl;
                return Object.assign(updated, next);
              });
            } catch {
              throw new RenderError('save_failed', 409);
            } finally {
              saving = false;
            }
            return send(res, 200, await status(read(), writable));
          }
          if (!['render', 'test', 'preview'].includes(body.action)) throw new RenderError('body_invalid', 400);
          const current = read();
          const sample = body.action !== 'render';
          if (sample && !sameSettings(savedFields(current), body.previous ?? {})) {
            throw new RenderError('conflict', 409);
          }
          // A draft can change the sample's appearance; the renderer always uses the saved backend.
          if (body.action === 'preview') current.appearance = normalizeAppearance(body.appearance);
          if (running >= 3) throw new RenderError('busy', 429);
          running++;
          try {
            const image = await renderDiagram(current, sample ? SAMPLE : body.source, signal);
            return send(res, 200, image.bytes, image.type);
          } finally {
            running--;
          }
        } catch (error) {
          if (error instanceof RenderError) {
            return send(res, error.status, { error: error.code, diagnostic: error.diagnostic });
          }
          return send(res, 500, { error: 'render_failed' });
        } finally {
          res.off('close', onClose);
        }
      },
    });
    return () => {
      lifetime.abort();
      unregister();
    };
  }, 'dsh-plantuml: authenticated render and settings route');
}
