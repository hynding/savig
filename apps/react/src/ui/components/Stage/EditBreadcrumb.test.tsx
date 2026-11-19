import { render, screen, fireEvent, act } from '@testing-library/react';
import { EditBreadcrumb } from './EditBreadcrumb';
import { useEditor } from '../../store/store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';

it('renders nothing at root and the path with exit buttons in edit mode (slice 47 edit-mode)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a' })];
  act(() => { s.commit(p); });
  const { rerender } = render(<EditBreadcrumb />);
  expect(screen.queryByTestId('edit-breadcrumb')).not.toBeInTheDocument();
  act(() => { useEditor.getState().enterSymbol('sym'); });
  rerender(<EditBreadcrumb />);
  expect(screen.getByTestId('edit-breadcrumb')).toBeInTheDocument();
  expect(screen.getByText('Star')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Root' }));
  expect(useEditor.getState().editPath).toEqual([]);
});

it('shows the button state strip only inside a button symbol and sets the previewed state', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = { ...createSymbolAsset({ id: 'sym', name: 'Play', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 }), button: true };
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a' })];
  act(() => { s.commit(p); useEditor.getState().enterSymbol('sym'); });
  render(<EditBreadcrumb />);
  expect(screen.getByTestId('button-preview-all')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByTestId('button-preview-down'));
  expect(useEditor.getState().buttonPreviewState).toBe('down');
  expect(screen.getByTestId('button-preview-down')).toHaveAttribute('aria-pressed', 'true');
  act(() => { useEditor.getState().setSymbolButton('sym', false); });
  expect(screen.queryByTestId('button-state-strip')).toBeNull();
});
