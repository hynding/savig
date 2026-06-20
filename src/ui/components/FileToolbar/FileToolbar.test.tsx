import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FileToolbar } from './FileToolbar';
import { ToastHost } from '../Toast/Toast';
import { useEditor } from '../../store/store';
import * as services from '../../../services';

beforeEach(() => {
  useEditor.getState().newProject();
  vi.restoreAllMocks();
});

it('New resets to an empty project', async () => {
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'x', normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg"/>', viewBox: '0 0 1 1', width: 1, height: 1 });
  render(<FileToolbar />);
  await userEvent.click(screen.getByRole('button', { name: /new/i }));
  expect(useEditor.getState().history.present.assets).toHaveLength(0);
});

it('Save serializes the project and writes it to disk', async () => {
  const save = vi.spyOn(services, 'saveBytesToDisk').mockResolvedValue();
  const serialize = vi.spyOn(services, 'saveSavig');
  render(<FileToolbar />);
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  expect(serialize).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toBe(serialize.mock.results[0].value); // exact bytes written
  expect(save.mock.calls[0][1] as string).toMatch(/\.savig$/);
});

it('Export builds the bundle and writes the zip', async () => {
  const save = vi.spyOn(services, 'saveBytesToDisk').mockResolvedValue();
  const build = vi.spyOn(services, 'exportProject');
  render(<FileToolbar />);
  await userEvent.click(screen.getByRole('button', { name: /export/i }));
  expect(build).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toBe(build.mock.results[0].value);
  expect(save.mock.calls[0][1] as string).toMatch(/\.zip$/);
});

it('Open shows a toast when the file is corrupt', async () => {
  vi.spyOn(services, 'openBytesFromDisk').mockResolvedValue({ name: 'broken.savig', bytes: new Uint8Array([0, 1, 2]) });
  render(
    <>
      <FileToolbar />
      <ToastHost />
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: /open/i }));
  expect(await screen.findByRole('status')).toHaveTextContent(/not a valid|corrupt|archive/i);
});
