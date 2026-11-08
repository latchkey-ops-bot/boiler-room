import { expect, test } from '@playwright/test';

test('the landing page sells one thing, with one field', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Give us a URL. Get your launch video.',
  );
  await expect(page.getByLabel("Your product's URL").first()).toBeVisible();
  // The sections, in order, ending on the call to action. The crew sits inside How it works, and
  // the showcase appears only once a real film is on it.
  for (const name of [
    'Four stops through the boiler room',
    "Cut for every place you'll post it",
    'No made-up stats. Ever.',
    'Launching soon? Fire up the boiler.',
  ]) {
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Your launch team, minus the hiring' })).toHaveCount(0);
  // The hero's frames say they are the sample customer's, not ours.
  await expect(page.locator('.hero-figure figcaption')).toContainText("nova.example.com's launch video");
  // The steam trail rises only from the crew at work in the hero, never from an idle Boyle.
  await expect(page.locator('.art .puff')).toHaveCount(2);
  await expect(page.locator('.cta-band .puff, .wall-empty .puff')).toHaveCount(0);
  // One verb for the one action, and a way back in for a returning founder.
  await expect(page.getByRole('button', { name: 'Get my video' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
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

test('the URL field sends a new founder to sign up, then on to the new video', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Your product's URL").first().fill('nova.com');
  await page.getByRole('button', { name: 'Get my video' }).first().click();
  await page.waitForURL(/\/sign-up/);
  const redirect = new URL(page.url()).searchParams.get('redirect_url') ?? '';
  expect(redirect).toContain('/films/new?url=nova.com');
  await expect(page.getByRole('heading', { name: 'Start your launch video' })).toBeVisible();
  // The site the founder typed is carried, not dropped.
  await expect(page.locator('.auth-page .carried')).toHaveText('nova.com');
});

test('a URL that is not a public website stays on the page, with the reason', async ({ page }) => {
  await page.goto('/');
  const field = page.getByLabel("Your product's URL").first();
  await field.fill('localhost:3000');
  await page.getByRole('button', { name: 'Get my video' }).first().click();
  await expect(page.getByText('Use the address without a port number.')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('without JavaScript, /start sends a bad URL back to the hero with the reason', async ({
  request,
}) => {
  const response = await request.get('/start?url=nova', { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/?url=nova#start');
});

test('the showcase renders real films only, or says none are up yet', async ({ page }) => {
  await page.goto('/showcase');
  await expect(page.getByRole('heading', { name: 'Fresh out of the boiler room' })).toBeVisible();
  const films = page.locator('.wall .launch');
  const empty = page.getByRole('heading', { name: 'The first launch videos are on their way' });
  await expect(films.first().or(empty)).toBeVisible();
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

test('delivery and settings need a signed-in founder, and so does asking for changes', async ({
  page,
  request,
}) => {
  await page.goto('/films/flm_00000000000000000000/deliverables');
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in/);
  const response = await request.post('/api/films/flm_00000000000000000000/revision', {
    data: { version: 1, note: 'Bigger logo' },
  });
  expect(response.status()).toBe(401);
});
