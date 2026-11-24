import { canExportDiagram, createDiagramDownload } from './export.js';
import { copyText } from './clipboard.js';
import { useCardPreview } from './card-preview.js';
import { cardDraftKey, canKeepDraft } from './drafts.js';
import { selectSourceLine, SyntaxDiagnostic } from './diagnostics.js';
import { ExportMenu } from './export-menu.js';
import { React, button, codeStyle, h, layer, note, pane, quiet, subtle, toolbar } from './ui.js';

const { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

export function createFence({ useText, DiagramViewport, Fullscreen, revision, drafts, previewQueue }) {
  return function Card({ code, children, sessionId, streaming }) {
    const t = useText();
    const config = useSyncExternalStore(revision.subscribe, revision.snapshot);
    const anchor = useRef(null);
    const [draftKey, setDraftKey] = useState(null);
    const editorId = useId();
    const editor = useRef(null);
    const diagramContent = useRef(null);
    const viewChosen = useRef(false);
    const [jumpLine, setJumpLine] = useState(null);
    const download = useRef(null);
    const downloads = useRef(new Map());
    const [view, setView] = useState('diagram');
    const [draft, setDraft] = useState(null);
    const [fullscreen, setFullscreen] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [exporting, setExporting] = useState(false);
    const source = draft ?? code;
    const { visible, preview, current, failure, pending, staleWhileStreaming, retry } = useCardPreview({
      anchor, code, draft, streaming, config, enabled: view !== 'source', previewQueue,
    });

    useLayoutEffect(() => {
      if (jumpLine === null || !editor.current) return;
      selectSourceLine(editor.current, jumpLine);
      setJumpLine(null);
    }, [jumpLine, view]);

    useLayoutEffect(() => {
      if (streaming) return;
      // Older hosts may not annotate transcript rows. Those cards keep drafts locally.
      const key = cardDraftKey(anchor.current, sessionId);
      setDraftKey(key);
      setDraft(drafts.get(key, code));
    }, [streaming, code, sessionId]);

    useEffect(() => {
      if (streaming || failure?.message !== 'syntax' || draft !== null || viewChosen.current) return;
      viewChosen.current = true;
      const content = diagramContent.current;
      // Switching views would unmount the native code and preview controls.
      if (!content?.contains(content.ownerDocument.activeElement)) {
        setView(active => active === 'diagram' ? 'edit' : active);
      }
    }, [streaming, failure, draft]);

    useEffect(() => {
      const urls = downloads.current;
      return () => {
        for (const [url, timer] of urls) {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
        }
        urls.clear();
      };
    }, []);

    function chooseView(next) {
      viewChosen.current = true;
      setView(next);
    }

    function jumpToSource(line) {
      chooseView('edit');
      setJumpLine(line);
    }

    function changeDraft(next) {
      setDraft(next === code ? null : next);
      drafts.update(draftKey, code, next);
      setFeedback(null);
    }

    async function copySource() {
      try {
        await copyText(source, anchor.current);
        setFeedback({ message: 'copied' });
      } catch {
        setFeedback({ message: 'copyFailed', error: true });
      }
    }

    async function exportFile(format) {
      if (exporting || !canExportDiagram(format, current)) return;
      const link = download.current;
      setFeedback(null);
      setExporting(true);
      try {
        const { data, filename } = createDiagramDownload(format, source, current);
        // Keep downloads that need no conversion in the original click handler.
        const blob = data instanceof Blob ? data : await data;
        if (!link.isConnected) return;
        const href = URL.createObjectURL(blob);
        downloads.current.set(href, setTimeout(() => {
          URL.revokeObjectURL(href);
          downloads.current.delete(href);
        }, 30_000));
        link.href = href;
        link.download = filename;
        link.click();
      } catch {
        if (link.isConnected) setFeedback({ message: 'exportFailed', error: true });
      } finally {
        if (link.isConnected) setExporting(false);
      }
    }

    function openFullscreen() {
      viewChosen.current = true;
      setFullscreen(true);
    }

    const previewPanel = embedded => h('div', { style: embedded ? { ...pane, flex: '1 1 300px' } : undefined },
      staleWhileStreaming && h('div', { style: { padding: 8 } }, note(t('lastPreview'))),
      (embedded || preview) && h(DiagramViewport, { preview, embedded, onFullscreen: openFullscreen }),
      !streaming && pending && h('div', { style: { padding: 8 } }, note(t(preview ? 'updating' : 'rendering'))));
    const errorPanel = !streaming && view !== 'source' && failure && h('div', { style: { display: 'grid', gap: 6, padding: 8 } },
      note(t(failure.message), true),
      preview && note(t('lastPreview')),
      failure.message === 'syntax' && h(SyntaxDiagnostic, {
        t, diagnostic: failure.diagnostic, source, onJump: jumpToSource,
      }),
      h('div', null, button(t('retry'), { onClick: retry })));

    const codeView = () => draft === null ? children : h('pre', {
      style: { ...codeStyle, margin: 0, padding: 12, whiteSpace: 'pre', overflow: 'auto', maxHeight: '55vh' },
    }, source);

    return h('section', { ref: anchor, 'aria-label': 'PlantUML', style: streaming && !preview ? undefined : { ...pane, background: layer } },
      !streaming && h('div', { style: toolbar },
        h('div', { role: 'group', 'aria-label': 'PlantUML', style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          ['diagram', 'source', 'edit'].map(tab => button(t(tab), {
            key: tab, 'aria-pressed': view === tab, onClick: () => chooseView(tab),
          }, view === tab))),
        h('div', { style: { marginInlineStart: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 6 } },
          button(t('copySource'), { onClick: () => { void copySource(); } }),
          h(ExportMenu, { t, current, exporting, onExport: exportFile })),
        h('a', { ref: download, hidden: true })),
      (feedback || exporting) && h('div', { style: { padding: '4px 8px' } },
        note(t(exporting ? 'exporting' : feedback.message), feedback?.error)),
      errorPanel,
      view === 'source' && codeView(),
      view === 'diagram' && h('div', { ref: diagramContent },
        (visible || preview) && previewPanel(false),
        !preview && codeView()),
      view === 'edit' && h('div', { style: { padding: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 } },
        h('div', { style: { ...pane, flex: '1 1 300px' } },
          h('div', { style: toolbar }, h('label', { htmlFor: editorId, style: { fontWeight: 600 } }, t('editor')),
            button(t('restoreOriginal'), { disabled: draft === null, onClick: () => changeDraft(code) })),
          h('textarea', { ref: editor, id: editorId, 'aria-describedby': `${editorId}-hint`, value: source, spellCheck: false, wrap: 'off',
            onChange: event => changeDraft(event.target.value),
            style: { ...codeStyle, display: 'block', boxSizing: 'border-box', width: '100%', height: 'clamp(210px, 44vh, 430px)',
              resize: 'vertical', padding: 10, border: 0, color: 'inherit', background: layer },
          }), h('div', { id: `${editorId}-hint`, style: { ...quiet, padding: 8, borderTop: `1px solid ${subtle}` } },
            t(draftKey && canKeepDraft(code, source) ? 'sessionDraftHint' : 'draftHint'))),
        previewPanel(true)),
      fullscreen && preview && h(Fullscreen, {
        preview, failed: Boolean(failure),
        status: streaming ? (staleWhileStreaming ? t('lastPreview') : null)
          : failure ? `${t(failure.message)} ${t('lastPreview')}` : !current ? t('updating') : null,
        close: () => setFullscreen(false),
      }));
  };
}
