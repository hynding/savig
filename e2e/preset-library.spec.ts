import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const drawRect = async (page: import('@playwright/test').Page, x: number, y: number) => {
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 60, box.y + y + 40);
  await page.mouse.up();
};

test('a saved preset shows up in a new project after a reload, and packs export and import', async ({ page }, info) => {
  // Force the download fallback (no File System Access picker) so Playwright sees the file.
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto('/');
  await drawRect(page, 150, 60);
  const rot = page.getByLabel('rotation', { exact: true });
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await rot.fill('5');
  await rot.press('Enter');
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await rot.fill('35');
  await rot.press('Enter');
  await page.getByTestId('presets-toggle').click();
  await page.getByLabel('New preset name').fill('Lean');
  await page.getByTestId('preset-save').click();
  const mine = page.getByRole('group', { name: 'My presets' });
  await expect(mine.getByRole('button', { name: 'Lean', exact: true })).toBeVisible();

  // Export the library as a pack file.
  const download = page.waitForEvent('download');
  await page.getByTestId('preset-export-pack').click();
  const file = info.outputPath('savig-presets.json');
  await (await download).saveAs(file);
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  expect(pack).toMatchObject({ format: 'savig-preset-pack', presets: [expect.objectContaining({ name: 'Lean' })] });

  // A fresh page (new project) still lists it: the library lives in the browser, not the project.
  await page.evaluate(() => indexedDB.deleteDatabase('savig-autosave'));
  await page.reload();
  await expect(page.getByText('Lean')).toHaveCount(0); // panel closed
  await page.getByTestId('presets-toggle').click();
  await expect(mine.getByRole('button', { name: 'Lean', exact: true })).toBeVisible();

  // Delete it, then bring it back by importing the pack.
  await mine.getByRole('button', { name: 'Delete Lean' }).click();
  await expect(mine.getByRole('button', { name: 'Lean', exact: true })).toHaveCount(0);
  await page.getByTestId('preset-import-input').setInputFiles(file);
  await expect(mine.getByRole('button', { name: 'Lean', exact: true })).toBeVisible();
});
