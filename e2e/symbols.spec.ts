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

test('the Symbol timing panel toggles ping-pong on an instance (slice 47c)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  // Draw a rect -> Create Symbol (the single instance stays selected).
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // The Symbol timing panel exposes a ping-pong checkbox; toggling it persists.
  const pingpong = page.getByTestId('symbol-pingpong');
  await expect(pingpong).toBeVisible();
  await expect(pingpong).not.toBeChecked();
  await pingpong.check();
  await expect(pingpong).toBeChecked();
  await pingpong.uncheck(); // the false path round-trips (field cleared, checkbox unchecked)
  await expect(pingpong).not.toBeChecked();
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

test('hide an internal part via the Layers panel inside a symbol — every instance loses it (author-in-symbol layers)', async ({
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

  // Enter the symbol; hide one internal part via its Layers row visibility toggle.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  const layers = page.locator('[aria-label="Layers"]');
  await layers.getByRole('button', { name: /visibility/i }).first().click();

  // Exit; the hidden part is gone from EVERY instance -> 2 instances x 1 visible part = 2 leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});

test('copy + paste an internal part inside a symbol — every instance gains it (author-in-symbol clipboard)', async ({
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

  // Enter the symbol, select the internal part, copy + paste it.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');

  // Exit; the symbol now has 2 parts -> 2 instances x 2 parts = 4 leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4);
});

test('union two parts inside a symbol — every instance renders one merged part (author-in-symbol boolean)', async ({
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

  // Two separate rects; union merges them into ONE result object (disjoint -> compoundRings).
  await drawRect(120, 100, 170, 150);
  await drawRect(220, 100, 270, 150);
  await page.locator('[data-savig-object]').nth(0).click();
  await page.locator('[data-savig-object]').nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4); // 2 instances x 2 parts

  // Enter the symbol, select both internal parts, Union them.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  const internal = page.locator('[data-savig-object]:not([data-savig-object*="/"])');
  await internal.nth(0).click();
  await internal.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Union', exact: true }).click();

  // Exit; the symbol now has ONE part -> 2 instances x 1 part = 2 leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});

test('draw a motion path inside a symbol — the tool is usable and the guide overlay appears (author-in-symbol motion)', async ({
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

  // Enter the symbol, select the internal part, draw a motion guide with the Motion Path tool.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  await tools.getByRole('button', { name: 'Motion Path', exact: true }).click();
  await page.mouse.click(box.x + 240, box.y + 220);
  await page.mouse.click(box.x + 320, box.y + 250);
  await page.mouse.dblclick(box.x + 400, box.y + 220);

  // The motion guide overlay renders for the selected internal object inside the symbol.
  await expect(page.getByTestId('motion-guide')).toBeVisible();
});

test('tune a morph inside a symbol — Suggest correspondence works in edit mode (author-in-symbol morph)', async ({
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

  // A filled rect to enter the symbol through (its leaf is clickable).
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part

  // Enter the symbol via a filled leaf, then draw a PATH inside (it stays selected after drawing).
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await tools.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.click(box.x + 240, box.y + 80);
  await page.mouse.click(box.x + 340, box.y + 120);
  await page.mouse.dblclick(box.x + 400, box.y + 80);

  // Author a 2-keyframe morph: add a shape keyframe, advance the playhead, drag a node.
  await page.getByRole('button', { name: /add shape keyframe/i }).click();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 60, nb.y + 60);
  await page.mouse.up();
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

  // Select the first shape keyframe and Suggest correspondence -> the summary appears.
  await page.locator('[data-testid^="shape-keyframe-"]').first().click();
  await page.getByRole('button', { name: 'Suggest correspondence' }).click();
  await expect(page.getByText(/suggested · \d+ nodes/)).toBeVisible();
});

test('delete a keyframe inside a symbol — the in-symbol Timeline op takes effect (in-symbol timeline keyframe editing)', async ({
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
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part

  // Enter the symbol, select the internal part, and create two scalar keyframes via autoKey moves
  // at two playhead times (the Timeline + autoKey are active-scene scoped).
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  const part = page.locator('[data-savig-object]:not([data-savig-object*="/"])').first();
  await part.click();
  await page.keyboard.press('ArrowRight'); // move at t=0 -> first keyframe
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } }); // advance the playhead
  await page.keyboard.press('ArrowRight'); // move again -> second keyframe
  const kfs = page.locator('[data-testid^="keyframe-"]');
  await expect(kfs).toHaveCount(2); // two scalar keyframes on the in-symbol Timeline

  // Select one keyframe and delete it -> the in-symbol remove takes effect.
  await kfs.first().click();
  await page.keyboard.press('Delete');
  await expect(kfs).toHaveCount(1);
});

test('a symbol shows a rendered thumbnail in the library (47d)', async ({ page }) => {
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
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // The new symbol's library row renders a thumbnail (an inline <svg>).
  const thumb = page.getByTestId('symbol-thumb').first();
  await expect(thumb).toBeVisible();
  await expect(thumb.locator('svg')).toHaveCount(1);
});

test('rename a symbol in the library (47d)', async ({ page }) => {
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
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // Rename the new symbol via its library row. Scope to the symbols section — the Layers panel
  // also renders a "Rename {name}" button for the instance object (same accessible name).
  const symbolsSection = page.getByTestId('symbols-section');
  await symbolsSection.getByRole('button', { name: /^Rename / }).first().click();
  const input = page.locator('[data-testid^="symbol-rename-"]').first();
  await input.fill('Hero');
  await input.press('Enter');
  await expect(symbolsSection).toContainText('Hero');
});

test('drag a symbol from the library onto the canvas places an instance (47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await stage.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(1); // 1 instance x 1 part

  // Drag the symbol's library row (the place button is the first button in the symbols section) onto
  // the canvas -> a second instance.
  await page.getByTestId('symbols-section').getByRole('button').first().dragTo(stage, { targetPosition: { x: 300, y: 220 } });
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});

test('rename an imported svg asset in the library (47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByLabel(/import svg/i).setInputFiles({
    name: 'box.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'),
  });
  await expect(page.getByText('box.svg')).toBeVisible();

  // Rename it via its row (no Layers objects exist, so this "Rename" is unambiguous).
  await page.getByRole('button', { name: 'Rename box.svg' }).click();
  const input = page.locator('[data-testid^="asset-rename-"]').first();
  await input.fill('Logo');
  await input.press('Enter');
  await expect(page.getByText('Logo')).toBeVisible();
});

test('set a symbol duration override from the Inspector (47c)', async ({ page }) => {
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
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click(); // selects the new instance

  // The Symbol timing panel exposes the symbol-duration field (aria-label "symbol duration"); set it.
  const field = page.getByLabel('symbol duration');
  await field.fill('2');
  await field.press('Enter');
  await expect(field).toHaveValue('2');
});

test('set a per-instance play count from the Inspector (47c)', async ({ page }) => {
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
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click(); // selects the new instance

  // The Symbol timing panel exposes the play-count field (aria-label "play count"); set it.
  const field = page.getByLabel('play count');
  await field.fill('3');
  await field.press('Enter');
  await expect(field).toHaveValue('3');
});

test('set a per-instance phase (random-start) from the Inspector (47c)', async ({ page }) => {
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
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click(); // selects the new instance

  // The Symbol timing panel exposes the phase field (aria-label "phase"); set it.
  const field = page.getByLabel('phase');
  await field.fill('3');
  await field.press('Enter');
  await expect(field).toHaveValue('3');
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
