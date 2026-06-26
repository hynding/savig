import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetPanel } from './AssetPanel';
import { ToastHost } from '../Toast/Toast';
import { useEditor } from '../../store/store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '../../../engine';

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
  await userEvent.click(screen.getByRole('button', { name: /box\.svg/i }));
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
  expect(screen.getByTestId('symbol-thumb')).toBeInTheDocument();
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
