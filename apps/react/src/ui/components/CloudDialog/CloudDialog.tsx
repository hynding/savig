// PLACEHOLDER — Task 6 replaces this with the real cloud-projects browser / account dialog
// (list/open/rename/delete projects, sign-in/out). This stub exists only so Task 5's overlay
// wiring (App.tsx `overlay === 'cloud'`, the openCloudProjects/openCloudAccount host actions)
// compiles and is reachable end-to-end. Deliberately minimal: no styling module, no cloud reads.
export function CloudDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cloud projects"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--color-surface, #fff)', padding: '1.5rem', borderRadius: 8, minWidth: 320 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p>Cloud projects — coming soon.</p>
        <button aria-label="Close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
