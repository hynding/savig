import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetPanel } from './AssetPanel';
import { ToastHost } from '../Toast/Toast';
import { useEditor } from '../../store/store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';

beforeEach(() => useEditor.getState().newProject());

const svgText =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

it('imports an SVG file and lists it', async () => {
  render(<AssetPanel />);
  const file = new File([svgText], 'box.svg', { type: 'image/svg+xml' });
  await userEvent.upload(screen.getByLabelText(/import svg/i), file);
  expect(await screen.findByText('box.svg')).toBeInTheDocument();
  expect(useEditor.getState().history.present.assets).toHaveLength(1);
});

it('clicking a listed SVG asset adds an instance to the stage', async () => {
  useEditor.getState().addAsset({
    id: 'a', kind: 'svg', name: 'box.svg', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10,
  });
  render(<AssetPanel />);
  await userEvent.click(screen.getByTestId('asset-a')); // the place button (rename/delete buttons also match the name now)
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
});

it('shows a toast on malformed SVG import', async () => {
  render(
    <>
      <AssetPanel />
      <ToastHost />
    </>,
  );
  const bad = new File(['not svg'], 'bad.svg', { type: 'image/svg+xml' });
  await userEvent.upload(screen.getByLabelText(/import svg/i), bad);
  expect(await screen.findByRole('status')).toHaveTextContent(/bad\.svg/i);
});

it('lists symbols with an instance count and places one on click (slice 47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  const btn = screen.getByTestId('symbol-sym');
  expect(btn).toHaveTextContent('Star (1)');
  await userEvent.click(btn);
  expect(useEditor.getState().history.present.objects.filter((o) => o.assetId === 'sym')).toHaveLength(2);
});

it('disables a symbol row that would create a cycle in edit mode (slice 47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Self', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.enterSymbol('sym'); });
  render(<AssetPanel />);
  expect(screen.getByTestId('symbol-sym')).toBeDisabled();
});

it('renders a thumbnail for a symbol with drawable content (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const pathAsset = createVectorAsset('path', {
    id: 'pa-asset',
    path: { closed: true, nodes: [{ anchor: { x: 100, y: 100 } }, { anchor: { x: 110, y: 100 } }, { anchor: { x: 110, y: 110 } }, { anchor: { x: 100, y: 110 } }] },
  });
  const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('pa-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [pathAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  const thumb = screen.getByTestId('symbol-thumb');
  // Rendered as a data-URI <img>, not inlined markup: no thumbnail SVG ids ever enter the document.
  expect(thumb.tagName.toLowerCase()).toBe('img');
  expect(thumb.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  expect(screen.getByTestId('symbol-sym')).toHaveTextContent('Star (1)');
});

it('renders a placeholder thumbnail for an empty symbol (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const sym = createSymbolAsset({ id: 'sym', name: 'Empty', objects: [], width: 0, height: 0 });
  const p = createProject();
  p.assets = [sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  expect(screen.getByTestId('symbol-thumb-empty')).toBeInTheDocument();
});

it('renames a symbol via the library (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  await userEvent.click(screen.getByLabelText('Rename Symbol'));
  const input = screen.getByTestId('symbol-rename-sym');
  await userEvent.clear(input);
  await userEvent.type(input, 'Hero{Enter}');
  expect(useEditor.getState().history.present.assets.find((a) => a.id === 'sym')!.name).toBe('Hero');
});

it('deletes a 0-instance symbol via the library; an in-use one is blocked (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  await userEvent.click(screen.getByLabelText('Delete Symbol'));
  expect(screen.getByTestId('symbol-sym')).toBeInTheDocument();
  act(() => { s.commit({ ...useEditor.getState().history.present, objects: [] }); });
  await userEvent.click(screen.getByLabelText('Delete Symbol'));
  expect(screen.queryByTestId('symbol-sym')).not.toBeInTheDocument();
});

it('Escape cancels a symbol rename without committing (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  await userEvent.click(screen.getByLabelText('Rename Symbol'));
  const input = screen.getByTestId('symbol-rename-sym');
  await userEvent.clear(input);
  await userEvent.type(input, 'Hero{Escape}');
  expect(useEditor.getState().history.present.assets.find((a) => a.id === 'sym')!.name).toBe('Symbol'); // unchanged
  expect(screen.getByTestId('symbol-sym')).toBeInTheDocument(); // back to the place button
});

it('the symbol place button is a drag source (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  expect(screen.getByTestId('symbol-sym')).toHaveAttribute('draggable', 'true');
});

it('renames + deletes an svg library asset (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addAsset({ id: 'a', kind: 'svg', name: 'box.svg', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  render(<AssetPanel />);
  await userEvent.click(screen.getByLabelText('Rename box.svg'));
  const input = screen.getByTestId('asset-rename-a');
  await userEvent.clear(input);
  await userEvent.type(input, 'Logo{Enter}');
  expect(useEditor.getState().history.present.assets.find((x) => x.id === 'a')!.name).toBe('Logo');
  await userEvent.click(screen.getByLabelText('Delete Logo'));
  expect(screen.queryByTestId('asset-a')).not.toBeInTheDocument();
});

it('a per-shape vector asset is not listed in the library (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addAsset(createVectorAsset('rect', { id: 'v', name: 'Rectangle', shapeType: 'rect' }));
  s.addAsset({ id: 'a', kind: 'svg', name: 'box.svg', normalizedContent: '<rect/>', viewBox: '0 0 10 10', width: 10, height: 10 });
  render(<AssetPanel />);
  expect(screen.queryByTestId('asset-v')).not.toBeInTheDocument(); // per-shape geometry, not a library item
  expect(screen.getByTestId('asset-a')).toBeInTheDocument(); // reusable svg still listed
});

it('clicking an audio row adds an audio clip while a sibling vector asset stays unlisted (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addAsset(createVectorAsset('rect', { id: 'v', name: 'Rectangle', shapeType: 'rect' }));
  s.addAsset({ id: 'snd', kind: 'audio', name: 'beep.wav', mimeType: 'audio/wav' });
  render(<AssetPanel />);
  expect(screen.queryByTestId('asset-v')).not.toBeInTheDocument();
  await userEvent.click(screen.getByTestId('asset-snd'));
  // the click routed to addAudioClip (an audio clip now references the audio asset), not a mis-route
  expect(useEditor.getState().history.present.audioClips.some((c) => c.assetId === 'snd')).toBe(true);
});

describe('library folders (roadmap 11)', () => {
  const addSvg = (id: string, name: string) =>
    useEditor.getState().addAsset({ id, kind: 'svg', name, normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  const present = () => useEditor.getState().history.present;
  /** A DataTransfer stand-in that fireEvent can carry (jsdom has none). */
  const dataTransfer = () => {
    const data: Record<string, string> = {};
    return {
      data,
      setData: (k: string, v: string) => void (data[k] = v),
      getData: (k: string) => data[k] ?? '',
      get types() { return Object.keys(data); },
      effectAllowed: 'all',
      dropEffect: 'none',
    };
  };

  it('New Folder adds a folder; rename, collapse and delete work from its row', async () => {
    addSvg('a', 'tree.svg');
    render(<AssetPanel />);
    await userEvent.click(screen.getByRole('button', { name: '+ New Folder' }));
    const folder = present().libraryFolders![0];
    expect(folder.name).toBe('Folder');
    await userEvent.click(screen.getByRole('button', { name: 'Rename Folder' }));
    const input = screen.getByLabelText('Folder name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Props{Enter}');
    expect(present().libraryFolders![0].name).toBe('Props');

    act(() => useEditor.getState().moveToLibraryFolder(['a'], folder.id));
    expect(screen.getByTestId('asset-a')).toBeInTheDocument(); // shown inside the open folder
    const toggle = screen.getByTestId(`folder-toggle-${folder.id}`);
    expect(toggle).toHaveTextContent('Props (1)');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('asset-a')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Delete folder Props' }));
    expect(present().libraryFolders).toBeUndefined();
    expect(screen.getByTestId('asset-a')).toBeInTheDocument(); // back at the root
  });

  it('dragging an item onto a folder files it; dropping on the library root takes it out', () => {
    addSvg('a', 'tree.svg');
    const f = useEditor.getState().createLibraryFolder('Props');
    render(<AssetPanel />);
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('asset-a'), { dataTransfer: dt });
    expect(dt.data['application/x-savig-library']).toBe('a');
    const folderRow = screen.getByTestId(`folder-toggle-${f}`).parentElement!;
    fireEvent.dragOver(folderRow, { dataTransfer: dt });
    fireEvent.drop(folderRow, { dataTransfer: dt });
    expect((present().assets[0] as { folderId?: string }).folderId).toBe(f);

    fireEvent.dragStart(screen.getByTestId('asset-a'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('library-root'), { dataTransfer: dt });
    expect('folderId' in present().assets[0]).toBe(false);
  });

  it('a nested folder is created from its parent row', async () => {
    const f = useEditor.getState().createLibraryFolder('Characters');
    render(<AssetPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'New folder in Characters' }));
    expect(present().libraryFolders!.find((x) => x.parentId === f)?.name).toBe('Folder');
    expect(screen.getByTestId(`folder-${f}`)).toHaveTextContent('Characters (0)');
  });
});
