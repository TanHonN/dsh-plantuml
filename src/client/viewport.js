import { React, button, h, layer, note, pane, toolbar } from './ui.js';

const { useEffect, useLayoutEffect, useRef, useState } = React;

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export function createViewport(useText) {
  function DiagramViewport({ preview, fullscreen = false, embedded = false, onFullscreen, onClose, closeRef }) {
    const t = useText();
    const canvas = useRef(null);
    const position = useRef(null);
    const pointers = useRef(new Map());
    const gesture = useRef(null);
    const lastTap = useRef(null);
    const lastTouchZoom = useRef(-Infinity);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(null);
    const [dragging, setDragging] = useState(false);
    const fit = preview && size.width && size.height
      ? Math.min(1, Math.max(1, size.width - 16) / preview.width, Math.max(1, size.height - 16) / preview.height)
      : 1;
    const scale = zoom ?? fit;
    const minZoom = Math.min(fit, 0.1);
    const width = Math.max(1, Math.round((preview?.width ?? 1) * scale));
    const height = Math.max(1, Math.round((preview?.height ?? 1) * scale));
    const overflow = width + 16 > size.width || height + 16 > size.height;

    useLayoutEffect(() => {
      const node = canvas.current;
      const measure = () => setSize(previous => {
        const width = node.clientWidth;
        const height = node.clientHeight;
        return previous.width === width && previous.height === height ? previous : { width, height };
      });
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
      const node = canvas.current;
      const next = position.current;
      if (!next) return;
      position.current = null;
      node.scrollLeft = (Math.max(node.clientWidth, width + 16) - width) / 2 + next.x * width - next.offsetX;
      node.scrollTop = (Math.max(node.clientHeight, height + 16) - height) / 2 + next.y * height - next.offsetY;
    }, [width, height, zoom]);

    function adjust(target, event) {
      if (!preview) return;
      const next = target === null ? fit : clamp(target, minZoom, 8);
      const requested = target === null ? null : next;
      if (requested === zoom) return;
      const node = canvas.current;
      const area = node.getBoundingClientRect();
      const offsetX = event ? event.clientX - area.left : node.clientWidth / 2;
      const offsetY = event ? event.clientY - area.top : node.clientHeight / 2;
      position.current = {
        x: (node.scrollLeft + offsetX - (Math.max(node.clientWidth, width + 16) - width) / 2) / width,
        y: (node.scrollTop + offsetY - (Math.max(node.clientHeight, height + 16) - height) / 2) / height,
        offsetX, offsetY,
      };
      setZoom(requested);
    }

    useEffect(() => {
      if (!fullscreen || !preview) return;
      const node = canvas.current;
      const wheel = event => {
        event.preventDefault();
        const factor = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? 180 : 1;
        adjust(scale * Math.exp(-clamp(event.deltaY * factor, -300, 300) * 0.003), event);
      };
      node.addEventListener('wheel', wheel, { passive: false });
      return () => node.removeEventListener('wheel', wheel);
    }, [fullscreen, preview, scale, size, zoom]);

    function toggleZoom(event) {
      adjust(zoom === null ? Math.max(1, fit * 1.6) : null, event);
    }

    function pointerDown(event) {
      if (!preview || event.button !== 0 || (event.pointerType !== 'touch' && !overflow)) return;
      if (pointers.current.size >= 2) return;
      const point = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, point);
      const node = event.currentTarget;
      node.setPointerCapture(event.pointerId);
      if (pointers.current.size === 2) {
        const [a, b] = pointers.current.values();
        gesture.current = { pinch: true, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale };
        lastTap.current = null;
      } else {
        gesture.current = { point, left: node.scrollLeft, top: node.scrollTop, moved: false };
      }
    }

    function pointerMove(event) {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const start = gesture.current;
      if (start?.pinch && pointers.current.size === 2) {
        const [a, b] = pointers.current.values();
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        adjust(start.scale * distance / start.distance, { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      } else if (start && !start.pinch) {
        const dx = event.clientX - start.point.x;
        const dy = event.clientY - start.point.y;
        if (!start.moved && Math.hypot(dx, dy) < 4) return;
        start.moved = true;
        if (!overflow) return;
        setDragging(true);
        const node = event.currentTarget;
        node.scrollLeft = start.left - dx;
        node.scrollTop = start.top - dy;
      }
    }

    function pointerEnd(event) {
      if (!pointers.current.delete(event.pointerId)) return;
      if (pointers.current.size) return;
      const start = gesture.current;
      gesture.current = null;
      setDragging(false);
      if (event.type !== 'pointerup' || event.pointerType !== 'touch' || !start || start.pinch || start.moved) {
        lastTap.current = null;
        return;
      }
      const now = performance.now();
      const previous = lastTap.current;
      if (previous && now - previous.time < 300 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
        lastTap.current = null;
        lastTouchZoom.current = now;
        toggleZoom(event);
      } else {
        lastTap.current = { time: now, x: event.clientX, y: event.clientY };
      }
    }

    return h(React.Fragment, null,
      h('div', { style: toolbar },
        embedded && h('strong', null, t('effectPreview')),
        h('div', { role: 'group', 'aria-label': t('preview'), style: { marginInlineStart: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' } },
          button('−', { 'aria-label': t('zoomOut'), title: t('zoomOut'), disabled: !preview || scale <= minZoom, onClick: () => adjust(scale / 1.25) }),
          button(t(fullscreen ? 'fitWindow' : 'fit'), { disabled: !preview, onClick: () => adjust(null) }),
          button('+', { 'aria-label': t('zoomIn'), title: t('zoomIn'), disabled: !preview || scale >= 8, onClick: () => adjust(scale * 1.25) }),
          fullscreen
            ? h(React.Fragment, null, button('100%', { title: t('actualSize'), 'aria-label': t('actualSize'), onClick: () => adjust(1) }),
              button(t('closeFullscreen'), { onClick: onClose, ref: closeRef }))
            : button(t('fullscreen'), { onClick: onFullscreen, disabled: !preview }))),
      h('div', {
        ref: canvas, tabIndex: preview ? 0 : undefined, role: 'region', 'aria-label': t('preview'),
        onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerEnd,
        onPointerCancel: pointerEnd, onLostPointerCapture: pointerEnd,
        onDoubleClick: event => {
          if (!event.nativeEvent.sourceCapabilities?.firesTouchEvents && performance.now() - lastTouchZoom.current > 350) {
            toggleZoom(event);
          }
        },
        style: {
          height: fullscreen ? undefined : 'clamp(210px, 44vh, 430px)', flex: fullscreen ? '1 1 0' : undefined,
          minHeight: 0, overflow: 'auto', background: layer,
          cursor: dragging ? 'grabbing' : preview && overflow ? 'grab' : undefined,
          touchAction: preview ? (fullscreen ? 'none' : 'pan-y') : undefined,
        },
      }, preview && h('div', {
        style: { display: 'grid', placeItems: 'center', boxSizing: 'content-box', padding: 8,
          width: `max(calc(100% - 16px), ${width}px)`, height: `max(calc(100% - 16px), ${height}px)` },
      }, h('img', { src: preview.url, alt: t('preview'), draggable: false,
        style: { display: 'block', width, height, maxWidth: 'none', maxHeight: 'none', userSelect: 'none', touchAction: 'none' } }))));
  }

  function Fullscreen({ preview, status, failed, close }) {
    const t = useText();
    const dialog = useRef(null);
    const closeButton = useRef(null);
    useLayoutEffect(() => {
      const node = dialog.current;
      const previousFocus = document.activeElement;
      node.showModal();
      closeButton.current?.focus();
      return () => {
        if (node.open) node.close();
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      };
    }, []);
    return h('dialog', {
      ref: dialog, 'aria-label': t('preview'),
      onCancel: event => { event.preventDefault(); close(); },
      onClick: event => { if (event.target === event.currentTarget) close(); },
      style: { ...pane, padding: 0, margin: 'auto', position: 'fixed', inset: 0,
        width: 'min(96vw, 1800px)', height: '88vh', maxWidth: 'none', color: 'inherit', background: layer },
    }, h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      status && h('div', { style: { padding: '6px 8px' } }, note(status, failed)),
      h(DiagramViewport, { preview, fullscreen: true, onClose: close, closeRef: closeButton })));
  }

  return { DiagramViewport, Fullscreen };
}
