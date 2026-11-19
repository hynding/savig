import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportVideoDialog } from './ExportVideoDialog';
import { useEditor } from '../../store/store';
import * as videoExportModule from '../../export/videoExport';

import * as gifExportModule from '../../export/gifExport';
import * as spriteExportModule from '../../export/spriteSheetExport';

vi.mock('../../export/videoExport', () => ({ exportVideo: vi.fn() }));
vi.mock('../../export/spriteSheetExport', () => ({ exportSpriteSheet: vi.fn() }));
vi.mock('../../export/gifExport', async (orig) => ({ ...(await orig<typeof import('../../export/gifExport')>()), exportGif: vi.fn() }));
const exportVideoMock = videoExportModule.exportVideo as ReturnType<typeof vi.fn>;
const exportGifMock = gifExportModule.exportGif as ReturnType<typeof vi.fn>;
const exportSpritesMock = spriteExportModule.exportSpriteSheet as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useEditor.getState().newProject();
  exportVideoMock.mockReset();
  exportGifMock.mockReset();
  exportSpritesMock.mockReset();
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

  it('I-2: shows a duration + estimated frame-count summary that updates when fps changes', () => {
    render(<ExportVideoDialog onClose={() => {}} />);
    const meta = useEditor.getState().history.present.meta; // pristine project: 0 duration
    const summary = screen.getByTestId('export-video-summary');
    expect(summary).toHaveTextContent('0.0s · 1 frames'); // frameCount = max(1, round(duration*fps))
    fireEvent.change(screen.getByLabelText('Frames per second'), { target: { value: String(meta.fps * 2) } });
    expect(summary).toHaveTextContent('0.0s · 1 frames'); // still floors at 1 for a 0-duration project
  });

  it('M-4: clearing the fps field then exporting still sends a finite, clamped fps (never NaN)', async () => {
    exportVideoMock.mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'x.mp4', mime: 'video/mp4' });
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Frames per second'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportVideoMock).toHaveBeenCalledTimes(1));
    const [, , opts] = exportVideoMock.mock.calls[0];
    expect(Number.isFinite(opts.fps)).toBe(true);
    expect(opts.fps).toBeGreaterThanOrEqual(1);
    expect(opts.fps).toBeLessThanOrEqual(60);
  });

  it('M-4: clearing the width field then exporting still sends a finite, clamped width (never NaN)', async () => {
    exportVideoMock.mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'x.mp4', mime: 'video/mp4' });
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportVideoMock).toHaveBeenCalledTimes(1));
    const [, , opts] = exportVideoMock.mock.calls[0];
    expect(Number.isFinite(opts.width)).toBe(true);
    expect(opts.width).toBeGreaterThanOrEqual(16);
    expect(opts.width).toBeLessThanOrEqual(3840);
  });

  it('Escape closes the dialog when idle', () => {
    let closed = 0;
    render(<ExportVideoDialog onClose={() => { closed += 1; }} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(closed).toBe(1);
  });

  it('Escape does nothing while an export is running (no accidental abort)', async () => {
    let closed = 0;
    let capturedSignal: AbortSignal | null = null;
    exportVideoMock.mockImplementation(async (_p, _b, _o, onProgress, signal) => {
      capturedSignal = signal;
      onProgress('frames', 0.25);
      await new Promise((res) => setTimeout(res, 50));
      return null;
    });
    render(<ExportVideoDialog onClose={() => { closed += 1; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText(/rendering frames/i);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(closed).toBe(0);
    expect(capturedSignal!.aborted).toBe(false);
  });

  it('opens on Animated GIF when asked, with a loop toggle and no WebM note', () => {
    render(<ExportVideoDialog initialFormat="gif" onClose={() => {}} />);
    expect(screen.getByLabelText('Format')).toHaveValue('gif');
    expect(screen.getByRole('heading', { name: 'Export GIF' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loop forever')).toBeChecked();
    expect(screen.queryByTestId('webm-disabled-note')).toBeNull();
  });

  it('GIF Export calls exportGif (not exportVideo) with clamped fps/width and the loop choice', async () => {
    exportGifMock.mockResolvedValue({ bytes: new Uint8Array([0x47]), filename: 'x.gif', mime: 'image/gif' });
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'gif' } });
    fireEvent.change(screen.getByLabelText('Frames per second'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '4000' } });
    expect(screen.getByText(/GIF plays at most 50 fps/)).toBeInTheDocument();
    expect(screen.getByText(/GIF width is capped at 1920px/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Loop forever'));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportGifMock).toHaveBeenCalledTimes(1));
    expect(exportVideoMock).not.toHaveBeenCalled();
    const [project, opts] = exportGifMock.mock.calls[0];
    expect(project).toBe(useEditor.getState().history.present);
    expect(opts).toEqual({ fps: 50, width: 1920, loop: false });
  });

  it('Sprite sheet: small default cell, grid readout, and exportSpriteSheet gets the options', async () => {
    exportSpritesMock.mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'x-spritesheet.zip', mime: 'application/zip' });
    render(<ExportVideoDialog initialFormat="sprites" onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Export Sprite Sheet' })).toBeInTheDocument();
    const meta = useEditor.getState().history.present.meta;
    expect(screen.getByLabelText('Width')).toHaveValue(Math.min(meta.width, 256));
    expect(screen.getByTestId('export-video-summary')).toHaveTextContent(/1 frames · 1×1 grid/);
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Padding'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Transparent background'));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportSpritesMock).toHaveBeenCalledTimes(1));
    const [, opts] = exportSpritesMock.mock.calls[0];
    expect(opts).toMatchObject({ columns: 3, padding: 2, background: 'white', frameWidth: Math.min(meta.width, 256) });
  });

  it('Sprite sheet: an oversize sheet shows why and disables Export', () => {
    render(<ExportVideoDialog initialFormat="sprites" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '9000' } });
    expect(screen.getByTestId('sprite-sheet-error')).toHaveTextContent(/limit/);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
});
