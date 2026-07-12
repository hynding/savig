// Small inline SVG glyphs for the toolbar buttons. currentColor → theme-aware (inherit button
// color); aria-hidden because the button's aria-label is the accessible name. ~16px on a 16 viewBox.
import type { ReactElement } from 'react';

export type IconName =
  | 'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'brush' | 'eyedropper' | 'motion' | 'scissors' | 'text'
  | 'new' | 'open' | 'save' | 'export';

const P: Record<IconName, ReactElement> = {
  select: <path d="M3 2l9 5-4 1.2L6 13 3 2z" fill="currentColor" stroke="none" />,
  pen: <path d="M3 13l1-3 6-6 2 2-6 6-3 1zm7-8l1-1 1 1-1 1" />,
  node: (
    <>
      <path d="M3 8h10" />
      <rect x="1.5" y="6.5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="11.5" y="6.5" width="3" height="3" fill="currentColor" stroke="none" />
    </>
  ),
  rect: <rect x="2.5" y="3.5" width="11" height="9" rx="1" />,
  ellipse: <ellipse cx="8" cy="8" rx="6" ry="4.5" />,
  polygon: <path d="M8 2l5.2 3v6L8 14l-5.2-3V5L8 2z" />,
  star: <path d="M8 1.7l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.1 4.3 13.2l.8-4.2L2 6.1l4.2-.5L8 1.7z" fill="currentColor" stroke="none" />,
  line: <path d="M3 13L13 3" />,
  brush: <path d="M11 2l3 3-5 5-3-3 5-5zM6 10l-3 4 4-3" />,
  eyedropper: (
    <>
      <path d="M9.5 4.5l2-2a1.4 1.4 0 0 1 2 2l-2 2" />
      <path d="M10.5 5.5l-6 6L3 14l2.5-1.5 6-6" />
    </>
  ),
  motion: (
    <>
      <path d="M2 12C4 6 12 10 14 4" strokeDasharray="2 2" />
      <circle cx="2" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  scissors: (
    <>
      <path d="M3 3l10 10M13 3L3 13" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  text: <path d="M3 3.5h10M8 3.5v9" />,
  new: <path d="M4 2h5l3 3v9H4V2zm5 0v3h3" />,
  open: <path d="M2 4h4l1.5 2H14v7H2V4z" />,
  save: (
    <>
      <path d="M2.5 2.5h8L13.5 5.5v8h-11v-11z" />
      <path d="M5 2.5v4h5v-4M5.5 13.5v-4h5v4" />
    </>
  ),
  export: (
    <>
      <path d="M8 10V2M5 5l3-3 3 3" />
      <path d="M3 9v5h10V9" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}
