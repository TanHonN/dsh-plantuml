import { exportChoices } from './export.js';
import { React, button, h, note, subtle } from './ui.js';

const { useId, useLayoutEffect, useRef } = React;
const INSET = 8;
const GAP = 4;

export function ExportMenu({ t, current, exporting, onExport }) {
  const id = useId();
  const trigger = useRef(null);
  const panel = useRef(null);
  const choices = exportChoices(current);
  const hint = !current ? 'exportWait' : choices.some(choice => choice.format === 'svg' && choice.available) ? null : 'pngOnly';

  useLayoutEffect(() => {
    const menu = panel.current;
    const doc = menu.ownerDocument;
    const browser = doc.defaultView;

    function place() {
      const { clientWidth, clientHeight } = doc.documentElement;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.max(0, Math.min(220, clientWidth - 2 * INSET));
      const below = clientHeight - rect.bottom - GAP - INSET;
      const above = rect.top - GAP - INSET;
      const openAbove = below < (menu.scrollHeight || 208) && above > below;
      Object.assign(menu.style, {
        width: `${width}px`,
        left: `${Math.max(INSET, Math.min(rect.right - width, clientWidth - INSET - width))}px`,
        top: openAbove ? 'auto' : `${Math.max(INSET, rect.bottom + GAP)}px`,
        bottom: openAbove ? `${Math.max(INSET, clientHeight - rect.top + GAP)}px` : 'auto',
        maxHeight: `${Math.max(0, openAbove ? above : below)}px`,
      });
    }

    function dismissOnScroll(event) {
      // A chat scroll can clip the trigger while a top-layer popover stays visible.
      if (event.target !== menu) menu.hidePopover();
    }

    function track() {
      if (!menu.matches(':popover-open')) {
        stopTracking();
        return;
      }
      place();
      browser.addEventListener('scroll', dismissOnScroll, true);
      browser.addEventListener('resize', place);
    }

    function stopTracking() {
      browser.removeEventListener('scroll', dismissOnScroll, true);
      browser.removeEventListener('resize', place);
    }

    function prepare(event) {
      if (event.newState === 'open') place();
    }

    menu.addEventListener('beforetoggle', prepare);
    menu.addEventListener('toggle', track);
    return () => {
      stopTracking();
      menu.removeEventListener('beforetoggle', prepare);
      menu.removeEventListener('toggle', track);
    };
  }, []);

  function option({ label, format, available }) {
    const disabled = exporting || !available;
    return h('button', {
      key: format, type: 'button', disabled,
      onClick: () => {
        panel.current.hidePopover();
        trigger.current.focus({ preventScroll: true });
        onExport(format);
      },
      style: {
        display: 'block', width: '100%', textAlign: 'start', padding: '7px 9px', border: 0, borderRadius: 4,
        color: 'inherit', background: 'transparent', font: 'inherit', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      },
    }, t(label));
  }

  return h(React.Fragment, null,
    button(h(React.Fragment, null, t('export'), ' ', h('span', { 'aria-hidden': true }, '▾')), {
      ref: trigger, popoverTarget: id,
    }),
    h('div', {
      id, popover: 'auto', ref: panel, role: 'group', 'aria-label': t('export'),
      style: {
        position: 'fixed', inset: 'auto', margin: 0, padding: 4, boxSizing: 'border-box',
        border: `1px solid ${subtle}`, borderRadius: 6, maxWidth: 'none', overflowY: 'auto',
        overscrollBehavior: 'contain', color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-overlay)', font: 'inherit',
      },
    },
    choices.map(option),
    hint && h('div', { style: { padding: '4px 9px' } }, note(t(hint)))));
}
