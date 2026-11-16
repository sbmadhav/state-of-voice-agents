import AxeBuilder from '@axe-core/playwright';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/* Read-along: while a narration plays, the element being read carries the class "reading".
   - audio/<edition>/<section>.blocks.json (tools/narration.py) names the element behind each paragraph of a
     script: [path, prefix], the element-child indexes from the section down to it in the static HTML and the
     start of its text. "cues" in the audio manifest (tools/cues.py) give the second each paragraph starts.
   - The page highlights the block of the last cue at or before the playing time, one element at a time, and
     never scrolls or moves focus to follow it.
   The tests set the playing time and send the media events themselves, so none waits for audio to play. Where
   a manifest is stubbed, the MP3s are a silent file built here. Nothing calls ElevenLabs or Ask Bolt. */

const REPO = path.resolve(__dirname, '..', '..');
const EDITIONS = readdirSync(path.join(REPO, 'editions'))
  .filter(d => existsSync(path.join(REPO, 'editions', d, 'index.html')))
  .sort();
const PAGES = ['/state-of-voice-agents/', ...EDITIONS.map(d => `/state-of-voice-agents/editions/${d}/`)];

// A silent MPEG-1 Layer III file, 128 kbps at 44.1 kHz: 120 frames of 417 bytes (about 3.1 seconds)
const FRAME = Buffer.concat([Buffer.from('fffb9000', 'hex'), Buffer.alloc(413)]);
const SILENT_MP3 = Buffer.concat(Array(120).fill(FRAME));

type Block = [number[], string];
type Entry = { file?: string; url?: string; duration?: number; cues?: unknown };
type Edition = { base: string; ids: string[]; blocks: Record<string, Block[]>; manifest: { sections: Record<string, Entry> } | null };

/** The edition as the site serves it: narrated section ids in page order, their blocks files and the manifest. */
async function edition(page: Page): Promise<Edition> {
  const { base, ids } = await page.evaluate(() => {
    const main = document.getElementById('main')!;
    return { base: main.dataset.audioBase!, ids: [...main.querySelectorAll('section[id], header.hero[id]')].map(s => s.id) };
  });
  const blocks: Record<string, Block[]> = {};
  for (const id of ids) {
    const r = await page.request.get(`${base}${id}.blocks.json`);
    if (r.ok()) blocks[id] = (await r.json()).blocks;
  }
  const m = await page.request.get(`${base}manifest.json`);
  return { base, ids: ids.filter(id => blocks[id]), blocks, manifest: m.ok() ? await m.json() : null };
}

/** Answer the edition's manifest with `sections`, and every MP3 with silence. */
async function stub(page: Page, ed: Edition, sections: Record<string, Entry>) {
  await page.route(u => u.pathname === `${ed.base}manifest.json`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ edition: 'test', sections }),
  }));
  await page.route(u => u.pathname.startsWith(ed.base) && u.pathname.endsWith('.mp3'), route =>
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: SILENT_MP3 }));
}

/** A manifest in which every narrated section has audio and one cue for each of its blocks, ten seconds apart. */
const timed = (ed: Edition) => Object.fromEntries(ed.ids.map(id =>
  [id, { file: `${id}.mp3`, sha256: '0'.repeat(64), duration: ed.blocks[id].length * 10, cues: ed.blocks[id].map((_, i) => i * 10) }]));

type Step = { id: string; block?: Block; time?: number; event?: string; real?: boolean };
type Seen = { count: number; scrollY: number; height: number; scrolls: number; sameFocus: boolean; inSection: boolean; litKey: string | null;
  litTag: string | null; found?: boolean; key?: string | null; tag?: string | null; direct?: boolean; hiddenIn?: string | null; isWanted?: boolean; wantNone?: boolean };

/* Runs in the page. Gives a player a playing time, sends it a media event and reports what is highlighted,
   beside what the block says should be: its own walk of the path (children that a script added, marked
   data-inserted, are not counted), the prefix, and the closest visible ancestor of an element that has no
   layout box. `id` is a section id, or "@all" for the hero playlist. With `real`, the time is set on the media
   element itself where it takes it; otherwise the element just reports that time, and no media is touched. */
const STEP = `(args => {
  const { id, block, time, event, real } = args;
  const sec = document.getElementById(id);
  const au = id === '@all' ? document.getElementById('listen-all-audio') : document.querySelector('[id="listen-' + id + '-panel"] audio');
  if (!('__scrolls' in window)) { window.__scrolls = 0; window.addEventListener('scroll', () => window.__scrolls++, true); window.__focus = document.activeElement; }
  if (time !== undefined) {
    if (real) { delete au.currentTime; try { au.currentTime = time; } catch (e) {} }
    if (!real || Math.abs(au.currentTime - time) > 0.01) Object.defineProperty(au, 'currentTime', { configurable: true, get: () => time, set: () => {} });
  }
  if (event) au.dispatchEvent(new Event(event));
  const key = el => { const c = el.cloneNode(true); c.querySelectorAll('[data-inserted]').forEach(x => x.remove());
    return (c.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16); };
  const lit = [...document.querySelectorAll('.reading')];
  const out = { count: lit.length, scrollY: window.scrollY, height: document.documentElement.scrollHeight, scrolls: window.__scrolls,
    sameFocus: document.activeElement === window.__focus, inSection: !!sec && lit.every(el => sec.contains(el) && el !== sec),
    litKey: lit[0] ? key(lit[0]) : null, litTag: lit[0] ? lit[0].tagName.toLowerCase() : null };
  if (block && sec) {
    let el = sec;
    for (const i of block[0]) el = el && [...el.children].filter(c => !c.hasAttribute('data-inserted'))[i];
    out.found = !!el;
    out.key = el ? key(el) : null;
    out.tag = el ? el.tagName.toLowerCase() : null;
    const boxed = e => e.checkVisibility ? e.checkVisibility() : e.getClientRects().length > 0;
    let want = el;
    while (want && want !== sec && !boxed(want)) want = want.parentElement;
    out.direct = !!el && want === el;
    out.hiddenIn = el && want !== el ? (el.closest('.print-only') ? 'print-only' : el.closest('details:not([open])') ? 'details' : 'other') : null;
    out.wantNone = !want || want === sec;
    out.isWanted = !out.wantNone && lit.length === 1 && lit[0] === want;
  }
  return out;
})`;
const step = (page: Page, args: Step) => page.evaluate(`${STEP}(${JSON.stringify(args)})`) as Promise<Seen>;
/** Many steps in one round trip to the page, in order. */
const steps = (page: Page, list: Step[]) => page.evaluate(`${JSON.stringify(list)}.map(${STEP})`) as Promise<Seen[]>;

const hold = (page: Page, id: string) => page.evaluate(i => {
  const au = (i === '@all' ? document.getElementById('listen-all-audio') : document.querySelector(`[id="listen-${i}-panel"] audio`)) as HTMLAudioElement;
  au.pause();
}, id);

/** Open a section's player with its Listen button and hold it: from here the test says what time it is.
    For the page the narration starts with the play event, whether or not this browser can decode MP3. */
async function open(page: Page, id: string) {
  await page.locator(`[id="${id}"] .listen > button`).click();
  await hold(page, id);
  await step(page, { id, time: 0, event: 'play' });
}

const settled = async (page: Page) => {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => true));
};

for (const url of PAGES) {
  test.describe(url, () => {
    test('every block of every narrated section resolves to its element, at desktop and phone widths', async ({ page, issues }) => {
      test.setTimeout(120_000);
      await page.goto(url);
      const ed = await edition(page);
      expect(ed.ids.length, 'narrated sections with a blocks file').toBeGreaterThan(5);
      await stub(page, ed, timed(ed));
      for (const [width, height] of [[1280, 800], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.goto(url);
        await settled(page);
        await expect(page.locator('main .listen')).toHaveCount(ed.ids.length);
        // The page has settled; now its scripts add what they add later: a Listen panel, the playlist panel
        // and a Share menu are opened before any block is looked up
        await open(page, ed.ids[1]);
        await page.locator('#listen-all-btn').click();
        await hold(page, '@all');
        await page.locator('button.share').first().click();
        await expect(page.locator('.share-menu').first()).toBeVisible();
        let total = 0;
        const fallbacks: Record<string, number> = {};
        for (const id of ed.ids) {
          const blocks = ed.blocks[id];
          await step(page, { id, time: 0, event: 'play' });
          // the blocks file is fetched when the narration starts; then every lookup is immediate
          await expect.poll(async () => (await step(page, { id, time: 0.5, event: 'timeupdate' })).count, { message: `#${id}: first block` }).toBe(1);
          const seen = await steps(page, blocks.map((block, k) => ({ id, block, time: k * 10 + 0.5, event: 'timeupdate' })));
          for (let k = 0; k < blocks.length; k++) {
            const s = seen[k];
            const where = `${url} #${id} block ${k} [${blocks[k][0].join(',')}] at ${width}px`;
            expect(s.found, `${where}: the path leads to an element`).toBe(true);
            expect(s.key, `${where}: the element starts with the block's prefix`).toBe(blocks[k][1]);
            expect(s.wantNone, `${where}: it, or an ancestor inside the section, has a layout box`).toBe(false);
            expect(s.count, `${where}: one element is highlighted`).toBe(1);
            expect(s.isWanted, `${where}: the highlighted element is the block's (it is ${s.litTag} "${s.litKey}")`).toBe(true);
            expect(s.inSection, where).toBe(true);
            if (!s.direct) fallbacks[s.hiddenIn!] = (fallbacks[s.hiddenIn!] || 0) + 1;
            total++;
          }
          expect((await step(page, { id, event: 'ended' })).count, `#${id}: ended clears the highlight`).toBe(0);
        }
        expect(total).toBe(ed.ids.reduce((n, id) => n + ed.blocks[id].length, 0));
        // An element without a layout box hands the highlight to a visible ancestor. That happens only for
        // the print-only mirrors of the interactive tools and for the closed "How to read" box.
        expect(Object.keys(fallbacks).filter(k => k !== 'print-only' && k !== 'details'), JSON.stringify(fallbacks)).toEqual([]);
      }
      expect(issues.console, 'console errors').toEqual([]);
    });

    test('paths skip what scripts insert, and a wrong element is never highlighted', async ({ page }) => {
      await page.goto(url);
      const ed = await edition(page);
      await stub(page, ed, timed(ed));
      await page.goto(url);
      const id = ed.ids[2], blocks = ed.blocks[id];
      await open(page, id);
      await expect.poll(async () => (await step(page, { id, time: 0.5, event: 'timeupdate' })).count).toBe(1);
      // The Listen control is marked, and so is nothing that was in the static HTML
      expect(await page.locator('main .listen:not([data-inserted])').count()).toBe(0);
      expect(await page.locator('main [data-inserted]:not(.listen)').count()).toBe(0);
      // Marked insertions in front of every level of every path change nothing
      const added = await page.evaluate(i => {
        let n = 0;
        document.querySelectorAll(`[id="${i}"] *`).forEach(el => {
          if (/^(DIV|FIGURE|TBODY|UL|OL)$/.test(el.tagName) && el.firstElementChild && !el.closest('[data-inserted], [data-narrate-skip]')) {
            const extra = document.createElement(el.tagName === 'TBODY' ? 'tr' : /^(UL|OL)$/.test(el.tagName) ? 'li' : 'div');
            extra.setAttribute('data-inserted', '');
            extra.textContent = 'Inserted by a script';
            el.prepend(extra);
            n++;
          }
        });
        return n;
      }, id);
      expect(added).toBeGreaterThan(4);
      const seen = await steps(page, blocks.map((block, k) => ({ id, block, time: k * 10 + 0.5, event: 'timeupdate' })));
      for (let k = 0; k < blocks.length; k++) {
        expect(seen[k].key, `#${id} block ${k}`).toBe(blocks[k][1]);
        expect(seen[k].isWanted, `#${id} block ${k}, with marked insertions in front of it`).toBe(true);
      }
      // An unmarked insertion shifts the paths under it. The prefix no longer matches, so nothing is highlighted.
      await page.evaluate(i => {
        const extra = document.createElement('p');
        extra.textContent = 'Something a script forgot to mark';
        document.querySelector(`[id="${i}"] .head`)!.prepend(extra);
      }, id);
      const inHead = blocks.map((_, k) => k).filter(k => blocks[k][0].length === 3 && blocks[k][0][0] === 0 && blocks[k][0][1] === 0);
      expect(inHead.length).toBeGreaterThan(1);
      for (const k of inHead) {
        const s = await step(page, { id, time: k * 10 + 0.5, event: 'timeupdate' });
        expect(s.count, `#${id} block ${k}: nothing, rather than the wrong element`).toBe(0);
      }
    });

    test('playback with the real manifest: the highlight follows the cues and the page does not move', async ({ page, issues }) => {
      test.setTimeout(90_000);
      await page.goto(url);
      await settled(page);
      const ed = await edition(page);
      // A recorded section whose cues fit its blocks. A new edition has none until tools/cues.py has run.
      const id = ed.ids.slice(1).find(i => {
        const e = ed.manifest?.sections[i];
        return !!e && !!e.file && Array.isArray(e.cues) && e.cues.length >= 6 && e.cues.length === ed.blocks[i].length;
      })!;
      test.skip(!id, 'no section of this edition has cues yet');
      const cues = ed.manifest!.sections[id].cues as number[], blocks = ed.blocks[id];
      expect(cues[0]).toBe(0);
      expect([...cues].sort((a, b) => a - b), 'cues never decrease').toEqual(cues);

      await page.locator(`[id="${id}"] .head`).scrollIntoViewIfNeeded();
      const btn = page.locator(`[id="${id}"] .listen > button`);
      await expect(page.locator('.reading')).toHaveCount(0);
      await btn.click();   // the real control and the real recording
      if (await page.evaluate(() => !!document.createElement('audio').canPlayType('audio/mpeg')))
        await expect(page.locator('.reading'), 'the first block lights up when the narration starts').toHaveCount(1);
      await hold(page, id);
      await step(page, { id, time: 0, event: 'play', real: true });
      await expect.poll(async () => (await step(page, { id, block: blocks[0], time: 0.05, event: 'timeupdate', real: true })).isWanted, { message: 'the first block' }).toBe(true);
      // From here on, count every scroll event on the page and remember where focus is
      await page.waitForTimeout(250);
      await page.evaluate(() => { (window as any).__scrolls = 0; (window as any).__focus = document.activeElement; });
      const start = await step(page, { id });

      // Several cue times, spread over the section. Just after each one its block is highlighted, just before
      // it the block before: one element at a time, and neither the scroll position nor the page height changes.
      const n = cues.length;
      const picks = [...new Set([1, 2, Math.floor(n / 3), Math.floor(n / 2), Math.floor(2 * n / 3), n - 2, n - 1])].filter(k => k > 0 && k < n);
      expect(picks.length).toBeGreaterThanOrEqual(4);
      const last = (t: number) => cues.reduce((best, c, k) => (c <= t ? k : best), 0);
      const seen: string[] = [];
      for (const k of picks) {
        for (const t of [cues[k] - 0.05, cues[k] + 0.05]) {
          const want = last(t);
          const s = await step(page, { id, block: blocks[want], time: t, event: 'timeupdate', real: true });
          const where = `#${id} at ${t.toFixed(2)} s (cue ${k})`;
          expect(s.count, `${where}: a single highlight`).toBe(1);
          expect(s.isWanted, `${where}: block ${want} "${blocks[want][1]}" (it is ${s.litTag} "${s.litKey}")`).toBe(true);
          expect(s.scrollY, `${where}: the page did not scroll`).toBe(start.scrollY);
          expect(s.height, `${where}: the page is as tall as it was`).toBe(start.height);
          seen.push(s.litKey!);
        }
      }
      expect(new Set(seen).size, 'the highlight moved through several elements').toBeGreaterThanOrEqual(4);

      // Seeking moves it too, a pause keeps it, the end of the recording clears it
      const mid = cues[picks[Math.floor(picks.length / 2)]] + 0.05;
      expect((await step(page, { id, block: blocks[last(mid)], time: mid, event: 'seeking', real: true })).isWanted, 'seeking').toBe(true);
      expect((await step(page, { id, block: blocks[last(mid)], event: 'pause' })).isWanted, 'a pause keeps the highlight').toBe(true);
      expect((await step(page, { id, event: 'ended' })).count, 'ended clears it').toBe(0);
      expect((await step(page, { id, event: 'timeupdate' })).count, 'and it stays clear until it plays again').toBe(0);
      const back = await step(page, { id, block: blocks[last(mid)], event: 'play' });
      expect(back.isWanted, 'playing again brings it back').toBe(true);
      // Through all of it nothing scrolled, anywhere on the page, and focus stayed where the reader put it
      expect(back.scrollY).toBe(start.scrollY);
      expect(back.scrolls, 'scroll events').toBe(0);
      expect(back.sameFocus, 'focus').toBe(true);

      // Closing the player clears it, and a late event from the closed player changes nothing
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.reading')).toHaveCount(0);
      expect((await step(page, { id, time: cues[2] + 0.05, event: 'timeupdate', real: true })).count).toBe(0);
      expect(issues.console, 'console errors').toEqual([]);
      expect(issues.failed, 'failed requests').toEqual([]);
    });

    test('one highlight at a time: another player takes it, and the playlist carries it from section to section', async ({ page }) => {
      await page.goto(url);
      const ed = await edition(page);
      await stub(page, ed, timed(ed));
      await page.goto(url);
      const [hero, a, b] = ed.ids;
      await open(page, a);
      await expect.poll(async () => (await step(page, { id: a, block: ed.blocks[a][1], time: 10.5, event: 'timeupdate' })).isWanted).toBe(true);
      // Another section's player starts: the highlight is now its block
      await open(page, b);
      await expect.poll(async () => (await step(page, { id: b, block: ed.blocks[b][2], time: 20.5, event: 'timeupdate' })).isWanted).toBe(true);
      expect(await page.locator(`[id="${a}"] .reading`).count()).toBe(0);
      expect(await page.locator('.reading').count()).toBe(1);
      // A late event from the first player does not take it back while the second one is playing
      const playing = (id: string, on: boolean) => page.evaluate(([i, yes]) => {
        const au = document.querySelector(`[id="listen-${i}-panel"] audio`) as any;
        if (yes) Object.defineProperty(au, 'paused', { configurable: true, get: () => false }); else delete au.paused;
      }, [id, on] as const);
      await playing(b, true);
      await step(page, { id: a, time: 30.5, event: 'timeupdate' });
      expect((await step(page, { id: b, block: ed.blocks[b][2] })).isWanted).toBe(true);
      await playing(b, false);

      // The hero playlist starts with the hero; Next section moves the highlight into the next section
      await page.locator('#listen-all-btn').click();
      await hold(page, '@all');
      await step(page, { id: '@all', time: 0, event: 'play' });
      await expect.poll(async () => { await step(page, { id: '@all', time: 10.5, event: 'timeupdate' }); return page.locator(`[id="${hero}"] .reading`).count(); }).toBe(1);
      expect(await page.locator('.reading').count()).toBe(1);
      await page.locator('#listen-next').click();
      await hold(page, '@all');
      await step(page, { id: '@all', time: 0, event: 'play' });
      await expect.poll(async () => { await step(page, { id: '@all', time: 10.5, event: 'timeupdate' }); return page.locator(`[id="${a}"] .reading`).count(); }).toBe(1);
      expect((await step(page, { id: a, block: ed.blocks[a][1] })).isWanted).toBe(true);
      // When the playlist ends a section it moves on, and closing it clears the highlight
      await step(page, { id: '@all', event: 'ended' });
      await hold(page, '@all');
      await step(page, { id: '@all', time: 0, event: 'play' });
      await expect.poll(async () => { await step(page, { id: '@all', time: 0.5, event: 'timeupdate' }); return page.locator(`[id="${b}"] .reading`).count(); }).toBe(1);
      expect(await page.locator('.reading').count()).toBe(1);
      await page.locator('#listen-all-btn').click();
      await expect(page.locator('.reading')).toHaveCount(0);
    });

    test('no highlight and no error when the cues do not fit the blocks', async ({ page, issues }) => {
      await page.goto(url);
      const ed = await edition(page);
      const [none, short, long, broken, empty] = ed.ids.slice(1, 6);
      const entry = (id: string, cues?: unknown) => ({ file: `${id}.mp3`, sha256: '0'.repeat(64), duration: 60, ...(cues === undefined ? {} : { cues }) });
      await stub(page, ed, {
        [none]: entry(none),                                                     // recorded before there were cues
        [short]: entry(short, ed.blocks[short].slice(1).map((_, i) => i * 10)),  // one cue too few
        [long]: entry(long, [...ed.blocks[long], 0].map((_, i) => i * 10)),      // one too many
        [broken]: entry(broken, 'soon'),                                         // not a list
        [empty]: entry(empty, []),
      });
      await page.goto(url);
      await expect(page.locator('main .listen')).toHaveCount(5);
      for (const id of [none, short, long, broken, empty]) {
        await open(page, id);
        for (const time of [0.5, 10.5, 25]) {
          await step(page, { id, time, event: 'timeupdate' });
          await page.waitForTimeout(150);   // long enough for a blocks file to arrive
          expect(await page.locator('.reading').count(), `#${id} at ${time} s`).toBe(0);
        }
        await step(page, { id, event: 'seeked' });
        expect((await step(page, { id, event: 'ended' })).count).toBe(0);
      }
      expect(issues.console, 'console errors').toEqual([]);
      expect(issues.failed, 'failed requests').toEqual([]);
    });

    test('the highlight is a tint that changes no layout, and it is not printed', async ({ page }) => {
      await page.goto(url);
      const ed = await edition(page);
      await stub(page, ed, timed(ed));
      await page.goto(url);
      await settled(page);
      // A section with a narrated table
      const id = (await page.evaluate(ids => ids.find(i => document.querySelector(`[id="${i}"] .tbl:not([data-narrate-skip]):not(.print-only) tbody tr`)), ed.ids.slice(1)))!;
      const blocks = ed.blocks[id];
      // Where everything in the section is, in page coordinates (an element without a box has no place)
      const boxes = () => page.evaluate(i => [...document.querySelectorAll(`[id="${i}"] :is(p, li, h2, h3, tr, td, figcaption, figure)`)]
        .map(el => { const r = el.getBoundingClientRect(); return r.width || r.height ? [r.x, r.y + scrollY, r.width, r.height].map(v => Math.round(v * 10) / 10).join(' ') : 'no box'; }), id);
      const before = await boxes();
      await open(page, id);
      await expect.poll(async () => (await step(page, { id, time: 0.5, event: 'timeupdate' })).count).toBe(1);
      await step(page, { id, event: 'ended' });
      const open_ = await boxes();   // the player's panel takes room; the highlight must not
      await step(page, { id, event: 'play' });
      const tags = (await steps(page, blocks.map(block => ({ id, block })))).map(s => s.tag!);
      const row = tags.indexOf('tr'), para = tags.findIndex((t, k) => t === 'p' && k > 2);
      expect(row, 'a table row among the blocks').toBeGreaterThan(0);
      for (const k of [1, para, row, row + 1].filter(k => k > 0 && k < blocks.length)) {
        const s = await step(page, { id, block: blocks[k], time: k * 10 + 0.5, event: 'timeupdate' });
        expect(s.isWanted, `block ${k}`).toBe(true);
        expect(await boxes(), `nothing moves when block ${k} (${tags[k]}) is highlighted`).toEqual(open_);
        const look = await page.locator('.reading').evaluate(el => {
          const cell = getComputedStyle(el.tagName === 'TR' ? el.children[0] : el);
          return { tint: cell.backgroundColor, page: getComputedStyle(document.body).backgroundColor };
        });
        expect(look.tint, `block ${k} (${tags[k]}) is tinted`).not.toBe('rgba(0, 0, 0, 0)');
        expect(look.tint).not.toBe(look.page);
      }
      expect(tags[row]).toBe('tr');
      await step(page, { id, block: blocks[row], time: row * 10 + 0.5, event: 'timeupdate' });
      // In print the highlight is not painted: not on the row, not on its cells
      const painted = () => page.locator('.reading').evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow, getComputedStyle(el.children[0]).backgroundColor].join(' | '));
      expect(await painted()).not.toBe('rgba(0, 0, 0, 0) | none | rgba(0, 0, 0, 0)');
      await page.emulateMedia({ media: 'print' });
      expect(await painted()).toBe('rgba(0, 0, 0, 0) | none | rgba(0, 0, 0, 0)');
      await page.emulateMedia({ media: 'screen' });
      // The short fade is only for readers who have not asked for less motion, here or in the site's own switch
      const fade = () => page.locator('.reading').evaluate(el => getComputedStyle(el).transitionDuration + ' / ' + getComputedStyle(el.children[0]).transitionDuration);
      expect(await fade()).toBe('0s / 0s');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      expect(await fade()).toBe('0.25s, 0.25s / 0.25s, 0.25s');
      await page.evaluate(() => document.documentElement.classList.add('motion-paused'));
      expect(await fade()).toBe('0s / 0s');
      await page.evaluate(() => document.documentElement.classList.remove('motion-paused'));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Closing the player leaves the section exactly as it was before anything played
      await page.locator(`[id="${id}"] .listen > button`).click();
      await expect(page.locator('.reading')).toHaveCount(0);
      expect(await boxes()).toEqual(before);
    });

    test('no serious or critical axe violation with the highlight showing, in both themes', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'axe runs once, in the chromium project');
      test.setTimeout(240_000);
      await page.goto(url);
      const ed = await edition(page);
      await stub(page, ed, timed(ed));
      const serious = async (include: string, rules?: string[]) => {
        const axe = new AxeBuilder({ page }).include(include);
        const r = await (rules ? axe.withRules(rules) : axe.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])).analyze();
        return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
          .flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`));
      };
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url);
        await settled(page);
        // 1. The page's own highlight on the kinds of element it lands on: muted text, citations, chips, links,
        //    a caption, a table row, a list item
        const id = ed.ids[2], blocks = ed.blocks[id];
        await open(page, id);
        await expect.poll(async () => (await step(page, { id, time: 0.5, event: 'timeupdate' })).count).toBe(1);
        const kinds = await page.evaluate(i => {
          const sec = document.getElementById(i)!;
          const pick = (sel: string) => { const el = sec.querySelector(sel); return el && (el.closest('tr') || el.closest('p, li, figcaption') || el); };
          return [pick('.head .eyebrow'), pick('.head .lede'), pick('.prose p a.c'), pick('.prose p .chip'), pick('figcaption'), pick('.tbl tbody tr'), pick('.tbl tbody tr .chip'), pick('li')]
            .filter(Boolean).map(el => (el!.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16));
        }, id);
        const ks = [...new Set(kinds.map(key => blocks.findIndex(b => b[1] === key)).filter(k => k >= 0))];
        expect(ks.length, 'kinds of highlighted element checked').toBeGreaterThanOrEqual(3);
        for (const k of ks) {
          const s = await step(page, { id, block: blocks[k], time: k * 10 + 0.5, event: 'timeupdate' });
          expect(s.isWanted, `block ${k}`).toBe(true);
          expect(await serious('.reading'), `${scheme}: #${id} block ${k} (${s.litTag} "${s.litKey}")`).toEqual([]);
        }
        await step(page, { id, event: 'ended' });
        // 2. The same class on every narrated element at once (the test adds it), so that every text, link and
        //    label that can end up on the tint is checked for contrast, the one rule a tint can break
        const marked = await page.evaluate(all => {
          const how = document.getElementById('howto') as HTMLDetailsElement | null;
          if (how) how.open = true;
          let n = 0;
          for (const [sid, list] of Object.entries(all)) {
            const sec = document.getElementById(sid)!;
            for (const [path] of list as [number[], string][]) {
              let el: Element | null | undefined = sec;
              for (const i of path) el = el && [...el.children].filter(c => !c.hasAttribute('data-inserted'))[i];
              while (el && el !== sec && !(el as any).checkVisibility()) el = el.parentElement;
              if (el && el !== sec) { el.classList.add('reading'); n++; }
            }
          }
          return n;
        }, ed.blocks);
        expect(marked).toBeGreaterThan(100);
        expect(await serious('main', ['color-contrast']), `${scheme}: every narrated element highlighted`).toEqual([]);
      }
    });
  });
}
