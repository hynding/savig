import { test, expect } from '@playwright/test';

/** M10 cloud journey against a STUBBED Supabase (spec §10): the dev server runs with dummy env
 *  vars pointing at https://stub.supabase.test (playwright.config.ts); every request to that host
 *  is intercepted here. A pre-seeded localStorage session makes the app boot signed-in. No live
 *  Supabase anywhere.
 *
 *  Storage-key + boot findings (task-7-report.md has the full trail; recorded here for the
 *  reader of the test): supabase-js derives the session storage key from the URL's first host
 *  label — `sb-${new URL(url).hostname.split('.')[0]}-auth-token` — so for
 *  https://stub.supabase.test that's `sb-stub-auth-token`. A session is considered valid by
 *  auth-js as long as it has `access_token` / `refresh_token` / `expires_at`; boot
 *  (`_recoverAndRefresh` / `getSession()`) hits the network ONLY when the token is within its
 *  90s expiry margin (none here — `expires_at` is an hour out) or when `session.user` is a
 *  "not available" proxy (never, since we seed a real `user` object) — so signed-in boot with
 *  this shape makes ZERO requests to /auth/v1. The one real /auth/v1 hit in the journey below is
 *  `client.auth.getUser()`, called internally by the storage adapter's `listBinaryIds()` (used on
 *  Delete) before it lists the project's audio-binary prefix. */
const HOST = 'https://stub.supabase.test';

const row = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'u-1',
  name: 'Cloud Short',
  data: null as unknown, // filled per-test with a real project JSON captured from the app
  schema_version: 9,
  created_at: '2026-09-14T00:00:00Z',
  updated_at: '2026-09-14T00:00:00Z',
  ...over,
});

test('cloud: signed-in save → list → open → delete against stubbed endpoints', async ({ page }) => {
  const saved: unknown[] = [];
  // The Delete flow ends in a native window.confirm() (CloudDialog.tsx); Playwright auto-dismisses
  // unhandled dialogs, which would silently abort the delete. Accept every dialog for this test.
  page.on('dialog', (d) => void d.accept());

  await page.route(`${HOST}/auth/v1/**`, (r) =>
    r.fulfill({ json: { id: 'u-1', email: 'e2e@savig.test', aud: 'authenticated', role: 'authenticated' } }),
  );
  await page.route(`${HOST}/rest/v1/projects**`, async (r) => {
    const m = r.request().method();
    if (m === 'POST') {
      const posted = r.request().postDataJSON() as { data: unknown };
      saved.push(posted);
      // `.insert(row).select().single()` sets Accept: application/vnd.pgrst.object+json — real
      // PostgREST answers with the bare row object (not an array) for that Accept header;
      // postgrest-js does NOT unwrap arrays for `.single()` (only `.maybeSingle()` does that
      // client-side — checked node_modules/@supabase/postgrest-js PostgrestBuilder.ts). Returning
      // an array here would silently break saveCloudProject's `row.id` / `row.updated_at` reads.
      return r.fulfill({ json: row({ data: posted.data }) });
    }
    if (m === 'GET') return r.fulfill({ json: saved.length ? [row({ data: (saved[0] as { data: unknown }).data })] : [] });
    if (m === 'DELETE') {
      saved.length = 0;
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ json: [] });
  });
  await page.route(`${HOST}/storage/v1/**`, (r) => {
    const m = r.request().method();
    if (r.request().url().includes('/object/list/')) return r.fulfill({ json: [] });
    return r.fulfill({ json: m === 'POST' ? { Key: 'ok' } : [] });
  });
  await page.addInitScript(() => {
    // Seed a persisted session so the app boots signed-in (key + shape verified against
    // node_modules/@supabase/supabase-js + @supabase/auth-js source — see the file-header note).
    const session = {
      access_token: 'stub-access',
      refresh_token: 'stub-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u-1', email: 'e2e@savig.test', aud: 'authenticated' },
    };
    window.localStorage.setItem('sb-stub-auth-token', JSON.stringify(session));
  });
  await page.goto('/');

  // Draw something so the saved project is non-trivial.
  const stage = page.locator('section[aria-label="Stage"]');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const box = (await stage.locator('svg').first().boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select', exact: true }).click();

  // Save to Cloud via the palette (gesture + selectors verified against command-palette.spec.ts).
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByLabel('Command search').fill('Save to Cloud');
  await palette.getByLabel('Command search').press('Enter');
  await expect.poll(() => saved.length).toBeGreaterThan(0);

  // Open the Cloud dialog: the saved project lists; open it back.
  await page.getByRole('button', { name: 'Cloud account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cloud projects' });
  await expect(dialog.getByText('Cloud Short').or(dialog.getByText(/Untitled|Short/))).toBeVisible();
  await dialog.getByRole('button', { name: 'Open', exact: true }).first().click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1); // rect came back from the "cloud"

  // Delete it.
  await page.getByRole('button', { name: 'Cloud account' }).click();
  await dialog.getByRole('button', { name: /Delete/ }).first().click();
  await expect.poll(() => saved.length).toBe(0);
});

test('signed-out dialog shows the sign-in panel with the PKCE caveat', async ({ page }) => {
  // (True env-gating — cloud UI absent without env vars — is unit-covered in Task 4; the e2e
  // server always runs WITH the dummy vars, so here we cover the signed-out UI instead.)
  await page.route(`${HOST}/**`, (r) => r.fulfill({ json: {} }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Cloud account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cloud projects' });
  await expect(dialog.getByLabel('Email for magic link')).toBeVisible();
  await expect(dialog.getByText(/same browser/i)).toBeVisible();
});
