import { test, expect, openExplore } from './fixtures';

/* The site-wide Explore menu, loaded from /assets/explore.js (sbmadhav.github.io repo).
   The "Install app" button is being reworked elsewhere and is not tested here. */

const PAGE = '/state-of-voice-agents/';
const REPO_URL = 'https://github.com/sbmadhav/state-of-voice-agents';

test('Explore opens with the button and closes with the close button, Esc and the backdrop', async ({ page }) => {
  await page.goto(PAGE);
  const btn = page.locator('#exploreBtn');
  await expect(btn).toHaveAttribute('aria-haspopup', 'dialog');

  let dlg = await openExplore(page);
  await dlg.getByRole('button', { name: 'Close menu' }).click();
  await expect(dlg).toBeHidden();

  dlg = await openExplore(page);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  dlg = await openExplore(page);
  // The backdrop: top-left corner is outside the panel on desktop (right drawer) and phones (bottom sheet)
  await page.mouse.click(5, 5);
  await expect(dlg).toBeHidden();
});

test('Explore marks this report as "You are here"', async ({ page }) => {
  await page.goto(PAGE);
  const dlg = await openExplore(page);
  const here = dlg.locator('a.xp-page[aria-current="page"]');
  await expect(here).toHaveCount(1);
  await expect(here).toHaveAttribute('href', PAGE);
  await expect(here).toContainText('Voice agents at the front door');
  expect(await here.evaluate(e => getComputedStyle(e, '::after').content)).toBe('"You are here"');
});

test('repo mark is hidden until hover and links to the state-of-voice-agents repo', async ({ page }) => {
  await page.goto(PAGE);
  const dlg = await openExplore(page);
  const row = dlg.locator('.xp-row', { has: page.locator(`a.xp-page[href="${PAGE}"]`) });
  const mark = row.locator('a.xp-repo');
  await expect(mark).toHaveAttribute('href', REPO_URL);
  await expect(mark).toHaveAttribute('target', '_blank');
  await expect(mark).toHaveAttribute('rel', /noopener/);

  const opacity = () => mark.evaluate(e => +getComputedStyle(e).opacity);
  if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
    // Touch devices cannot hover, so the mark stays faintly visible
    await expect.poll(opacity).toBeCloseTo(0.18, 2);
    return;
  }
  await page.mouse.move(2, 2);
  await expect.poll(opacity).toBe(0);
  await row.locator('a.xp-page').hover();
  await expect.poll(opacity).toBeCloseTo(0.5, 2);
});

test('Explore on an archived edition has no "You are here" (it is not a menu page)', async ({ page }) => {
  await page.goto(`${PAGE}editions/2026-10/`);
  const dlg = await openExplore(page);
  await expect(dlg.locator('a.xp-page[aria-current="page"]')).toHaveCount(0);
  await expect(dlg.locator(`a.xp-page[href="${PAGE}"]`)).toHaveCount(1);
});
