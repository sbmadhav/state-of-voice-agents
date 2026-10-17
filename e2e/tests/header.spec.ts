import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

/* The shared sbmadhav.com header (design system 2.1.0, composed in at commit time with compose.py), the
   report's own section bar under it, and the pinned design system: self-hosted fonts, no Google Fonts. */

const REPO = path.resolve(__dirname, '..', '..');
const PAGES = ['/state-of-voice-agents/', ...readdirSync(path.join(REPO, 'editions'))
  .filter(d => existsSync(path.join(REPO, 'editions', d, 'index.html')))
  .map(d => `/state-of-voice-agents/editions/${d}/`)];

for (const url of PAGES) {
  test(`${url}: shared header with home link, Explore, theme button and Download PDF`, async ({ page }) => {
    await page.goto(url);
    const header = page.locator('header.md-header');
    await expect(header).toHaveCount(1);
    await expect(header.locator('a.md-brand')).toHaveAttribute('href', '/');
    await expect(header.locator('#exploreBtn.xp-btn')).toBeVisible();
    await expect(header.locator('#themeBtn.md-theme')).toBeVisible();
    await expect(header.locator('.md-header-end #pdf-open')).toBeVisible();
    // The old System / Light / Dark picker is gone: one theme control on every page
    await expect(page.locator('#theme')).toHaveCount(0);
    await expect(page.locator('.jump a[href="#sources"]')).toBeAttached();
  });

  test(`${url}: pinned design system and self-hosted fonts, no Google Fonts`, async ({ page }) => {
    const hosts: string[] = [];
    page.on('request', r => hosts.push(new URL(r.url()).host));
    await page.goto(url, { waitUntil: 'networkidle' });
    expect(hosts.filter(h => /fonts\.(googleapis|gstatic)\.com/.test(h))).toEqual([]);
    const sheets = await page.evaluate(() => [...document.styleSheets].map(s => s.href).filter(Boolean));
    expect(sheets).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/design-system\/v\/2\.1\.0\/tokens\.css$/),
      expect.stringMatching(/\/design-system\/v\/2\.1\.0\/components\.css$/),
    ]));
    // Subresource Integrity on the pinned files (a wrong hash would block them, and the sheets above would be missing)
    const pinned = await page.evaluate(() => [...document.querySelectorAll('link[href*="/design-system/v/"], script[src*="/design-system/v/"]')]
      .map(e => [e.getAttribute('integrity')?.slice(0, 7), e.getAttribute('crossorigin')]));
    expect(pinned).toEqual([['sha384-', 'anonymous'], ['sha384-', 'anonymous'], ['sha384-', 'anonymous']]);
    expect(await page.evaluate(() => typeof (window as any).siteTheme?.get)).toBe('function'); // header.js ran
    // The self-hosted face is registered (tokens.css) and actually loads: fonts.check() alone is true when no face matches
    const nunito = await page.evaluate(async () => {
      const loaded = await document.fonts.load('16px "Nunito Sans"');
      await document.fonts.ready;
      const faces = [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Nunito Sans');
      return { loaded: loaded.map(f => f.family.replace(/"/g, '')), faces: faces.map(f => f.status) };
    });
    expect(nunito.loaded).toEqual(['Nunito Sans']);
    expect(nunito.faces).toEqual(['loaded']);
    // And it came from this site, not a third party
    const fontFiles = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /\.woff2(\?|$)/.test(n)));
    expect(fontFiles).toEqual(expect.arrayContaining([expect.stringMatching(/\/assets\/fonts\/nunito-sans-latin-wght-normal\.woff2$/)]));
  });
}

for (const width of [320, 375, 1280]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`no horizontal scroll at ${width}px (${scheme}), header controls inside the viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/state-of-voice-agents/', { waitUntil: 'load' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      for (const sel of ['#exploreBtn', '#themeBtn', '#pdf-open']) {
        const box = (await page.locator(sel).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    });
  }
}

test('a section link lands its heading below the sticky header and section bar', async ({ page }) => {
  await page.goto('/state-of-voice-agents/');
  await page.locator('.jump a[href="#sources"]').click();
  await expect(page).toHaveURL(/#sources$/);
  await expect.poll(async () => {
    const bar = await page.locator('.topbar').boundingBox();
    const h = await page.locator('#sources h2').first().boundingBox();
    return h && bar ? h.y - (bar.y + bar.height) : -1;
  }).toBeGreaterThanOrEqual(0);
});
