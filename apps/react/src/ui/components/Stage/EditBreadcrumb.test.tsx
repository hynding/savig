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
