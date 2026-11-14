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
  await expect(page.locator('footer')).toContainText(/November 2026 edition/);
  await expect(page.locator('footer')).toContainText(/Research cutoff/);
});

test('November update: delta-only, financial services focus, links back to the October baseline', async ({ page }) => {
  await page.goto('/state-of-voice-agents/');
  await expect(page.locator('h1')).toContainText('Banks and credit unions');
  // Every changed headline figure shows its October value
  await expect(page.locator('.delta-stats .stat')).toHaveCount(4);
  await expect(page.locator('.delta-stats .stat .was')).toHaveCount(4);
  await expect(page.locator('#delta tbody tr')).toHaveCount(9);
  await expect(page.locator('#tv-in-room tbody tr')).toHaveCount(5);
  await expect(page.locator('#claims tr', { hasText: 'OpenAI Decisions API is generally available' })).toHaveAttribute('data-v', 'v');
  // Unchanged material is not repeated: it links to October sections that exist
  for (const id of ['calc', 'router', 'gap', 'pilot']) await expect(page.locator(`#${id}`)).toHaveCount(0);
  const back = await page.locator('main a[href^="/state-of-voice-agents/editions/2026-10/#"]').evaluateAll(as => [...new Set(as.map(a => (a as HTMLAnchorElement).hash.slice(1)))]);
  expect(back.length).toBeGreaterThan(10);
  await page.goto('/state-of-voice-agents/editions/2026-10/');
  for (const id of back) await expect(page.locator(`[id="${id}"]`), `October has #${id}`).toHaveCount(1);
});

test("What's new: ten ranked releases, each with an external source link, reachable from the section nav", async ({ page }) => {
  await page.goto('/state-of-voice-agents/');
  const section = page.locator('section#whatsnew');
  await expect(section.locator('h2')).toHaveText("What's new in the voice AI world");
  await expect(section.locator('.eyebrow')).toHaveText(/^8 · /);
  // It sits between Models and Health care notes, and the eyebrow numbers run 1 to 10 in order
  const ids = await page.locator('main > section').evaluateAll(ss => ss.map(s => s.id));
  expect(ids.slice(ids.indexOf('models'), ids.indexOf('models') + 3)).toEqual(['models', 'whatsnew', 'hc']);
  const numbers = await page.locator('main > section .head .eyebrow').evaluateAll(es => es.map(e => /^(\d+) · /.exec(e.textContent || '')?.[1]).filter(Boolean).map(Number));
  expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const rows = section.locator('tbody tr');
  await expect(rows).toHaveCount(10);
  const hrefs: string[] = [];
  for (let i = 0; i < 10; i++) {
    const row = rows.nth(i);
    await expect(row.locator('td').first()).toHaveText(String(i + 1));
    const link = row.locator('a[target="_blank"][href^="https://"]');
    await expect(link, `row ${i + 1} has one external source link`).toHaveCount(1);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).not.toHaveText('');
    const href = (await link.getAttribute('href'))!;
    expect(new URL(href).hostname).not.toMatch(/(^|\.)sbmadhav\.com$/);
    hrefs.push(href);
  }
  expect(new Set(hrefs).size).toBe(10);
  // The section nav links to it, right after Models
  const nav = await page.locator('nav.jump a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(nav.indexOf('#whatsnew')).toBe(nav.indexOf('#models') + 1);
  await page.locator('nav.jump a[href="#whatsnew"]').click();
  await expect(page).toHaveURL(/#whatsnew$/);
  await expect(section.locator('h2')).toBeInViewport();
});

test('citations resolve to numbered sources, also without JavaScript', async ({ page, browser }) => {
  await page.goto('/state-of-voice-agents/');
  const keys = await page.locator('a.c').evaluateAll(as => [...new Set(as.map(a => (a as HTMLElement).dataset.s))]);
  for (const k of keys) await expect(page.locator(`#src-${k}`)).toHaveCount(1);
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const nojs = await ctx.newPage();
  await nojs.goto('/state-of-voice-agents/');
  await expect(nojs.locator('#src li').first()).toBeAttached();
  await expect(nojs.locator('#claims tr', { hasText: 'Chatbase' })).toHaveCount(1);
  await expect(nojs.locator('#tv-in-room a.c').first()).toHaveText(/^\[\d+\]$/);
  await ctx.close();
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
