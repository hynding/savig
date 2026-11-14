/**
 * Bone springs (spec 2026-11-14-bone-springs): on the Waving arm template, giving the Hand bone a
 * spring in the Inspector makes the palm swing behind the IK-keyed motion (its position differs
 * at some playhead times), and one undo removes it.
 */
import { expect, test } from '@playwright/test';

test('a spring on the hand bone adds follow-through; undo removes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New from template' }).click();
  const gallery = page.getByRole('dialog', { name: 'Template gallery' });
  await gallery.getByText('Waving arm', { exact: true }).click();
  await expect(gallery).toBeHidden();
  await page.getByRole('button', { name: 'Pause' }).click();

  const ruler = page.getByTestId('timeline-ruler');
  const palm = page.locator('section[aria-label="Stage"] [data-savig-object="palm"]');
  const xs = [30, 60, 90, 120, 150, 180, 210, 240];
  const centres = async () => {
    const out: Array<{ x: number; y: number }> = [];
    for (const x of xs) {
      await ruler.click({ position: { x, y: 5 } });
      const b = (await palm.boundingBox())!;
      out.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    }
    return out;
  };
  const before = await centres();

  await page.locator('[aria-label="Layers"]').getByText('Hand', { exact: true }).click();
  const spring = page.getByTestId('inspector-bone-spring');
  await spring.getByLabel('Spring strength').fill('25');
  await spring.getByLabel('Spring strength').press('Enter');
  await expect(spring.getByLabel('Spring damping')).toBeVisible();
  await spring.getByLabel('Spring damping').fill('10');
  await spring.getByLabel('Spring damping').press('Enter');

  const after = await centres();
  const moved = after.map((c, i) => Math.hypot(c.x - before[i].x, c.y - before[i].y));
  expect(Math.max(...moved)).toBeGreaterThan(2);

  // Undo back past the spring (the fields may commit on Enter and on blur): the hand is back on its keys.
  const strength = spring.getByLabel('Spring strength');
  for (let i = 0; i < 4 && (await strength.inputValue()) !== '0'; i++) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
  }
  await expect(strength).toHaveValue('0');
  const undone = await centres();
  undone.forEach((c, i) => expect(Math.hypot(c.x - before[i].x, c.y - before[i].y)).toBeLessThan(0.5));
});
