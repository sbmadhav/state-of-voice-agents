import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/* Section permalinks and exhibit sharing, on the report and every archived edition.
   - Each section heading carries a "#" link to the section; a click also copies the section's link.
   - Each exhibit (figure.exhibit) has an id and a Share control: a plain link to its share page without
     JavaScript, a button with a small menu with it.
   - Copied and shared links point at the archived edition (<main data-edition>), never at the root page.
   - The share pages and images in share/<edition>/ are written by e2e/share-images.mjs.
   No test follows a link to LinkedIn or X: those requests are answered here. */

const REPO = path.resolve(__dirname, '..', '..');
const EDITIONS = readdirSync(path.join(REPO, 'editions'))
  .filter(d => existsSync(path.join(REPO, 'editions', d, 'index.html')))
  .sort();
const PAGES = ['/state-of-voice-agents/', ...EDITIONS.map(d => `/state-of-voice-agents/editions/${d}/`)];
const SITE = 'https://sbmadhav.com/state-of-voice-agents/';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (edition: string) => `${MONTHS[+edition.slice(5) - 1]} ${edition.slice(0, 4)}`;
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/**
 * The elements that reach past the right edge of the page, widest first, so a failed no-horizontal-scroll check names
 * its cause. Skips elements inside a scroll or clip container (the container is judged on its own) and fixed elements,
 * since neither widens the page.
 */
const overflowing = (page: Page) => page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const contained = (el: Element) => {
    if (getComputedStyle(el).position === 'fixed') return true;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.position === 'fixed') return true;
    }
    return false;
  };
  const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`;
  const list = [...document.querySelectorAll('body *')]
    .map(el => ({ el, right: Math.round(el.getBoundingClientRect().right + scrollX) }))
    .filter(({ el, right }) => right > w && el.getClientRects().length > 0 && !contained(el))
    .sort((a, b) => b.right - a.right)
    .slice(0, 5)
    .map(({ el, right }) => `${name(el)} in ${el.parentElement ? name(el.parentElement) : '?'} (right ${right}px)`);
  return list.length ? list.join(', ') : 'nothing found outside scroll containers';
});

const editionOf = (page: Page) => page.locator('main').getAttribute('data-edition') as Promise<string>;

/** Every exhibit on the page: its id, the caption's claim and the text after it, and how many Share controls it has. */
const exhibits = (page: Page) => page.locator('figure.exhibit').evaluateAll(figs => figs.map(f => {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  const cap = f.querySelector('figcaption.caption')!.cloneNode(true) as HTMLElement;
  cap.querySelectorAll('a.c, .chip, .share, .share-box').forEach(el => el.remove());
  const claim = squash(cap.querySelector('strong')?.textContent || '');
  return {
    id: f.id,
    claim,
    rest: squash(cap.textContent || '').slice(claim.length).trim(),
    controls: f.querySelectorAll('a.share, button.share').length,
  };
}));

test('share pages are up to date with the pages, and every image exists (share-images --check)', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'a check of the files in this checkout: once is enough');
  const out = execFileSync(process.execPath, [path.join(REPO, 'e2e', 'share-images.mjs'), '--check', '--all'], { encoding: 'utf8' });
  expect(out).toMatch(/share pages are up to date and every image is present/);
});

for (const url of PAGES) {
  test.describe(url, () => {
    test('the page names its edition, and that edition is archived', async ({ page }) => {
      await page.goto(url);
      const edition = await editionOf(page);
      expect(EDITIONS).toContain(edition);
      const folder = /\/editions\/([^/]+)\/$/.exec(url)?.[1];
      if (folder) expect(edition).toBe(folder);
      // The voice-overs and the share links agree on the edition
      await expect(page.locator('main')).toHaveAttribute('data-audio-base', `/state-of-voice-agents/audio/${edition}/`);
    });

    test('every section heading has one permalink, and the heading text is unchanged', async ({ page }) => {
      await page.goto(url);
      const heads = await page.locator('main h2').evaluateAll(hs => hs.map(h => {
        const box = h.closest('section[id], .partdiv[id]');
        const links = [...h.querySelectorAll('a.hash')];
        const r = links[0]?.getBoundingClientRect();
        return {
          id: box?.id || '',
          inSection: box ? box.querySelectorAll('h2').length : 0,
          hrefs: links.map(a => a.getAttribute('href')),
          label: links[0]?.getAttribute('aria-label'),
          linkText: links[0]?.textContent,
          skip: links[0]?.hasAttribute('data-narrate-skip'),
          text: h.textContent || '',
          size: r ? [Math.round(r.width), Math.round(r.height)] : [0, 0],
          drawn: links[0] ? getComputedStyle(links[0], '::before').content : '',
        };
      }));
      expect(heads.length).toBeGreaterThan(10);
      for (const h of heads) {
        expect(h.id, `"${h.text}" sits in a section with an id`).not.toBe('');
        expect(h.inSection, `#${h.id} has one h2`).toBe(1);
        expect(h.hrefs, `#${h.id}`).toEqual([`#${h.id}`]);
        expect(h.label, `#${h.id}`).toBe('Link to this section');
        expect(h.skip, `#${h.id} permalink is left out of the narration`).toBe(true);
        // The "#" is drawn with CSS: the heading's text, which the audio player and the tests read, has none
        expect(h.linkText, `#${h.id}`).toBe('');
        expect(h.text, `#${h.id}`).not.toContain('#');
        expect(h.text, `#${h.id}`).toBe(h.text.trim());
        expect(h.drawn, `#${h.id}`).toBe('"#"');
        // WCAG 2.2 target size
        expect(Math.min(...h.size), `#${h.id} permalink is ${h.size.join(' x ')} px`).toBeGreaterThanOrEqual(24);
      }
      // Every section, the comments, the sources and the About block are covered
      const ids = heads.map(h => h.id);
      for (const id of ['sources', 'comments', 'about']) expect(ids).toContain(id);
      const sections = await page.locator('main section[id]').evaluateAll(ss => ss.filter(s => s.querySelector('h2')).map(s => s.id));
      expect(ids).toEqual(expect.arrayContaining(sections));
      await expect(page.locator('main h2 a.hash').first()).toBeVisible();
    });

    test('a permalink moves to its section and copies the link of the archived edition', async ({ page, context, browserName, issues }) => {
      if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto(url);
      const edition = await editionOf(page);
      const id = await page.locator('main section[id]:has(h2)').nth(1).getAttribute('id');
      const link = page.locator(`#${id} h2 a.hash`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(page.locator(`#${id} h2`)).toBeInViewport();
      const live = page.locator('.md-toasts[aria-live="polite"]');
      await expect(live).toHaveCount(1);
      if (browserName === 'chromium') {
        // The visible confirmation is also the polite live region
        await expect(live).toHaveText('Link copied');
        await expect(live.locator('.md-toast')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${SITE}editions/${edition}/#${id}`);
        // From the keyboard too
        const other = await page.locator('main section[id]:has(h2)').nth(2).getAttribute('id');
        await page.locator(`#${other} h2 a.hash`).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`#${other}$`));
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${SITE}editions/${edition}/#${other}`);
      }
      expect(issues.console, 'console errors').toEqual([]);
    });

    test('every exhibit has a unique id, one Share control, a share page with Open Graph tags, and its images', async ({ page, browser, request }) => {
      test.setTimeout(180_000);
      await page.goto(url);
      const edition = await editionOf(page);
      const list = await exhibits(page);
      expect(list.length).toBeGreaterThan(10);
      expect(new Set(list.map(x => x.id)).size, 'ids are unique').toBe(list.length);
      const from = `From the ${monthOf(edition)} edition of Voice Agents at the Front Door, by Madhav Srinivasan.`;
      // The share pages are read without JavaScript, as a social site's crawler reads them
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const nojs = await ctx.newPage();
      for (const x of list) {
        // "fig-", the section's id when the exhibit was added, and a number. An id never changes afterwards.
        expect(x.id).toMatch(/^fig-[a-z][a-z0-9-]*-\d+$/);
        expect(await page.locator(`[id="${x.id}"]`).count(), `${x.id} is used once`).toBe(1);
        expect(x.controls, `${x.id} has one Share control`).toBe(1);
        expect(x.claim, `${x.id} states its claim`).not.toBe('');

        const sharePath = `/state-of-voice-agents/share/${edition}/${x.id}/`;
        const r = await nojs.goto(sharePath);
        expect(r!.status(), sharePath).toBe(200);
        const meta = (sel: string) => nojs.locator(sel).getAttribute('content');
        await expect(nojs.locator('html')).toHaveAttribute('lang', 'en');
        expect(await nojs.title(), x.id).toBe(x.claim);
        expect(await meta('meta[property="og:title"]'), x.id).toBe(x.claim);
        const description = (await meta('meta[property="og:description"]'))!;
        expect(description.endsWith(from), `${x.id}: ${description}`).toBe(true);
        // Before that line comes the caption's second sentence, when it has one
        const second = description.slice(0, -from.length).trim();
        expect(x.rest.startsWith(second), `${x.id}: "${second}" opens "${x.rest}"`).toBe(true);
        expect(second === '', x.id).toBe(x.rest === '');
        expect(await meta('meta[property="og:url"]'), x.id).toBe(`${SITE}share/${edition}/${x.id}/`);
        const image = await meta('meta[property="og:image"]');
        expect(image, x.id).toBe(`${SITE}share/${edition}/${x.id}.png`);
        expect(await meta('meta[property="og:image:width"]'), x.id).toBe('1200');
        expect(await meta('meta[property="og:image:height"]'), x.id).toBe('630');
        expect(await meta('meta[property="og:image:alt"]'), x.id).toContain(x.claim);
        expect(await meta('meta[name="twitter:card"]'), x.id).toBe('summary_large_image');
        expect(await meta('meta[name="robots"]'), x.id).toBe('noindex,follow');
        expect(await nojs.locator('link[rel="canonical"]').getAttribute('href'), x.id).toBe(`${SITE}editions/${edition}/#${x.id}`);
        // Crawlers must read this page's tags, so it never redirects with a meta refresh
        await expect(nojs.locator('meta[http-equiv]')).toHaveCount(0);
        // Its own body: the card with alt text, the claim, and the way back to the report
        await expect(nojs.locator('h1')).toHaveText(x.claim);
        const img = nojs.locator('img');
        await expect(img).toHaveAttribute('src', `/state-of-voice-agents/share/${edition}/${x.id}.png`);
        expect(await img.getAttribute('alt'), x.id).toContain(x.claim);
        await expect(nojs.getByRole('link', { name: 'Open this exhibit in the report' })).toHaveAttribute('href', `/state-of-voice-agents/editions/${edition}/#${x.id}`);
        // No external resources
        await expect(nojs.locator('script[src], link[rel="stylesheet"], iframe')).toHaveCount(0);

        // The preview image, from the host under test: a PNG of exactly 1200 x 630
        const card = await request.get(new URL(image!).pathname);
        expect(card.status(), `${x.id}.png`).toBe(200);
        expect(card.headers()['content-type'], `${x.id}.png`).toMatch(/^image\/png/);
        const png = await card.body();
        expect(png.subarray(1, 4).toString(), `${x.id}.png`).toBe('PNG');
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${x.id}.png`).toEqual([1200, 630]);
        // The image for "Download image"
        const full = await request.get(`/state-of-voice-agents/share/${edition}/${x.id}-full.png`);
        expect(full.status(), `${x.id}-full.png`).toBe(200);
        expect((await full.body()).subarray(1, 4).toString(), `${x.id}-full.png`).toBe('PNG');
      }
      await ctx.close();
    });

    test('without JavaScript, Share is a plain link to the share page, which links back to the exhibit', async ({ browser }) => {
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const nojs = await ctx.newPage();
      await nojs.goto(url);
      const edition = await editionOf(nojs);
      const hrefs = await nojs.locator('figure.exhibit').evaluateAll(figs => figs.map(f => [f.id, f.querySelector('figcaption a.share')?.getAttribute('href')]));
      for (const [id, href] of hrefs) expect(href, id!).toBe(`/state-of-voice-agents/share/${edition}/${id}/`);
      await expect(nojs.locator('button.share')).toHaveCount(0);
      const first = nojs.locator('figure.exhibit a.share').first();
      await expect(first).toHaveText('Share');
      await expect(first).toBeVisible();
      await first.click();
      await expect(nojs).toHaveURL(new RegExp(`/share/${edition}/${hrefs[0][0]}/$`));
      await nojs.getByRole('link', { name: 'Open this exhibit in the report' }).click();
      await expect(nojs).toHaveURL(new RegExp(`/editions/${edition}/#${hrefs[0][0]}$`));
      await expect(nojs.locator(`[id="${hrefs[0][0]}"]`)).toBeInViewport();
      // The section permalink is a plain in-page link
      const hash = nojs.locator('main h2 a.hash').first();
      await hash.click();
      await expect(nojs).toHaveURL(new RegExp(`${await hash.getAttribute('href')}$`));
      await ctx.close();
    });

    test('a share page sends a visitor on to the exhibit in the archived edition', async ({ page }) => {
      await page.goto(url);
      const edition = await editionOf(page);
      const id = await page.locator('figure.exhibit').nth(1).getAttribute('id');
      await page.goto(`/state-of-voice-agents/share/${edition}/${id}/`, { waitUntil: 'commit' });
      await page.waitForURL(new RegExp(`/state-of-voice-agents/editions/${edition}/#${id}$`));
      await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
      // The share page replaced itself, so Back returns to where the visitor came from, not to the share page
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${url}$`));
    });

    test('the Share menu opens, lists its items, and closes on Escape with focus back on its button', async ({ page, context, browserName, issues }) => {
      await context.route(/^https:\/\/(www\.)?(linkedin|x)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
      if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto(url);
      const edition = await editionOf(page);
      const list = await exhibits(page);
      const x = list[1];
      const shareUrl = `${SITE}share/${edition}/${x.id}/`;
      const fig = page.locator(`[id="${x.id}"]`);
      const btn = fig.locator('button.share');
      const menu = fig.locator('.share-menu');

      // Upgraded: one button per exhibit, and nothing built yet, so no link to LinkedIn or X is in the page
      await expect(page.locator('figure.exhibit button.share')).toHaveCount(list.length);
      await expect(page.locator('figure.exhibit a.share')).toHaveCount(0);
      await expect(page.locator('.share-menu > *')).toHaveCount(0);
      // Count only the report's own links: the site-wide Explore menu (dialog.xpm, from /assets/explore.js) adds its
      // own LinkedIn link when it is built at idle time. Safari has no requestIdleCallback, so explore.js builds it 800 ms
      // after load, which can land between the two counts below and add one.
      const external = () => page.locator('a[href]').evaluateAll(as => as.filter(a => !a.closest('dialog.xpm')).map(a => (a as HTMLAnchorElement).host).filter(h => /(^|\.)(linkedin|x|twitter)\.com$/.test(h)).length);
      const before = await external();
      await expect(btn).toHaveText('Share');
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await expect(btn).toHaveAttribute('aria-controls', `share-${x.id}`);
      await expect(menu).toHaveAttribute('id', `share-${x.id}`);
      await expect(menu).toBeHidden();

      // Keyboard: Enter opens it and moves focus to the first item
      await btn.focus();
      await page.keyboard.press('Enter');
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('role', 'group');
      await expect(menu).toHaveAccessibleName('Share this exhibit');
      const more = await page.evaluate(() => 'share' in navigator);
      const names = ['Copy link', 'Share on LinkedIn (opens in a new tab)', 'Share on X (opens in a new tab)', 'Download image', ...(more ? ['More options'] : [])];
      expect(await menu.locator('> *').evaluateAll(els => els.map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()))).toEqual(names);
      await expect(menu.getByRole('button', { name: 'Copy link' })).toBeFocused();
      expect(await external()).toBe(before + 2);

      // The links share the share page, so a preview shows the exhibit; X also gets the claim as its text
      const linkedin = menu.getByRole('link', { name: /^Share on LinkedIn/ });
      await expect(linkedin).toHaveAttribute('href', `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`);
      const xHref = new URL((await menu.getByRole('link', { name: /^Share on X/ }).getAttribute('href'))!);
      expect(xHref.origin + xHref.pathname).toBe('https://x.com/intent/post');
      expect(xHref.searchParams.get('url')).toBe(shareUrl);
      expect(xHref.searchParams.get('text')).toBe(x.claim);
      for (const a of await menu.locator('a[target]').all()) {
        await expect(a).toHaveAttribute('target', '_blank');
        await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      }
      const image = menu.getByRole('link', { name: 'Download image' });
      await expect(image).toHaveAttribute('href', `/state-of-voice-agents/share/${edition}/${x.id}-full.png`);
      await expect(image).toHaveAttribute('download', `voice-agents-${edition}-${x.id}.png`);

      // Arrow keys move through the items and wrap; every item is at least 24 x 24 px
      await page.keyboard.press('ArrowDown');
      await expect(linkedin).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await expect(menu.locator('> *').last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(menu.getByRole('button', { name: 'Copy link' })).toBeFocused();
      const small = await menu.locator('> *').evaluateAll(els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).length);
      expect(small).toBe(0);
      const trigger = await btn.boundingBox();
      expect(Math.min(trigger!.width, trigger!.height)).toBeGreaterThanOrEqual(24);

      // Escape closes it and returns focus to the button
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await expect(btn).toBeFocused();

      // Tab walks through the items in order, and tabbing past the last one closes the menu
      if (browserName !== 'webkit') { // Safari does not move focus to links with Tab by default
        await page.keyboard.press('Enter');
        await expect(menu.getByRole('button', { name: 'Copy link' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(linkedin).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(btn).toBeFocused();
        await expect(menu).toBeVisible();
        await page.keyboard.press('End');
        await page.keyboard.press('Tab');
        await expect(menu).toBeHidden();
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
      }

      // A click opens and closes it; a click elsewhere closes it; opening another closes the first
      await btn.click();
      await expect(menu).toBeVisible();
      await btn.click();
      await expect(menu).toBeHidden();
      await btn.click();
      await page.locator(`[id="${x.id}"] figcaption strong`).click();
      await expect(menu).toBeHidden();
      await btn.click();
      const other = page.locator(`[id="${list[2].id}"]`);
      await other.locator('button.share').click();
      await expect(menu).toBeHidden();
      await expect(other.locator('.share-menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(other.locator('.share-menu')).toBeHidden();

      // Copy link: the share page's address, with the same confirmation as a permalink
      await btn.click();
      await menu.getByRole('button', { name: 'Copy link' }).click();
      await expect(menu).toBeHidden();
      await expect(btn).toBeFocused();
      if (browserName === 'chromium') {
        await expect(page.locator('.md-toasts[aria-live="polite"]')).toHaveText('Link copied');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
      }

      // Share on LinkedIn opens a new tab (answered here, never LinkedIn itself) and closes the menu
      if (browserName === 'chromium') {
        await btn.click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), linkedin.click()]);
        await popup.waitForURL(/^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=/);
        await popup.close();
        await expect(menu).toBeHidden();
      }
      expect(issues.console, 'console errors').toEqual([]);
    });

    test('the Share menu stays inside a 320px screen, and the controls are hidden in print', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(url, { waitUntil: 'load' });
      const ids = await page.locator('figure.exhibit').evaluateAll(fs => fs.map(f => f.id));
      for (const id of ids) {
        const fig = page.locator(`[id="${id}"]`);
        const before = await sideways(page);
        await fig.locator('button.share').click();
        const menu = fig.locator('.share-menu');
        await expect(menu).toBeVisible();
        const box = (await menu.boundingBox())!;
        expect(box.x, `${id}: left edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${id}: right edge`).toBeLessThanOrEqual(320);
        const over = await sideways(page);
        expect(over, `${id}: no horizontal scroll (${before}px before the menu opened; past the edge: ${over ? await overflowing(page) : 'none'})`).toBe(0);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
      }
      // Print: no Share controls, no "#" after the headings
      await page.locator(`[id="${ids[0]}"] button.share`).click();
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator(`[id="${ids[0]}"] .share-box`)).toBeHidden();
      await expect(page.locator(`[id="${ids[0]}"] .share-menu`)).toBeHidden();
      await expect(page.locator('main h2 a.hash').first()).toBeHidden();
      await expect(page.locator(`[id="${ids[0]}"] figcaption strong`)).toBeVisible();
    });
  });
}

test('More options uses the native share sheet when the browser has one', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__shared = [];
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: (data: unknown) => { (window as any).__shared.push(data); return Promise.resolve(); } });
  });
  await page.goto('/state-of-voice-agents/');
  const edition = await editionOf(page);
  const fig = page.locator('figure.exhibit').first();
  const id = await fig.getAttribute('id');
  const claim = (await fig.locator('figcaption strong').textContent())!.trim();
  await fig.locator('button.share').click();
  await fig.locator('.share-menu').getByRole('button', { name: 'More options' }).click();
  await expect(fig.locator('.share-menu')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__shared)).toEqual([{ title: claim, text: claim, url: `${SITE}share/${edition}/${id}/` }]);
});

test('Download image saves the full picture of the exhibit', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'downloads are checked in Chromium; the link itself is checked in every browser above');
  await page.goto('/state-of-voice-agents/');
  const edition = await editionOf(page);
  const fig = page.locator('figure.exhibit').first();
  const id = await fig.getAttribute('id');
  await fig.locator('button.share').click();
  const [download] = await Promise.all([page.waitForEvent('download'), fig.locator('.share-menu').getByRole('link', { name: 'Download image' }).click()]);
  expect(download.suggestedFilename()).toBe(`voice-agents-${edition}-${id}.png`);
  await download.cancel();
});

test('a share is counted by network name only, with no personal data', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'new tabs are checked in Chromium');
  await context.route(/^https:\/\/(www\.)?(linkedin|x)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
  await page.goto('/state-of-voice-agents/');
  await page.waitForLoadState('load');
  // Stand in for /assets/analytics.js, which is switched off on local hosts
  await page.evaluate(() => { (window as any).__events = []; (window as any).siteTrack = (name: string, title: string) => (window as any).__events.push([name, title]); });
  const fig = page.locator('figure.exhibit').first();
  await fig.locator('button.share').click();
  await fig.locator('.share-menu').getByRole('button', { name: 'Copy link' }).click();
  await fig.locator('button.share').click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), fig.locator('.share-menu').getByRole('link', { name: /^Share on X/ }).click()]);
  await popup.close();
  const events: [string, string][] = await page.evaluate(() => (window as any).__events);
  // On the live host the site-wide analytics script also counts the new tab as an outbound link, like every
  // other external link on the site: the host and path only, never the query string that carries the shared URL
  const outbound = events.filter(([name]) => name.startsWith('out/'));
  for (const [name, title] of outbound) {
    expect(name).toMatch(/^out\/(www\.)?(x|linkedin)\.com\/[\w/-]*$/);
    expect(title).toMatch(/^Outbound: Share on (X|LinkedIn)/);
  }
  expect(events.filter(([name]) => !name.startsWith('out/'))).toEqual([
    ['voice/share/copy', 'Shared an exhibit'],
    ['voice/share/x', 'Shared an exhibit'],
  ]);
  expect(JSON.stringify(events)).not.toMatch(/[?=&]|sbmadhav|fig-/);
});

test('an exhibit opened from a shared link is marked on the page', async ({ page }) => {
  await page.goto('/state-of-voice-agents/');
  const id = await page.locator('figure.exhibit').nth(2).getAttribute('id');
  await page.goto(`/state-of-voice-agents/#${id}`);
  const fig = page.locator(`[id="${id}"]`);
  await expect(fig).toBeInViewport();
  expect(await fig.evaluate(f => getComputedStyle(f).outlineStyle)).toBe('solid');
  expect(await page.locator('figure.exhibit').first().evaluate(f => getComputedStyle(f).outlineStyle)).toBe('none');
});

test.describe('accessibility of the Share menu and the permalinks', () => {
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'chromium', 'axe runs once, in the chromium project'));
  test.describe.configure({ timeout: 90_000 });

  for (const url of PAGES) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${url}: no serious or critical axe violations with the menu open (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url);
        const fig = page.locator('figure.exhibit').nth(1);
        const id = await fig.getAttribute('id');
        const section = await fig.evaluate(f => f.closest('section[id]')!.id);
        await fig.locator('button.share').click();
        await expect(fig.locator('.share-menu')).toBeVisible();
        // Hover an item, so its hover colors are checked as well
        await fig.locator('.share-menu > *').nth(1).hover();
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .include(`#${id} figcaption`).include(`#${section} .head`).analyze();
        const found = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
          .flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`));
        expect(found, scheme).toEqual([]);
      });
    }
  }
});
