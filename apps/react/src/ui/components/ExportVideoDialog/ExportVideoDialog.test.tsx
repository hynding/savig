import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportVideoDialog } from './ExportVideoDialog';
import { useEditor } from '../../store/store';
import * as videoExportModule from '../../export/videoExport';

vi.mock('../../export/videoExport', () => ({ exportVideo: vi.fn() }));
const exportVideoMock = videoExportModule.exportVideo as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useEditor.getState().newProject();
  exportVideoMock.mockReset();
});

describe('ExportVideoDialog', () => {
  it('defaults: MP4, fps = meta.fps, width = artboard width', () => {
    render(<ExportVideoDialog onClose={() => {}} />);
    expect(screen.getByLabelText('Format')).toHaveValue('mp4');
    expect(screen.getByLabelText('Frames per second')).toHaveValue(useEditor.getState().history.present.meta.fps);
    expect(screen.getByLabelText('Width')).toHaveValue(useEditor.getState().history.present.meta.width);
  });

  it('Export invokes exportVideo with the chosen options and a project/binaries snapshot', async () => {
    exportVideoMock.mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'x.mp4', mime: 'video/mp4' });
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportVideoMock).toHaveBeenCalledTimes(1));
    const [project, , opts] = exportVideoMock.mock.calls[0];
    expect(project).toBe(useEditor.getState().history.present); // the snapshot
    expect(opts.format).toBe('mp4');
  });

  it('the WebM option is disabled and an explanatory note is shown', () => {
    render(<ExportVideoDialog onClose={() => {}} />);
    const webmOption = screen.getByRole('option', { name: 'WebM (VP9)' }) as HTMLOptionElement;
    expect(webmOption.disabled).toBe(true);
    expect(screen.getByTestId('webm-disabled-note')).toHaveTextContent(
      'WebM is temporarily unavailable: the bundled in-browser encoder (ffmpeg.wasm) crashes on real frame content. Export MP4 — WebM returns with the server-side encoder.',
    );
  });

  it('shows phase progress while running and Cancel aborts', async () => {
    let capturedSignal: AbortSignal | null = null;
    exportVideoMock.mockImplementation(async (_p, _b, _o, onProgress, signal) => {
      capturedSignal = signal;
      onProgress('frames', 0.25);
      await new Promise((res) => setTimeout(res, 50));
      return null; // cancelled
    });
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText(/rendering frames/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    await waitFor(() => expect(capturedSignal!.aborted).toBe(true));
  });

  it('an export failure surfaces a toast and re-enables the form', async () => {
    exportVideoMock.mockRejectedValue(new Error('encode exploded'));
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(useEditor.getState().toasts.some((t) => t.message.includes('encode exploded'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  });
});
