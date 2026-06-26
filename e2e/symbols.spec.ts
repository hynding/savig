import { test, expect } from '@playwright/test';

test('create a symbol from two shapes: the instance renders its internals as composite-id leaves', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await drawRect(120, 100, 200, 170); // A
  await drawRect(380, 280, 460, 350); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const a = objects.nth(0);
  const b = objects.nth(1);

  // Select both, then Create Symbol via the Inspector.
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // The two top-level rects are now ONE instance expanded into two composite-id leaves
  // ("instId/rectId"). The flat scene still shows two drawn nodes, both namespaced.
  await expect(objects).toHaveCount(2);
  const composite = page.locator('[data-savig-object*="/"]');
  await expect(composite).toHaveCount(2);

  // Clicking an internal leaf selects the owning instance atomically: the Inspector shows the
  // single-object panel for the instance (no multi-select "objects selected" row).
  await composite.first().click();
  await expect(page.getByText(/objects selected/)).toHaveCount(0);
});

test('a selected symbol instance shows transform handles and scales its internals', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await drawRect(120, 100, 200, 170);
  await drawRect(240, 120, 320, 190);

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // Select the instance (click an internal leaf — atomic selection routes to the instance).
  const composite = page.locator('[data-savig-object*="/"]');
  await expect(composite).toHaveCount(2);
  await composite.first().click();

  // The instance now shows the container transform handles (slice 47b).
  await expect(page.getByTestId('group-handles')).toBeVisible();
  await expect(page.getByTestId('group-rotate-handle')).toBeVisible();

  // Drag the SE handle outward (auto-key is on by default) and confirm a leaf grew.
  const beforeBox = (await composite.first().boundingBox())!;
  const se = page.getByTestId('group-handle-se');
  const seBox = (await se.boundingBox())!;
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + 120, seBox.y + 120);
  await page.mouse.up();
  const afterBox = (await composite.first().boundingBox())!;
  expect(afterBox.width).toBeGreaterThan(beforeBox.width + 1);
});

test('edit a symbol in place: enter, move an internal part, both instances update, exit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // One shape -> Create Symbol -> one instance; duplicate -> two instances (shared asset).
  await drawRect(120, 100, 180, 160);
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  const composites = page.locator('[data-savig-object*="/"]'); // instance leaves (composite ids)
  await expect(composites).toHaveCount(2);
  const beforeBox = (await composites.first().boundingBox())!; // measure the OTHER instance (propagation proof)

  // Enter the symbol by double-clicking the topmost instance leaf; breadcrumb appears, scene scopes.
  await composites.last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  const internal = page.locator('[data-savig-object]:not([data-savig-object*="/"])').first();
  await expect(internal).toBeVisible(); // the symbol's single internal part (un-prefixed id)

  // Move the internal part right; on exit BOTH instances reflect it (edit-propagation).
  await internal.click();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(composites).toHaveCount(2);
  const afterBox = (await composites.first().boundingBox())!;
  expect(afterBox.x).toBeGreaterThan(beforeBox.x);
});
