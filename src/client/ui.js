import * as React from 'react';

const { createElement: h } = React;

const subtle = 'var(--dsw-alias-border-l1)';
const layer = 'var(--dsw-alias-bg-layer-1)';
const quiet = { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', margin: 0 };
const buttonStyle = {
  padding: '4px 10px', border: `1px solid ${subtle}`, borderRadius: 6, color: 'inherit', font: 'inherit',
};
const fieldStyle = {
  padding: '6px 8px', maxWidth: '100%', border: `1px solid ${subtle}`, borderRadius: 6,
  background: layer, color: 'inherit', font: 'inherit',
};
function button(label, props = {}, selected = false) {
  return h('button', {
    type: 'button', ...props,
    style: {
      ...buttonStyle, cursor: props.disabled ? 'default' : 'pointer', opacity: props.disabled ? 0.55 : 1,
      background: selected ? 'var(--dsw-alias-bg-layer-2)' : layer,
      borderColor: selected ? 'var(--dsw-alias-border-selected)' : subtle,
    },
  }, label);
}
function note(text, error = false) {
  return h('p', {
    role: error ? 'alert' : 'status',
    style: error ? { ...quiet, color: 'var(--dsw-alias-state-error-primary)' } : quiet,
  }, text);
}

const toolbar = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 8px',
  borderBottom: `1px solid ${subtle}`, fontSize: 13, background: 'var(--dsw-alias-bg-layer-2)',
};
const pane = { border: `1px solid ${subtle}`, borderRadius: 8, overflow: 'hidden', minWidth: 0 };
const codeStyle = { fontFamily: 'monospace', fontSize: '0.9em', lineHeight: 1.5, tabSize: 4 };

export { React, button, codeStyle, fieldStyle, h, layer, note, pane, quiet, subtle, toolbar };
