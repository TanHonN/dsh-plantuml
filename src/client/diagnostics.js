import { copyText } from './clipboard.js';
import { React, button, h, note, quiet } from './ui.js';

export function selectSourceLine(editor, line) {
  // A textarea normalizes line endings to LF, so derive offsets from its DOM value.
  const lines = editor.value.split('\n');
  const text = lines[line - 1];
  if (text === undefined) return;
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, start + text.length);
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
  if (Number.isFinite(lineHeight)) editor.scrollTop = (line - 1) * lineHeight - editor.clientHeight / 3;
  editor.scrollLeft = 0;
  editor.scrollIntoView({ block: 'nearest' });
}

export function SyntaxDiagnostic({ t, diagnostic, source, onJump }) {
  const [includeSource, setIncludeSource] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  const disclosure = React.useRef(null);
  const { line, detail } = diagnostic ?? {};
  const location = line ? t('diagnosticLine', { line }) : t('diagnosticNoLine');
  const report = [`PlantUML [syntax]`, t('syntax'), location, detail].filter(Boolean).join('\n');

  async function copy() {
    try {
      const text = includeSource ? `${report}\n\n${t('editor')}\n${source}` : report;
      await copyText(text, disclosure.current);
      setFeedback('diagnosticCopied');
    } catch {
      setFeedback('diagnosticCopyFailed');
    }
  }

  return h('div', { style: { display: 'grid', justifyItems: 'start', gap: 6, minWidth: 0 } },
    line && button(t('goToLine', { line }), { onClick: () => onJump(line) }),
    h('details', { ref: disclosure, style: { maxWidth: '100%' } },
      h('summary', { style: { cursor: 'pointer' } }, t('diagnosticDetails')),
      h('div', { style: { display: 'grid', justifyItems: 'start', gap: 6, paddingBlock: 6 } },
        h('div', { style: quiet }, location),
        detail && h('div', { style: { ...quiet, overflowWrap: 'anywhere' } }, detail),
        h('label', { style: { ...quiet, display: 'flex', alignItems: 'center', gap: 6 } },
          h('input', { type: 'checkbox', checked: includeSource, onChange: event => setIncludeSource(event.target.checked) }),
          t('includeSource')),
        button(t('copyDiagnostic'), { onClick: () => { void copy(); } }),
        feedback && note(t(feedback), feedback === 'diagnosticCopyFailed'))));
}
