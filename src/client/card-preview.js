import { loadPreview, releasePreviewUrl } from './images.js';
import { completedStreamingSource, requestedPreviewSource } from './streaming.js';
import { React } from './ui.js';

const { useEffect, useState } = React;

export function useCardPreview({ anchor, code, draft, streaming, config, enabled, previewQueue, action, serverUrl }) {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [nearViewport, setNearViewport] = useState(typeof IntersectionObserver === 'undefined');
  const [early, setEarly] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  const renderSource = requestedPreviewSource(draft ?? code, streaming, early, config);
  const requested = item => item && item.config === config && item.code === renderSource && item.attempt === attempt;
  const current = requested(preview) ? preview : null;
  const failure = requested(error) ? error : null;
  const pending = visible && renderSource !== null && enabled && !current && !failure;

  useEffect(() => {
    if (!streaming || !nearViewport || early) return;
    const complete = completedStreamingSource(code);
    if (complete !== null) setEarly({ source: complete, config });
  }, [streaming, nearViewport, early, code, config]);

  const observeVisibility = !visible || (streaming && !early);
  useEffect(() => {
    if (!observeVisibility || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const intersects = entries.at(-1)?.isIntersecting ?? false;
      setNearViewport(intersects);
      if (intersects) setVisible(true);
    }, { rootMargin: '160px' });
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [anchor, observeVisibility]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let dequeue;
    const timer = setTimeout(() => {
      dequeue = previewQueue(controller.signal, async () => {
        try {
          const next = await loadPreview({ action, source: renderSource, serverUrl }, controller.signal);
          if (controller.signal.aborted) {
            releasePreviewUrl(next.url);
            return;
          }
          setPreview({ ...next, code: renderSource, config, attempt });
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError({ code: renderSource, config, attempt, message: cause.message, diagnostic: cause.diagnostic });
        }
      });
    }, draft === null ? 0 : 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
      dequeue?.();
    };
    // Use the resolved source to keep the same request when streaming ends.
  }, [pending, renderSource, config, attempt, draft, previewQueue, action, serverUrl]);

  const url = preview?.url;
  useEffect(() => () => releasePreviewUrl(url), [url]);

  return {
    visible, preview, current, failure, pending,
    staleWhileStreaming: Boolean(streaming && preview && (!current || code.trimEnd() !== preview.code)),
    retry: () => setAttempt(value => value + 1),
  };
}
