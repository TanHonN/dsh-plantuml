export async function copyText(text, container) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard API access can be disabled in an embedded Web view.
    const active = document.activeElement;
    const input = document.createElement('textarea');
    input.value = text;
    input.readOnly = true;
    input.tabIndex = -1;
    input.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none';
    container.append(input);
    try {
      input.select();
      if (!document.execCommand('copy')) throw new Error('copyFailed');
    } finally {
      input.remove();
      if (active?.isConnected) active.focus({ preventScroll: true });
    }
  }
}
