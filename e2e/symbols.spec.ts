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

test('the Symbol timing panel toggles loop on an instance (slice 47c)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  // Draw a rect -> Create Symbol -> one instance (selected).
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d'); // a second instance shares the symbol
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);

  // The selected instance shows the Symbol timing panel; toggling loop persists.
  const loop = page.getByTestId('symbol-loop');
  await expect(loop).toBeVisible();
  await expect(loop).not.toBeChecked();
  await loop.check();
  await expect(loop).toBeChecked();
});

test('place a second instance of a symbol from the library (slice 47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(1);

  const symbolsSection = page.getByTestId('symbols-section');
  await expect(symbolsSection).toBeVisible();
  await symbolsSection.getByRole('button').first().click();
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});

test('delete an internal part inside a symbol — both instances lose it (author-in-symbol delete)', async ({
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

  await drawRect(120, 100, 170, 150);
  await drawRect(220, 100, 270, 150);
  await page.locator('[data-savig-object]').nth(0).click();
  await page.locator('[data-savig-object]').nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4); // 2 instances x 2 parts

  await page.locator('[data-savig-object*="/"]').last().dblclick(); // topmost leaf (avoids an obscured target)
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  await page.keyboard.press('Delete');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part
});

test('draw a NEW rectangle inside a symbol — every instance gains it (author-in-symbol draw)', async ({
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

  await drawRect(120, 100, 170, 150);
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part

  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await drawRect(40, 40, 90, 90); // draw a second part inside the symbol scene

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4); // 2 instances x 2 parts
});

test('node-edit a path inside a symbol — the node tool is usable in edit mode (author-in-symbol node-edit)', async ({
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

  // Draw a FILLED rect (easy to double-click) -> Create Symbol -> duplicate -> two instances.
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);

  // Enter the symbol; draw a PATH (polygon) inside — it auto-selects and lands on the node tool
  // (phase 3), so the node overlay renders for the in-symbol path without a fragile click.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await tools.getByRole('button', { name: 'Polygon', exact: true }).click();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 110);
  await page.mouse.up();
  await expect(page.getByTestId('node-overlay')).toBeVisible(); // node tool active + overlay for the in-symbol path

  // Exit; each instance now has TWO parts (rect + polygon) -> 4 composite leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4);
});

test('recolor a part inside a symbol — both instances render the new fill (author-in-symbol paint)', async ({
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

  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);

  // Enter the symbol, select the internal rect, set its fill via the Inspector.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  const fill = page.locator('#insp-fill'); // the solid-fill color input (aria-label "fill")
  await fill.fill('#ff0000');
  await fill.blur();

  // Exit; both instances now render the recolored part.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
  const leafFill = await page.locator('[data-savig-object*="/"] rect').first().getAttribute('fill');
  expect(leafFill).toBe('#ff0000');
});
