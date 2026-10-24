const SELECTABLE_SELECTOR =
  'input, textarea, [contenteditable="true"], [contenteditable=""], pre, code, .selectable';

/**
 * Suppress WebView navigation and writing-tools context menus on app chrome.
 * Editable fields, logs and session content keep the native menu so copy and
 * paste continue to work.
 */
export function initializeContextMenuGuard(): () => void {
  const handleContextMenu = (event: MouseEvent) => {
    if (window.getSelection()?.toString()) return;
    if (
      event.target instanceof Element &&
      event.target.closest(SELECTABLE_SELECTOR)
    ) {
      return;
    }
    event.preventDefault();
  };

  document.addEventListener("contextmenu", handleContextMenu);
  return () => document.removeEventListener("contextmenu", handleContextMenu);
}
