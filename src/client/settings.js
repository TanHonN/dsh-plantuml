import { request } from './api.js';
import { loadPreview } from './images.js';
import { React, button, fieldStyle, h, layer, note, subtle } from './ui.js';

const { useEffect, useId, useRef, useState } = React;

const defaultAppearance = {
  theme: 'default', drawing: 'standard', background: '', textColor: '', arrowColor: '', font: '', fontSize: '',
};

export function createSettings(useText, refresh) {
  function StylePreview({ payload, pauseReason, reload }) {
    const t = useText();
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState(null);
    const current = result?.payload === payload && result?.attempt === attempt ? result : null;
    useEffect(() => {
      if (!payload) return;
      const controller = new AbortController();
      const timer = setTimeout(async () => {
        try {
          const { url } = await loadPreview(JSON.parse(payload), controller.signal, { dataUrl: true });
          if (!controller.signal.aborted) setResult({ payload, attempt, url });
        } catch (error) {
          if (!controller.signal.aborted) {
            setResult(previous => ({ payload, attempt, url: previous?.url, error: error.message }));
          }
        }
      }, 400);
      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    }, [payload, attempt]);
    const error = current?.error;
    const url = payload ? result?.url : null;
    const hint = pauseReason ?? error ?? (current ? null : url ? 'updating' : 'rendering');
    return h('figure', { style: { margin: 0, minWidth: 0, display: 'grid', gap: 8, alignContent: 'start' } },
      h('figcaption', { style: { fontWeight: 600 } }, t('effectPreview')),
      h('div', {
        'aria-busy': Boolean(payload && !current),
        style: {
          minHeight: 150, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center',
          padding: 12, border: `1px solid ${subtle}`, borderRadius: 8, background: layer,
        },
      }, url && h('img', {
        src: url, alt: t('sampleAlt'), style: { display: 'block', minWidth: 0, maxWidth: '100%', height: 'auto' },
      }), hint && note(t(hint), Boolean(error)), error && url && note(t('lastPreview')),
      error && error !== 'bad_appearance' && button(t(error === 'conflict' ? 'reload' : 'retry'), {
        onClick: error === 'conflict' ? reload : () => setAttempt(value => value + 1),
      })));
  }

  function StyleSettings({ appearance, disabled, update, reset, canReset, payload, pauseReason, reload }) {
    const t = useText();
    const label = { display: 'grid', gap: 4, minWidth: 0 };
    const columns = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' };
    const select = (field, options) => h('label', { style: label }, t(field),
      h('select', { style: fieldStyle, value: appearance[field], disabled,
        onChange: event => update(field, event.target.value),
      }, options.map(value => h('option', { key: value, value }, t(value)))));
    return h('section', { style: { display: 'grid', gap: 10, borderTop: `1px solid ${subtle}`, paddingTop: 12 } },
      h('h4', { style: { margin: 0 } }, t('style')),
      h('div', { style: columns }, h('div', { style: { display: 'grid', gap: 10, alignContent: 'start' } },
        select('theme', ['default', 'light', 'dark']),
        select('drawing', ['standard', 'handwritten']),
        h('details', null,
          h('summary', { style: { cursor: 'pointer' } }, t('custom')),
          h('div', { style: { display: 'grid', gap: 8, marginBlockStart: 8 } },
            ['background', 'textColor', 'arrowColor', 'font', 'fontSize'].map(field => {
              const color = ['background', 'textColor', 'arrowColor'].includes(field);
              return h('label', { key: field, style: label }, t(field), h('input', {
                type: 'text', value: appearance[field], disabled, style: fieldStyle, autoComplete: 'off', spellCheck: false,
                maxLength: color ? 7 : field === 'fontSize' ? 2 : 48,
                placeholder: color ? '#RRGGBB' : undefined,
                inputMode: field === 'fontSize' ? 'numeric' : undefined,
                onChange: event => update(field, event.target.value),
              }));
            }), note(t('styleHint')))),
        h('div', null, button(t('restore'), { onClick: reset, disabled: disabled || !canReset }))),
      h(StylePreview, { payload, pauseReason, reload })),
      note(t('styleScope')));
  }

  function Settings() {
    const t = useText();
    const inputId = useId();
    const [status, setStatus] = useState(null);
    const [draft, setDraft] = useState(null);
    const [operation, setOperation] = useState('loading');
    const [message, setMessage] = useState(null);
    const [loadCount, setLoadCount] = useState(0);
    const pending = useRef(null);
    function applyStatus(next) {
      setStatus(next);
      setDraft(next.config);
    }
    useEffect(() => {
      const controller = new AbortController();
      void request(null, controller.signal).then(applyStatus, error => {
        if (!controller.signal.aborted) setMessage({ text: error.message, error: true });
      }).finally(() => {
        if (!controller.signal.aborted) setOperation(null);
      });
      return () => { controller.abort(); pending.current?.abort(); };
    }, [loadCount]);
    const reload = () => {
      setOperation('loading');
      setMessage(null);
      setLoadCount(count => count + 1);
    };
    const busy = operation !== null;
    if (!status || !draft) return h('section', null, h('h3', null, t('title')),
      message ? h(React.Fragment, null, note(t(message.text), true), button(t('retry'), { onClick: reload })) : note(t('loading')));

    const activeField = draft.mode === 'jar' ? 'jarPath' : draft.mode === 'server' ? 'serverUrl' : null;
    const backendDirty = status.config.mode !== draft.mode
      || Boolean(activeField && status.config[activeField] !== draft[activeField]);
    const appearance = draft.appearance;
    const styleDirty = Object.keys(defaultAppearance).some(field => appearance[field] !== status.config.appearance[field]);
    const canReset = Object.keys(defaultAppearance).some(field => appearance[field] !== defaultAppearance[field]);
    const dirty = backendDirty || styleDirty;
    const pauseReason = operation === 'save' ? 'saving' : operation === 'loading' ? 'loading' : backendDirty ? 'previewPaused' : null;
    const payload = pauseReason ? null : JSON.stringify({ action: 'preview', previous: status.config, appearance });
    async function save() {
      if (pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setMessage(null);
      setOperation('save');
      try {
        const next = await request({ action: 'save', config: draft, previous: status.config }, controller.signal);
        if (controller.signal.aborted) return;
        applyStatus(next);
        refresh();
        setMessage({ text: 'saved' });
      } catch (error) {
        if (!controller.signal.aborted) setMessage({ text: error.message, error: true });
      } finally {
        pending.current = null;
        if (!controller.signal.aborted) setOperation(null);
      }
    }
    function update(field, value) {
      setDraft(previous => ({ ...previous, [field]: value }));
      setMessage(null);
    }
    function updateStyle(field, value) {
      setDraft(previous => ({ ...previous, appearance: { ...previous.appearance, [field]: value } }));
      setMessage(null);
    }
    function resetStyle() {
      setDraft(previous => ({ ...previous, appearance: defaultAppearance }));
      setMessage(null);
    }
    function discard() {
      setDraft(status.config);
      setMessage(null);
    }
    const disabled = busy || !status.writable;
    const label = { display: 'grid', gap: 4, minWidth: 0 };
    return h('form', {
      onSubmit: event => { event.preventDefault(); if (!disabled && dirty) void save(); },
      style: { display: 'grid', gap: 12, maxWidth: 960 },
    }, h('h3', { style: { margin: 0 } }, t('title')),
    h('label', { htmlFor: `${inputId}-mode`, style: label }, t('mode'),
      h('select', { id: `${inputId}-mode`, style: fieldStyle, value: draft.mode, disabled,
        onChange: event => update('mode', event.target.value),
      }, ['auto', 'jar', 'server'].map(mode => h('option', { key: mode, value: mode }, t(mode))))),
    activeField && h('label', { htmlFor: `${inputId}-value`, style: label }, t(activeField),
      h('input', { id: `${inputId}-value`, type: 'text', style: fieldStyle, disabled,
        value: draft[activeField], spellCheck: false, autoComplete: 'off',
        placeholder: draft.mode === 'server' ? 'http://localhost:8080/plantuml' : undefined,
        onChange: event => update(activeField, event.target.value),
      })),
    note(t('host')),
    draft.mode === 'server' && note(t('privacy')),
    !backendDirty && status.executable && note(t('command', { path: status.executable })),
    !status.writable && note(t('read_only')),
    h(StyleSettings, { appearance, disabled, update: updateStyle, reset: resetStyle, canReset, payload, pauseReason, reload }),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
      button(t('save'), { type: 'submit', disabled: disabled || !dirty }),
      button(t('discard'), { disabled: disabled || !dirty, onClick: discard }),
      message?.text === 'conflict' && button(t('reload'), { onClick: reload, disabled: busy })),
    message && note(t(message.text), message.error));
  }

  return Settings;
}
