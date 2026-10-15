import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

/* The report page and its archived editions load cleanly, with the metadata that link previews use. */

const REPO = path.resolve(__dirname, '..', '..');
const EDITIONS = readdirSync(path.join(REPO, 'editions'))
  .filter(d => existsSync(path.join(REPO, 'editions', d, 'index.html')))
  .sort();

test('report loads with no console errors and no failed requests', async ({ page, issues }) => {
  await page.goto('/state-of-voice-agents/');
  await expect(page.locator('h1')).toBeVisible();
  // Scroll to the end so lazy parts (utterances comments) load too
  await page.locator('#about').scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  expect(issues.console, 'console errors').toEqual([]);
  expect(issues.failed, 'failed requests').toEqual([]);
});

test('title, description, canonical and Open Graph tags', async ({ page, request }) => {
  await page.goto('/state-of-voice-agents/');
  await expect(page).toHaveTitle('Voice Agents at the Front Door');
  const meta = (sel: string) => page.locator(sel).getAttribute('content');
  expect(await meta('meta[name="description"]')).toMatch(/voice agents/i);
  expect(await meta('meta[name="author"]')).toBe('Madhav Srinivasan');
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://sbmadhav.com/state-of-voice-agents/');
  expect(await meta('meta[property="og:title"]')).toMatch(/Voice Agents at the Front Door/);
  expect(await meta('meta[property="og:description"]')).toBeTruthy();
  expect(await meta('meta[property="og:url"]')).toBe('https://sbmadhav.com/state-of-voice-agents/');
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
  const og = await meta('meta[property="og:image"]');
  expect(og).toBe('https://sbmadhav.com/state-of-voice-agents/og.png');
  // The og image is checked on the same host the suite targets
  const r = await request.get(new URL(og!).pathname);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^image\/png/);
  const png = await r.body();
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  // Declared size matches the file (PNG IHDR width and height)
  expect(png.readUInt32BE(16)).toBe(+(await meta('meta[property="og:image:width"]'))!);
  expect(png.readUInt32BE(20)).toBe(+(await meta('meta[property="og:image:height"]'))!);
});

test('edition badge and research cutoff are shown', async ({ page }) => {
  await page.goto('/state-of-voice-agents/');
  await expect(page.locator('footer')).toContainText(/October 2026 edition/);
  await expect(page.locator('footer')).toContainText(/Research cutoff/);
});

for (const ed of EDITIONS) {
  test(`edition ${ed} loads cleanly`, async ({ page, issues, request }) => {
    await page.goto(`/state-of-voice-agents/editions/${ed}/`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#src li').first()).toBeAttached();
    await expect(page.locator('#exploreBtn')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(issues.console, 'console errors').toEqual([]);
    expect(issues.failed, 'failed requests').toEqual([]);
    expect((await request.get(`/state-of-voice-agents/editions/${ed}/og.png`)).status()).toBe(200);
  });
}
