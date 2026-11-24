// Only attempt a render after an explicit matching end marker while Markdown is streaming.
// A bare diagram or an ambiguous ending is rendered by the normal final path.
export function completedStreamingSource(code) {
  if (code.length > 64 * 1024) return null;
  const source = code.trimEnd();
  const start = /^[\t \r\n\uFEFF]*@start([a-z][a-z0-9]*)\b[^\r\n]*[\r\n]/i.exec(source);
  if (!start) return null;
  const lastLine = source.slice(Math.max(source.lastIndexOf('\r'), source.lastIndexOf('\n')) + 1).trimStart();
  return lastLine.toLowerCase() === `@end${start[1].toLowerCase()}` ? source : null;
}

export function requestedPreviewSource(source, streaming, early, config) {
  if (streaming) return early?.config === config ? early.source : null;
  // Fence completion can remove a trailing newline without changing the diagram.
  return early?.config === config && source.trimEnd() === early.source ? early.source : source;
}
