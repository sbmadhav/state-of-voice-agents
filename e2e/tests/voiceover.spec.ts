import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/* Voice-overs and read time. The audio manifest and MP3s are stubbed with page.route (a silent MP3 built here),
   so these tests never depend on generated audio and never call ElevenLabs. */

const PAGE = '/state-of-voice-agents/';
const MANIFEST = /\/state-of-voice-agents\/audio\/2026-11\/manifest\.json/;
const MP3 = /\/state-of-voice-agents\/audio\/2026-11\/[a-z0-9-]+\.mp3/;

// A silent MPEG-1 Layer III file, 128 kbps at 44.1 kHz: 120 frames of 417 bytes (about 3.1 seconds)
const FRAME = Buffer.concat([Buffer.from('fffb9000', 'hex'), Buffer.alloc(413)]);
const SILENT_MP3 = Buffer.concat(Array(120).fill(FRAME));

const entry = (id: string, duration: number) =>
  ({ file: `${id}.mp3`, sha256: '0'.repeat(64), duration, bytes: SILENT_MP3.length });

async function stubAudio(page: Page, sections: Record<string, ReturnType<typeof entry>>) {
  const mp3s: string[] = [];
  await page.route(MANIFEST, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ edition: '2026-11', sections }),
  }));
  await page.route(MP3, route => {
    mp3s.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: SILENT_MP3 });
  });
  return mp3s;
}

const playing = (page: Page) => page.locator('main audio').evaluateAll(as => as.map(a => !(a as HTMLAudioElement).paused));

test('read time is pre-rendered in the hero, also without JavaScript', async ({ browser, page }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const nojs = await ctx.newPage();
  await nojs.goto(PAGE);
  const text = await nojs.locator('#brief #read-min').textContent();
  expect(text).toMatch(/^About \d+ min read$/);
  expect(+text!.match(/\d+/)![0]).toBeGreaterThanOrEqual(5);
  await expect(nojs.locator('#listen-min')).toBeHidden();
  await expect(nojs.locator('#listen-all')).toBeHidden();
  await ctx.close();

  await page.goto(PAGE);
  await expect(page.locator('#read-min')).toBeVisible();
  await expect(page.locator('#read-min')).toHaveText(text!);
});

test('no Listen controls when the manifest has no audio', async ({ page, issues }) => {
  const mp3s = await stubAudio(page, {});
  await page.goto(PAGE);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.listen')).toHaveCount(0);
  await expect(page.locator('#listen-all')).toBeHidden();
  await expect(page.locator('#listen-min')).toBeHidden();
  expect(mp3s).toEqual([]);
  expect(issues.console, 'console errors').toEqual([]);
  expect(issues.failed, 'failed requests').toEqual([]);
});

test('a Listen control appears only for sections in the manifest, with its duration and transcript', async ({ page, issues }) => {
  const mp3s = await stubAudio(page, { fs: entry('fs', 252.4), tv: entry('tv', 61) });
  await page.goto(PAGE);
  const fs = page.locator('#fs .listen > button');
  await expect(fs).toBeVisible();
  await expect(page.locator('#tv .listen > button')).toBeVisible();
  await expect(page.locator('main .listen')).toHaveCount(2);
  for (const id of ['brief', 'delta', 'rules', 'sources']) await expect(page.locator(`#${id} .listen`)).toHaveCount(0);

  // Visible duration from the manifest; the accessible name says what plays and for how long
  await expect(fs).toContainText('Listen');
  await expect(fs.locator('.listen-dur')).toHaveText('4:12');
  await expect(fs).toHaveAccessibleName(/^Listen to Where voice agents are working in banking, 4 minutes 12 seconds/);
  await expect(fs).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#listen-min')).toHaveText(' · 5 min listen');

  // No autoplay, and nothing downloads before a reader asks (preload="none")
  expect(await playing(page)).toEqual([false, false, false]);
  expect(mp3s).toEqual([]);

  // Keyboard: the button opens the native player and its transcript link
  await fs.focus();
  await page.keyboard.press('Enter');
  await expect(fs).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator('#listen-fs-panel');
  await expect(panel).toBeVisible();
  const audio = panel.locator('audio');
  await expect(audio).toHaveAttribute('controls', '');
  await expect(audio).toHaveAttribute('preload', 'none');
  await expect(audio).toHaveAttribute('src', '/state-of-voice-agents/audio/2026-11/fs.mp3');
  await expect(audio).toHaveAttribute('aria-label', /^Narration: Where voice agents are working in banking/);
  const tx = panel.getByRole('link', { name: 'Transcript of Where voice agents are working in banking' });
  await expect(tx).toHaveAttribute('href', '/state-of-voice-agents/audio/2026-11/fs.txt');
  await expect(panel).toContainText('AI voice by ElevenLabs');
  await page.keyboard.press('Enter');
  await expect(fs).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  expect(issues.console, 'console errors').toEqual([]);
  expect(issues.failed, 'failed requests').toEqual([]);
});

test('committed transcripts are served as text for every narrated section', async ({ request }) => {
  for (const id of ['brief', 'delta', 'fs', 'tv', 'reliability', 'rules', 'fraud', 'models', 'hc', 'verify', 'unchanged', 'sources', 'about']) {
    const r = await request.get(`/state-of-voice-agents/audio/2026-11/${id}.txt`);
    expect(r.status(), id).toBe(200);
    const t = await r.text();
    expect(t.length, id).toBeGreaterThan(50);
    expect(t, id).not.toMatch(/\[\d+\]|%|\$|—/); // no citation markers or unexpanded symbols, no em dashes
  }
  const m = await request.get('/state-of-voice-agents/audio/2026-11/manifest.json');
  expect(m.status()).toBe(200);
  expect(await m.json()).toHaveProperty('sections');
});

test('the hero playlist plays the sections in order, with an AI voice disclosure', async ({ page, issues }) => {
  await stubAudio(page, { brief: entry('brief', 30), fs: entry('fs', 40), tv: entry('tv', 50) });
  await page.goto(PAGE);
  const all = page.locator('#listen-all');
  await expect(all).toBeVisible();
  await expect(all).toContainText('AI voice by ElevenLabs');
  const btn = page.locator('#listen-all-btn');
  await expect(btn).toHaveText('Listen to the whole update');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  expect(await playing(page)).toEqual([false, false, false, false]);

  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#listen-now')).toHaveText('Now playing 1 of 3: Banks and credit unions reach the front door');
  await expect(page.locator('#listen-all-audio')).toHaveAttribute('src', /\/audio\/2026-11\/brief\.mp3$/);
  await expect(page.locator('#listen-all-tx')).toHaveAttribute('href', '/state-of-voice-agents/audio/2026-11/brief.txt');
  await page.locator('#listen-next').click();
  await expect(page.locator('#listen-now')).toHaveText('Now playing 2 of 3: Where voice agents are working in banking');
  await page.locator('#listen-next').click();
  await expect(page.locator('#listen-now')).toHaveText('Now playing 3 of 3: The TV in the room');
  await expect(page.locator('#listen-next')).toBeHidden();
  expect(issues.console, 'console errors').toEqual([]);
});

test('only one player sounds at a time', async ({ page }) => {
  await stubAudio(page, { fs: entry('fs', 3), tv: entry('tv', 3) });
  await page.goto(PAGE);
  test.skip(!(await page.evaluate(() => document.createElement('audio').canPlayType('audio/mpeg'))), 'this browser build has no MP3 decoder');
  await page.locator('#fs .listen > button').click();
  const fs = page.locator('#listen-fs-panel audio'), tv = page.locator('#listen-tv-panel audio');
  await expect.poll(() => fs.evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.locator('#tv .listen > button').click();
  await expect.poll(() => tv.evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  expect(await fs.evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
});

test('audio controls are hidden in print', async ({ page }) => {
  await stubAudio(page, { brief: entry('brief', 30), fs: entry('fs', 40) });
  await page.goto(PAGE);
  await expect(page.locator('#fs .listen')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#fs .listen')).toBeHidden();
  await expect(page.locator('#brief .listen')).toBeHidden();
  await expect(page.locator('#listen-all')).toBeHidden();
  await expect(page.locator('#listen-min')).toBeHidden();
  await expect(page.locator('#read-min')).toBeVisible();
});

test('Listen controls have no serious or critical axe violations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'axe runs once, in the chromium project');
  test.setTimeout(90_000);
  await stubAudio(page, { brief: entry('brief', 30), fs: entry('fs', 40) });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(PAGE);
    await page.locator('#listen-all-btn').click();
    await page.locator('#fs .listen > button').click();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .include('#brief').include('#fs .head').analyze();
    const found = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      .flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`));
    expect(found, scheme).toEqual([]);
  }
});

test('audio hosted on Cloudflare R2: the player streams the https URL from the manifest', async ({ page, issues }) => {
  const R2 = 'https://audio.example.test/2026-11/fs-0a1b2c3d.mp3';
  let hits = 0;
  await page.route('https://audio.example.test/**', route => { hits++; return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: SILENT_MP3 }); });
  // One section on R2 (url, no file), one beside the manifest (file), one with a non-https url that must be ignored
  await stubAudio(page, {
    fs: { url: R2, sha256: '0'.repeat(64), duration: 12, bytes: SILENT_MP3.length },
    tv: entry('tv', 61),
    hc: { url: 'http://audio.example.test/hc.mp3', file: 'hc.mp3', sha256: '0'.repeat(64), duration: 5, bytes: SILENT_MP3.length },
  });
  await page.goto(PAGE);
  await expect(page.locator('#fs .listen button')).toBeVisible();
  await expect(page.locator('#listen-fs-panel audio')).toHaveAttribute('src', R2);
  await expect(page.locator('#listen-tv-panel audio')).toHaveAttribute('src', '/state-of-voice-agents/audio/2026-11/tv.mp3');
  await expect(page.locator('#listen-hc-panel audio')).toHaveAttribute('src', '/state-of-voice-agents/audio/2026-11/hc.mp3');
  // The transcript stays on this site
  await expect(page.locator('#listen-fs-panel a', { hasText: 'Transcript' })).toHaveAttribute('href', '/state-of-voice-agents/audio/2026-11/fs.txt');
  expect(hits, 'nothing is downloaded before the reader presses Listen').toBe(0);
  expect(issues.console, 'console errors').toEqual([]);
});
