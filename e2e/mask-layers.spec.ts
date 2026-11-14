import { test, expect } from '@playwright/test';

// Mask layers slice 2 (spec 2026-11-13): create a mask from a selection (Ctrl/⌘+Alt+M), see it in
// the Layers panel + Inspector, drag its Stage ghost to move the reveal, undo, and release.
test('create, move, undo and release a mask', async ({ page }) => {
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

  await drawRect(100, 150, 320, 300); // target (bottom)
  await drawRect(60, 110, 200, 260); // mask (top) — starts outside the target so it draws, not drags
  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const targetId = (await objects.nth(0).getAttribute('data-savig-object'))!;
  const maskId = (await objects.nth(1).getAttribute('data-savig-object'))!;

  // Select both (the mask is drawn last, so it is selected; Shift-add the target) and mask.
  await page.locator(`[data-savig-object="${targetId}"]`).click({ modifiers: ['Shift'], position: { x: 200, y: 120 } });
  await page.keyboard.press('Control+Alt+KeyM');

  const maskDef = page.locator(`mask[id="savig-mask-${maskId}"]`);
  await expect(maskDef).toHaveCount(1);
  await expect(maskDef.locator(`[data-savig-object="${maskId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid="mask-group-savig-mask-${maskId}"] [data-savig-object="${targetId}"]`)).toHaveCount(1);
  await expect(page.getByTestId(`mask-badge-${maskId}`)).toBeVisible();
  await expect(page.getByTestId(`masked-badge-${targetId}`)).toBeVisible();
  await expect(page.getByTestId('inspector-release-mask')).toBeVisible();

  // Drag the mask by its Stage ghost outline: the mask content (inside <mask>) moves.
  const maskNode = maskDef.locator(`[data-savig-object="${maskId}"]`);
  const before = await maskNode.getAttribute('transform');
  const ghost = (await page.getByTestId(`mask-ghost-${maskId}`).locator('path').first().boundingBox())!;
  // On the top edge, a quarter of the way along — clear of the selection's corner/edge handles.
  await page.mouse.move(ghost.x + ghost.width / 4, ghost.y);
  await page.mouse.down();
  await page.mouse.move(ghost.x + ghost.width / 4 + 60, ghost.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => maskNode.getAttribute('transform')).not.toBe(before);

  // Undo the move and the mask creation; redo the mask.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('mask')).toHaveCount(0);
  await expect(page.locator(`[data-savig-object="${maskId}"]`)).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(maskDef).toHaveCount(1);

  // Release from the Inspector: both objects draw normally again.
  await page.getByTestId(`mask-ghost-hit-${maskId}`).dispatchEvent('pointerdown');
  await page.getByTestId('inspector-release-mask').click();
  await expect(page.locator('mask')).toHaveCount(0);
  await expect(page.locator('[mask]')).toHaveCount(0);
  await expect(page.getByTestId(`mask-badge-${maskId}`)).toHaveCount(0);
});

// Mask modes (spec 2026-11-14-mask-modes): invert a mask and switch it to luminance from the
// Inspector; the Stage's mask defs and the Layers badge follow, and undo restores the alpha mask.
test('invert a mask and make it a luminance mask', async ({ page }) => {
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
  await drawRect(100, 150, 320, 300);
  await drawRect(60, 110, 200, 260);
  const objects = page.locator('[data-savig-object]');
  const targetId = (await objects.nth(0).getAttribute('data-savig-object'))!;
  const maskId = (await objects.nth(1).getAttribute('data-savig-object'))!;
  await page.locator(`[data-savig-object="${targetId}"]`).click({ modifiers: ['Shift'], position: { x: 200, y: 120 } });
  await page.keyboard.press('Control+Alt+KeyM');
  await expect(page.getByTestId('inspector-mask')).toContainText('reveals 1 object');

  // Rendered pixels at a spot inside the target only, and one under both target and mask.
  const pixel = async (x: number, y: number) => {
    const png = await svg.screenshot();
    return page.evaluate(
      async ([b64, x, y]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const scale = img.width / (document.querySelector('section[aria-label="Stage"] svg') as SVGSVGElement).getBoundingClientRect().width;
        return Array.from(ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data.slice(0, 3));
      },
      [png.toString('base64'), x, y] as const,
    );
  };
  const before = { outside: await pixel(280, 280), under: await pixel(150, 200) };
  expect(before.outside).not.toEqual(before.under);

  await page.getByRole('checkbox', { name: 'Invert mask' }).check();
  await expect(page.locator(`mask[id="savig-mask-${maskId}-src"] [data-savig-object="${maskId}"]`)).toHaveCount(1);
  await expect(page.locator(`mask[id="savig-mask-${maskId}"] rect[mask="url(#savig-mask-${maskId}-src)"]`)).toHaveCount(1);
  await expect(page.getByTestId(`mask-badge-${maskId}`)).toHaveText('Inverted mask');
  await expect(page.getByTestId('inspector-mask')).toContainText('hides 1 object');

  // Inverted: the two spots swap — the target shows outside the mask and hides under it.
  await expect.poll(() => pixel(280, 280)).toEqual(before.under);
  await expect.poll(() => pixel(150, 200)).toEqual(before.outside);

  await page.getByRole('combobox', { name: 'Mask type' }).selectOption('luminance');
  await expect(page.locator(`mask[id="savig-mask-${maskId}-src"]`)).toHaveAttribute('mask-type', 'luminance');
  await expect(page.getByTestId(`mask-badge-${maskId}`)).toHaveText('Inverted luma mask');

  // Undo shortcuts are ignored while a form control has focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator(`mask[id="savig-mask-${maskId}-src"]`)).toHaveCount(0);
  await expect(page.locator(`mask[id="savig-mask-${maskId}"]`)).toHaveAttribute('mask-type', 'alpha');
  await expect(page.getByTestId(`mask-badge-${maskId}`)).toHaveText('Mask');
});
