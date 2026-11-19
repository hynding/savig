import { test, expect } from '@playwright/test';

/** Library folders (roadmap 11): make a folder, rename it, drag an imported SVG into it, collapse
 *  and expand it, undo/redo the move, and delete the folder without losing its contents. */
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c00"/></svg>';

test('organize the library into folders by dragging items in', async ({ page }) => {
  await page.goto('/');
  const assets = page.locator('section[aria-label="Assets"]');
  await assets.getByLabel('Import SVG').setInputFiles({ name: 'tree.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await assets.getByLabel('Import SVG').setInputFiles({ name: 'rock.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg.replace('#c00', '#0c0')) });
  const tree = assets.getByRole('button', { name: 'tree.svg', exact: true });
  await expect(tree).toBeVisible();

  await assets.getByRole('button', { name: '+ New Folder' }).click();
  await assets.getByRole('button', { name: 'Rename Folder', exact: true }).click();
  await assets.getByLabel('Folder name').fill('Props');
  await assets.getByLabel('Folder name').press('Enter');
  const folder = assets.locator('[data-testid^="folder-toggle-"]');
  await expect(folder).toHaveText(/Props \(0\)/);

  await tree.dragTo(folder);
  await expect(folder).toHaveText(/Props \(1\)/);
  // The item now sits inside the folder's children.
  await expect(assets.locator('[data-testid^="folder-"]').first().getByRole('button', { name: 'tree.svg', exact: true })).toBeVisible();

  // Collapse hides it, expand shows it again; rock.svg stays at the root throughout.
  await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await expect(assets.getByRole('button', { name: 'tree.svg', exact: true })).toHaveCount(0);
  await expect(assets.getByRole('button', { name: 'rock.svg', exact: true })).toBeVisible();
  await folder.click();
  await expect(assets.getByRole('button', { name: 'tree.svg', exact: true })).toBeVisible();

  // Undo puts the item back at the root; redo files it again.
  await page.locator('section[aria-label="Stage"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(folder).toHaveText(/Props \(0\)/);
  await page.keyboard.press('Control+Shift+z');
  await expect(folder).toHaveText(/Props \(1\)/);

  // Clicking a filed SVG still places it on the Stage.
  await assets.getByRole('button', { name: 'tree.svg', exact: true }).click();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Deleting the folder keeps its contents (they move to the root).
  await assets.getByRole('button', { name: 'Delete folder Props' }).click();
  await expect(folder).toHaveCount(0);
  await expect(assets.getByRole('button', { name: 'tree.svg', exact: true })).toBeVisible();
});
