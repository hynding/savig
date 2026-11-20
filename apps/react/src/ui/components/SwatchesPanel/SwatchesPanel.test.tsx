import { fireEvent, render, screen } from '@testing-library/react';
import { SwatchesPanel } from './SwatchesPanel';
import { useEditor } from '../../store/store';
import type { VectorAsset } from '@savig/engine';

beforeEach(() => useEditor.getState().newProject());

const style = (objectId: string) => {
  const p = useEditor.getState().history.present;
  const o = p.objects.find((x) => x.id === objectId)!;
  return (p.assets.find((a) => a.id === o.assetId) as VectorAsset).style;
};

function rect(): string {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  return useEditor.getState().selectedObjectId!;
}

it('shows an empty hint, then adds a swatch from the selected fill', () => {
  render(<SwatchesPanel />);
  expect(screen.getByText(/No swatches yet/)).toBeTruthy();
  const id = rect();
  useEditor.getState().setVectorStyle({ fill: '#ff8800' });
  fireEvent.click(screen.getByTestId('swatch-add'));
  const sw = useEditor.getState().history.present.swatches![0];
  expect(sw.color).toBe('#ff8800');
  expect(screen.getByTestId(`swatch-${sw.id}`)).toBeTruthy();
  expect(screen.getByTestId('swatch-editor')).toBeTruthy();
  expect(style(id).fill).toBe('#ff8800');
});

it('clicking a swatch paints the target paint; shift-click paints the other one', () => {
  const id = rect();
  const sw = useEditor.getState().addSwatch('#123456');
  render(<SwatchesPanel />);
  fireEvent.click(screen.getByTestId(`swatch-${sw}`));
  expect(style(id).fill).toBe('#123456');
  fireEvent.click(screen.getByTestId(`swatch-${sw}`), { shiftKey: true });
  expect(style(id).stroke).toBe('#123456');
  fireEvent.click(screen.getByTestId('swatch-target-stroke'));
  useEditor.getState().setVectorStyle({ stroke: '#000000' });
  fireEvent.click(screen.getByTestId(`swatch-${sw}`));
  expect(style(id).stroke).toBe('#123456');
});

it('a global swatch recolors linked shapes from the editor and can be deleted', () => {
  const id = rect();
  const sw = useEditor.getState().addSwatch('#123456');
  render(<SwatchesPanel />);
  fireEvent.click(screen.getByTestId(`swatch-${sw}`)); // paints (plain) + opens the editor
  fireEvent.click(screen.getByTestId('swatch-global'));
  fireEvent.click(screen.getByTestId(`swatch-${sw}`)); // repaint now that it is global -> linked
  expect(screen.getByTestId('swatch-usage').textContent).toBe('1 linked');
  fireEvent.change(screen.getByTestId('swatch-color'), { target: { value: '#abcdef' } });
  expect(style(id).fill).toBe('#abcdef');
  fireEvent.change(screen.getByTestId('swatch-name'), { target: { value: 'Sky' } });
  fireEvent.blur(screen.getByTestId('swatch-name'));
  expect(useEditor.getState().history.present.swatches![0].name).toBe('Sky');
  fireEvent.click(screen.getByTestId('swatch-delete'));
  expect(useEditor.getState().history.present.swatches).toBeUndefined();
  expect(style(id).fill).toBe('#abcdef');
});
