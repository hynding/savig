import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { CloudDialog } from './CloudDialog';
import { useEditor } from '../../store/store';
import * as services from '@savig/services';
import * as cloudActions from '../../cloud/cloudActions';

vi.mock('../../cloud/supabaseCloudStore', () => ({ getCloudStore: vi.fn(async () => ({}) as never) }));

vi.mock('@savig/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@savig/services')>()),
  listCloudProjects: vi.fn(async () => []),
}));

vi.mock('../../cloud/cloudActions', () => ({
  saveToCloudFlow: vi.fn(async () => {}),
  openCloudProjectFlow: vi.fn(async () => {}),
  deleteCloudProjectFlow: vi.fn(async () => {}),
  signInWithMagicLink: vi.fn(async () => {}),
  signInWithGitHub: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));

const listSpy = vi.mocked(services.listCloudProjects);
const saveSpy = vi.mocked(cloudActions.saveToCloudFlow);
const openSpy = vi.mocked(cloudActions.openCloudProjectFlow);
const deleteSpy = vi.mocked(cloudActions.deleteCloudProjectFlow);
const magicLinkSpy = vi.mocked(cloudActions.signInWithMagicLink);
const githubSpy = vi.mocked(cloudActions.signInWithGitHub);
const signOutSpy = vi.mocked(cloudActions.signOut);

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.getState().setCloudUser(null);
  listSpy.mockReset().mockResolvedValue([]);
  saveSpy.mockReset().mockResolvedValue(undefined);
  openSpy.mockReset().mockResolvedValue(undefined);
  deleteSpy.mockReset().mockResolvedValue(undefined);
  magicLinkSpy.mockReset().mockResolvedValue(undefined);
  githubSpy.mockReset().mockResolvedValue(undefined);
  signOutSpy.mockReset().mockResolvedValue(undefined);
});

describe('CloudDialog — signed out', () => {
  it('renders the email input, sign-in buttons, and the PKCE caveat', () => {
    render(<CloudDialog onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Cloud projects' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email for magic link')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
    expect(screen.getByText(/open the link in this same browser/i)).toBeInTheDocument();
  });

  it('Send magic link calls signInWithMagicLink with the typed email', async () => {
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Email for magic link'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() => expect(magicLinkSpy).toHaveBeenCalledWith('a@b.com'));
  });

  it('Sign in with GitHub calls signInWithGitHub', async () => {
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /sign in with github/i }));
    await waitFor(() => expect(githubSpy).toHaveBeenCalledOnce());
  });

  it('does not render the project list or save controls', () => {
    render(<CloudDialog onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /save current project as new/i })).not.toBeInTheDocument();
  });
});

describe('CloudDialog — signed in', () => {
  beforeEach(() => {
    useEditor.getState().setCloudUser({ id: 'u1', email: 'me@example.com' });
  });

  it('shows the account email and a Sign out button', async () => {
    render(<CloudDialog onClose={() => {}} />);
    expect(screen.getByText('me@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    await waitFor(() => expect(listSpy).toHaveBeenCalledOnce());
  });

  it('Sign out calls signOut', async () => {
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledOnce());
  });

  it('lists projects from listCloudProjects on open, with Open + Delete per row', async () => {
    listSpy.mockResolvedValue([
      { id: 'p1', name: 'First', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'p2', name: 'Second', updatedAt: '2026-02-02T00:00:00Z' },
    ]);
    render(<CloudDialog onClose={() => {}} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledOnce());
    const row1 = await screen.findByTestId('cloud-project-p1');
    expect(within(row1).getByText('First')).toBeInTheDocument();
    const row2 = screen.getByTestId('cloud-project-p2');
    expect(within(row2).getByText('Second')).toBeInTheDocument();

    fireEvent.click(within(row1).getByRole('button', { name: /open/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('p1'));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(row2).getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('p2'));
  });

  it('Delete asks for confirmation and does nothing when declined', async () => {
    listSpy.mockResolvedValue([{ id: 'p1', name: 'First', updatedAt: '2026-01-01T00:00:00Z' }]);
    render(<CloudDialog onClose={() => {}} />);
    const row = await screen.findByTestId('cloud-project-p1');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(row).getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('"Save current project as new" calls saveToCloudFlow with saveAsNew: true', async () => {
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /save current project as new/i }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledOnce());
    expect(saveSpy.mock.calls[0][0]).toMatchObject({ saveAsNew: true });
  });

  it('Save calls saveToCloudFlow without saveAsNew', async () => {
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledOnce());
    expect(saveSpy.mock.calls[0][0]?.saveAsNew).toBeFalsy();
  });

  it('a conflict from Save shows the conflict bar with Overwrite / Open cloud copy / Cancel', async () => {
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockImplementation(async (opts) => {
      opts?.onConflict?.('server-ts');
    });
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const bar = await screen.findByTestId('cloud-conflict-bar');
    expect(within(bar).getByRole('button', { name: /overwrite/i })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /open cloud copy/i })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: /overwrite/i }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect(saveSpy.mock.calls[1][0]).toMatchObject({ overwriteWith: 'server-ts' });
  });

  it('conflict bar: "Open cloud copy" opens the currently-linked cloud project', async () => {
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockImplementation(async (opts) => {
      opts?.onConflict?.('server-ts');
    });
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const bar = await screen.findByTestId('cloud-conflict-bar');
    fireEvent.click(within(bar).getByRole('button', { name: /open cloud copy/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('p1'));
  });

  it('conflict bar: Cancel dismisses the bar', async () => {
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockImplementation(async (opts) => {
      opts?.onConflict?.('server-ts');
    });
    render(<CloudDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const bar = await screen.findByTestId('cloud-conflict-bar');
    fireEvent.click(within(bar).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByTestId('cloud-conflict-bar')).not.toBeInTheDocument());
  });
});

describe('CloudDialog — overlay conventions', () => {
  it('Escape closes the dialog', () => {
    const onClose = vi.fn();
    render(<CloudDialog onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('the Close button closes the dialog', () => {
    const onClose = vi.fn();
    render(<CloudDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses the dialog on mount', () => {
    render(<CloudDialog onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });
});
