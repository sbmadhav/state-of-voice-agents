import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openExplore } from './fixtures';

/* WCAG 2.1 AA checks axe cannot make, on the report and every archived edition: skip link (2.4.1),
   reflow at 320px (1.4.10), text spacing (1.4.12) and Pause motion (2.2.2). */

const REPO = path.resolve(__dirname, '..', '..');
const PAGES = ['/state-of-voice-agents/', ...readdirSync(path.join(REPO, 'editions'))
  .filter(d => existsSync(path.join(REPO, 'editions', d, 'index.html')))
  .map(d => `/state-of-voice-agents/editions/${d}/`)];
const SPACING = '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}';
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const looping = (page: Page) => page.evaluate(() => document.getAnimations()
  .filter(a => a.playState === 'running' && a.effect!.getTiming().iterations === Infinity).length);

for (const url of PAGES) {
  test(`${url}: skip link is the first stop and moves focus to the report`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari does not move focus to links with Tab by default');
    await page.goto(url);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test(`${url}: no horizontal scroll at 320px, with or without text spacing`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(url, { waitUntil: 'load' });
    expect(await sideways(page)).toBe(0);
    await page.addStyleTag({ content: SPACING });
    expect(await sideways(page)).toBe(0);
    // Chips wrap instead of running past the edge
    const wide = await page.locator('.chip').evaluateAll(cs => cs.filter(c => { const r = c.getBoundingClientRect(); return r.width && r.right > innerWidth; }).length);
    expect(wide).toBe(0);
  });
}

test.describe('Pause motion', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('the Explore menu switch stops the waveform, and it stays stopped after a reload', async ({ page }) => {
    await page.goto('/state-of-voice-agents/', { waitUntil: 'load' });
    await expect.poll(() => looping(page)).toBeGreaterThan(0);
    const dlg = await openExplore(page);
    await dlg.locator('#xpMotion').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveClass(/motion-paused/);
    expect(await looping(page)).toBe(0);
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('html')).toHaveClass(/motion-paused/);
    expect(await looping(page)).toBe(0);
  });
});
