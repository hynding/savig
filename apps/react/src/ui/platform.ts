/** True on macOS — drives ⌘-vs-Ctrl shortcut labels in tooltips/overlays. */
export const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
