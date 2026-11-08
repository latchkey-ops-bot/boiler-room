import { expect, test } from '@playwright/test';

test('the landing page sells one thing, with one field', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Give us a URL. Get your launch video.',
  );
  await expect(page.getByLabel("Your product's URL").first()).toBeVisible();
  // The marketing site draws its pixel at 3px.
  const pixel = await page
    .locator('.surface-marketing')
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--br-px').trim());
  expect(pixel).toBe('3px');
  // No sideways scroll, down to a 390px phone.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});

test('the URL field sends a signed-out founder to sign in, then back to the new video', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel("Your product's URL").first().fill('nova.com');
  await page.getByRole('button', { name: 'Fire it up' }).first().click();
  await page.waitForURL(/\/sign-in/);
  const redirect = new URL(page.url()).searchParams.get('redirect_url') ?? '';
  expect(redirect).toContain('/films/new?url=nova.com');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('the showcase renders', async ({ page }) => {
  await page.goto('/showcase');
  await expect(page.getByRole('heading', { name: 'Fresh out of the boiler room' })).toBeVisible();
});

test('app pages need a signed-in founder', async ({ page }) => {
  await page.goto('/films');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('the API refuses a signed-out caller', async ({ request }) => {
  const response = await request.get('/api/films');
  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe('unauthorized');
});

test('the film page and the launch plan need a signed-in founder', async ({ page, request }) => {
  await page.goto('/films/flm_00000000000000000000');
  await expect(page).toHaveURL(/\/sign-in/);
  const response = await request.put('/api/films/flm_00000000000000000000/launch', {
    data: { date: null, channels: [] },
  });
  expect(response.status()).toBe(401);
});

test('health answers with the database up', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, db: 'ok' });
});
