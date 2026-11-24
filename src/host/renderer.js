import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

export const MAX_SOURCE = 64 * 1024;
export const SAMPLE = '@startuml\nAlice -> Bob: Hello PlantUML\nBob --> Alice: OK\n@enduml\n';
const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_URL = 8192;
const TIMEOUT = 15_000;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SVG_TYPE = 'image/svg+xml';
const PNG_TYPE = 'image/png';
const CLI_ARGS = ['-pipe', '-tsvg', '-nometadata', '-failfast2', '-charset', 'UTF-8'];
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

export class RenderError extends Error {
  constructor(code, status = 422, diagnostic) {
    super(code);
    this.code = code;
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

function syntaxError(message, inputLine) {
  // Forward known parser text only. Stderr and server headers can contain source or filesystem paths.
  const assumed = /^Syntax Error\?\s*\(Assumed diagram type: ([\w-]+)\)$/i.exec(message ?? '')?.[1];
  const knownTypes = ['sequence', 'class', 'activity', 'state', 'component', 'object', 'usecase', 'deployment',
    'timing', 'mindmap', 'wbs', 'gantt', 'json', 'yaml', 'salt', 'ditaa', 'nwdiag', 'creole'];
  const diagramType = knownTypes.find(type => type === assumed?.toLowerCase());
  let detail;
  if (diagramType) detail = `Syntax Error? (Assumed diagram type: ${diagramType})`;
  else if (/^Syntax Error\??(?:\s*\(.*\))?$/i.test(message ?? '')) detail = 'Syntax error';
  else if (/^Cannot include\b/i.test(message ?? '')) detail = 'Cannot include referenced resource';
  return new RenderError('syntax', 422, { inputLine, detail });
}

export function serverBase(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new RenderError('server_url');
  }
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    return url;
  } catch {
    throw new RenderError('server_url');
  }
}

export async function findCommand(name, env = process.env, platform = process.platform) {
  const win = platform === 'win32';
  const paths = win ? path.win32 : path.posix;
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const entries = searchPath.split(paths.delimiter).map(dir => win ? dir.replace(/^"|"$/g, '') : dir);
  if (platform === 'darwin') entries.push('/opt/homebrew/bin', '/usr/local/bin');
  const names = win ? [`${name}.exe`, `${name}.com`] : [name];
  for (const dir of new Set(entries.filter(dir => paths.isAbsolute(dir)))) {
    for (const file of names) {
      const candidate = paths.join(dir, file);
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, win ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Search the next PATH entry.
      }
    }
  }
  return null;
}

export function encodeSource(source) {
  const compressed = deflateRawSync(Buffer.from(source, 'utf8'));
  let result = '';
  for (let i = 0; i < compressed.length; i += 3) {
    const a = compressed[i], b = compressed[i + 1] ?? 0, c = compressed[i + 2] ?? 0;
    result += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)]
      + ALPHABET[((b & 15) << 2) | (c >> 6)] + ALPHABET[c & 63];
  }
  return result;
}

function checkedPng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_MAGIC)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new RenderError('bad_image');
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) {
    throw new RenderError('image_limit');
  }
  return { bytes, type: PNG_TYPE };
}

function checkedImage(bytes) {
  // Some diagram types return PNG even when SVG was requested.
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return checkedPng(bytes);
  const prefix = bytes.toString('utf8', 0, 4096);
  if (!/^\s*(?:<\?xml\s[^?]*\?>\s*)?<svg(?=[\s/>])/u.test(prefix)) {
    throw new RenderError('bad_image');
  }
  return { bytes, type: SVG_TYPE };
}

function childEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|PLANTUML_SECURITY_PROFILE|PLANTUML_LIMIT_SIZE)$/i.test(key)) {
      delete env[key];
    }
  }
  env.PLANTUML_SECURITY_PROFILE = 'SANDBOX';
  env.PLANTUML_LIMIT_SIZE = '4096';
  return env;
}

function runLocal(executable, args, source, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, env: childEnvironment() });
    const chunks = [];
    let bytes = 0;
    let stderr = '';
    let failure;
    const stop = error => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const abort = () => stop(new RenderError('cancelled', 499));
    const timer = setTimeout(() => stop(new RenderError('timeout', 504)), TIMEOUT);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.once('error', () => { failure ??= new RenderError('start_failed'); });
    child.stdin.on('error', () => { /* Process exit owns an interrupted input pipe. */ });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_IMAGE) stop(new RenderError('image_limit'));
      else chunks.push(chunk);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 8192); });
    child.once('close', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      // Some PlantUML versions emit an error image and exit 0 in pipe mode.
      if (/^ERROR\s*$|^Error line \d+|Syntax Error\?/mi.test(stderr)) {
        // The number after ERROR is relative to the diagram. Match the stdin location from the same error block.
        const block = /^ERROR\r?\n\d+\r?\n([^\r\n]+)(?:\r?\nError line (\d+) in standard input(?=\r?$))?/m.exec(stderr);
        const inputLine = block ? block[2] : /^Error line (\d+) in standard input\r?$/m.exec(stderr)?.[1];
        return reject(syntaxError(block?.[1], Number(inputLine)));
      }
      if (code !== 0) return reject(new RenderError('render_failed'));
      resolve(Buffer.concat(chunks));
    });
    child.stdin.end(source);
  });
}

async function requestServer(base, encoded, format, signal) {
  const url = new URL(`${format}/${encoded}`, base);
  if (url.href.length > MAX_URL) throw new RenderError('server_input_limit');
  const preferSvg = format === 'svg';
  const response = await fetch(url, {
    signal, redirect: 'error', headers: { accept: preferSvg ? `${SVG_TYPE}, ${PNG_TYPE};q=0.9` : PNG_TYPE },
  });
  if (response.headers.has('x-plantuml-diagram-error') || response.status === 400) {
    const message = response.headers.get('x-plantuml-diagram-error');
    const position = response.headers.get('x-plantuml-diagram-error-line');
    await response.body?.cancel();
    // The official server reports the zero-based LineLocation position.
    const inputLine = message && /^\d+$/.test(position ?? '') ? Number(position) + 1 : undefined;
    throw syntaxError(message, inputLine);
  }
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || (type !== PNG_TYPE && !(preferSvg && type === SVG_TYPE))) {
    await response.body?.cancel();
    // Older deployments or proxies may expose PNG but not the SVG endpoint.
    if (preferSvg && (response.ok || [404, 405, 406, 415, 501].includes(response.status))) return null;
    throw new RenderError('server_response', 502);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > MAX_IMAGE) throw new RenderError('image_limit');
    chunks.push(chunk);
  }
  const image = checkedImage(Buffer.concat(chunks));
  if (!preferSvg && image.type !== PNG_TYPE) throw new RenderError('bad_image');
  return image;
}

async function renderServer(base, source, signal) {
  const encoded = encodeSource(source);
  const timer = AbortSignal.timeout(TIMEOUT);
  const requestSignal = AbortSignal.any([signal, timer]);
  try {
    return await requestServer(base, encoded, 'svg', requestSignal)
      ?? await requestServer(base, encoded, 'png', requestSignal);
  } catch (error) {
    if (signal.aborted) throw new RenderError('cancelled', 499);
    if (timer.aborted) throw new RenderError('timeout', 504);
    if (error instanceof RenderError) throw error;
    throw new RenderError('server_unreachable', 502);
  }
}

export async function backendFor(config) {
  if (config.mode === 'server') return { mode: 'server', url: serverBase(config.serverUrl) };
  if (config.mode === 'jar') {
    const jar = config.jarPath?.trim();
    try {
      if (!jar || !path.isAbsolute(jar) || path.extname(jar).toLowerCase() !== '.jar' || !(await stat(jar)).isFile()) {
        throw new Error();
      }
      await access(jar, constants.R_OK);
    } catch {
      throw new RenderError('jar_path');
    }
    const java = await findCommand('java');
    if (!java) throw new RenderError('java_missing');
    return {
      mode: 'jar', executable: java,
      args: ['-Xmx256m', '-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=SANDBOX', '-jar', jar, ...CLI_ARGS],
    };
  }
  if (config.mode !== undefined && config.mode !== 'auto') throw new RenderError('bad_config');
  const executable = await findCommand('plantuml');
  if (!executable) throw new RenderError('cli_missing');
  return { mode: 'auto', executable, args: CLI_ARGS };
}

export const DEFAULT_APPEARANCE = Object.freeze({
  theme: 'default', drawing: 'standard', background: '', textColor: '', arrowColor: '', font: '', fontSize: '',
});

export function normalizeAppearance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RenderError('bad_appearance');
  const appearance = { ...DEFAULT_APPEARANCE };
  for (const key of Object.keys(appearance)) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'string') throw new RenderError('bad_appearance');
    appearance[key] = value[key].trim();
  }
  if (!['default', 'light', 'dark'].includes(appearance.theme)
    || !['standard', 'handwritten'].includes(appearance.drawing)) throw new RenderError('bad_appearance');
  for (const key of ['background', 'textColor', 'arrowColor']) {
    if (appearance[key] && !/^#[\da-f]{6}$/i.test(appearance[key])) throw new RenderError('bad_appearance');
    appearance[key] = appearance[key].toUpperCase();
  }
  if (appearance.font && !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,47}$/u.test(appearance.font)) {
    throw new RenderError('bad_appearance');
  }
  if (appearance.fontSize && (!/^\d{1,2}$/.test(appearance.fontSize)
    || Number(appearance.fontSize) < 8 || Number(appearance.fontSize) > 48)) {
    throw new RenderError('bad_appearance');
  }
  if (appearance.fontSize) appearance.fontSize = String(Number(appearance.fontSize));
  return appearance;
}

function styledSource(source, value) {
  const style = normalizeAppearance(value);
  const opener = /^[ \t]*@start(\w+)\b[^\r\n]*/im.exec(source);
  if (opener && opener[1].toLowerCase() !== 'uml') return { text: source };
  const lines = [];
  if (style.theme === 'light') lines.push('!theme plain');
  if (style.theme === 'dark') lines.push('!theme cyborg', 'skinparam BackgroundColor #15191D');
  if (style.drawing === 'handwritten') lines.push('!option handwritten true');
  for (const [key, param] of Object.entries({
    background: 'BackgroundColor', textColor: 'DefaultFontColor', arrowColor: 'ArrowColor',
    font: 'DefaultFontName', fontSize: 'DefaultFontSize',
  })) {
    if (style[key]) lines.push(`skinparam ${param} ${style[key]}`);
  }
  if (!opener) return { text: ['@startuml', ...lines, source, '@enduml'].join('\n'), insertedAfter: 0, insertedCount: lines.length + 1 };
  if (!lines.length) return { text: source };
  const end = opener.index + opener[0].length;
  const before = source.slice(0, end);
  const eol = /^(?:\r\n|\r|\n)/.exec(source.slice(end))?.[0] ?? '\n';
  return {
    text: before + eol + lines.join(eol) + source.slice(end),
    insertedAfter: before.split(/\r\n|\r|\n/).length,
    insertedCount: lines.length,
  };
}

export async function renderDiagram(config, source, signal = new AbortController().signal) {
  if (typeof source !== 'string' || !source.trim()) throw new RenderError('empty_source');
  if (Buffer.byteLength(source) > MAX_SOURCE) throw new RenderError('source_limit', 413);
  const { text, insertedAfter = 0, insertedCount = 0 } = styledSource(source, config.appearance);
  const backend = await backendFor(config);
  if (signal.aborted) throw new RenderError('cancelled', 499);
  try {
    if (backend.mode === 'server') return await renderServer(backend.url, text, signal);
    return checkedImage(await runLocal(backend.executable, backend.args, text, signal));
  } catch (error) {
    if (error instanceof RenderError && error.code === 'syntax') {
      const { inputLine, detail } = error.diagnostic;
      let line;
      // Included sources can have their own line numbers, and pipe mode consumes @@@format lines.
      const ambiguousLocation = /^[\t \uFEFF]*!(?:include\w*\b|import\b|theme\b[^\r\n]*\bfrom\b)/im.test(source)
        || (backend.mode !== 'server' && /^[\t ]*@@@format\b/im.test(source));
      if (!ambiguousLocation && Number.isSafeInteger(inputLine) && inputLine > 0) {
        // Neither the added style directives nor the synthetic wrapper belongs to the editor.
        if (inputLine <= insertedAfter) line = inputLine;
        else if (inputLine > insertedAfter + insertedCount) line = inputLine - insertedCount;
        if (line > source.split(/\r\n|\r|\n/).length) line = undefined;
      }
      error.diagnostic = { line, detail };
    }
    throw error;
  }
}
