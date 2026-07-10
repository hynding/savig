import { useEffect, useRef } from 'react';
import { makeKeymapController, type KeymapController, type CommandHost } from '@savig/ui-core';
import { useEditor } from '../store/store';

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Global keyboard shortcuts. Thin React adapter over the neutral `makeKeymapController`: it owns
 *  the `window` keydown listener + the `isEditable` DOM guard, and calls `preventDefault` when the
 *  controller says the shortcut was handled. All dispatch logic lives in the controller/registry.
 *  The `host` (stable) supplies the file/overlay effects the registry commands need. When `blocked`
 *  (an overlay is open) the global keymap is fully suppressed — the overlay owns the keyboard, so a
 *  stray Delete/Space can't mutate the document behind a modal. */
export function useKeyboard(host: CommandHost, blocked = false): void {
  const ref = useRef<KeymapController>();
  if (!ref.current) ref.current = makeKeymapController(useEditor, host);
  const ctrl = ref.current;

  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (ctrl.handleKey({ key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey })) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl, blocked]);
}
