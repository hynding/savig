// The Stage's last known pointer position in ACTIVE-SCENE coordinates (root, or the edited
// symbol's space in edit mode — whatever clientToLocal returns). A plain module ref, NOT store
// state: it updates on every pointer-move, and a Zustand field would notify subscribers each time.
// The Stage writes it (pointer-move/leave); paste-at-cursor reads it. Null when the pointer is not
// over the Stage (so paste falls back to the fixed offset).

let cursor: { x: number; y: number } | null = null;

export function setStageCursor(p: { x: number; y: number } | null): void {
  cursor = p;
}

export function getStageCursor(): { x: number; y: number } | null {
  return cursor;
}
