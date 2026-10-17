import { test, expect, type Page } from './fixtures';

/* The report's interactive pieces: the header theme button, source and claim filters, citations, the
   Download PDF dialog, the charts and tools tagged "Interactive", Ask Bolt and comments. */

const PAGE = '/state-of-voice-agents/';

const vis = (page: Page, sel: string) =>
  page.locator(sel).evaluateAll(els => els.filter(e => !(e as HTMLElement).hidden).map(e => (e as HTMLElement).dataset.v ?? (e as HTMLElement).dataset.t));

test('the header theme button switches scheme, saves only a choice that differs from the system, and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(PAGE);
  const html = page.locator('html'), btn = page.locator('.md-header #themeBtn');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  expect(await bg()).toBe('rgb(246, 247, 249)');
  await expect(btn).toHaveAttribute('aria-label', 'Switch to Deep Space (dark) scheme');

  await btn.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).toBe('rgb(15, 18, 24)');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /#0F1218/i);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(btn).toHaveAttribute('aria-label', 'Switch to Daybreak (light) scheme');

  // Back to the system scheme: nothing saved, the page follows the system again
  await btn.click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  expect(await bg()).toBe('rgb(246, 247, 249)');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg()).toBe('rgb(15, 18, 24)');
});

test('sources filter shows independent or vendor sources only', async ({ page }) => {
  await page.goto(PAGE);
  const total = await page.locator('#src li').count();
  expect(total).toBeGreaterThan(50);
  for (const f of ['ind', 'ven']) {
    await page.locator(`#sf button[data-f="${f}"]`).click();
    await expect(page.locator(`#sf button[data-f="${f}"]`)).toHaveAttribute('aria-pressed', 'true');
    const shown = await vis(page, '#src li');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(total);
    expect(new Set(shown)).toEqual(new Set([f]));
  }
  await page.locator('#sf button[data-f="all"]').click();
  expect((await vis(page, '#src li')).length).toBe(total);
});

test('claim check filter shows one verdict at a time', async ({ page }) => {
  await page.goto(PAGE);
  const total = await page.locator('#claims tr').count();
  expect(total).toBeGreaterThan(10);
  for (const f of ['v', 'p', 'u']) {
    await page.locator(`#vf button[data-f="${f}"]`).click();
    const shown = await vis(page, '#claims tr');
    expect(shown.length, `verdict ${f}`).toBeGreaterThan(0);
    expect(new Set(shown)).toEqual(new Set([f]));
    await expect(page.locator('#claims tr:not([hidden])').first()).toBeVisible();
  }
  await page.locator('#vf button[data-f="all"]').click();
  expect((await vis(page, '#claims tr')).length).toBe(total);
});

test('a citation jumps to its numbered source', async ({ page }) => {
  await page.goto(PAGE);
  const cite = page.locator('main a.c[href^="#src-"]:not(.tbl a)').first();
  const href = await cite.getAttribute('href');
  expect(href).toMatch(/^#src-/);
  await cite.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  const src = page.locator(href!);
  await expect(src).toBeInViewport();
  await expect(src.locator('.i')).toHaveText(await cite.innerText());
});

test('every citation is visible and tappable, including inside tables', async ({ page }) => {
  // On phones the tables stack into label and value columns. Citations stay inline after their text
  // (a grid used to make each one its own zero-height grid item in the label column), and every
  // citation gets at least a 24x24 px tap target (WCAG 2.2 target size). Desktop keeps the small superscript.
  await page.goto(PAGE);
  const phone = (page.viewportSize()?.width ?? 1280) <= 760;
  const min = phone ? 24 : 1;
  const small = await page.locator('main a.c').evaluateAll((as, min) => as
    .filter(a => { const b = a.getBoundingClientRect(); return b.width < min || b.height < min; })
    .map(a => `${a.closest('section')?.id}: ${a.textContent} (${(a as HTMLElement).dataset.s})`), min);
  expect(small, `${small.length} citations are smaller than ${min}x${min} px`).toEqual([]);
  if (phone) {
    // A table citation sits in the value column, to the right of the label, not under it
    const misplaced = await page.locator('.tbl td a.c').evaluateAll(as => as
      .filter(a => { const td = a.closest('td')!; const label = parseFloat(getComputedStyle(td).paddingLeft); return a.getBoundingClientRect().right < td.getBoundingClientRect().left + label; })
      .map(a => a.textContent));
    expect(misplaced, 'citations in the label column').toEqual([]);
  }
});

test('Download PDF: dialog opens, closes (Cancel, Esc, backdrop) and prints in the chosen theme', async ({ page }) => {
  // Stub window.print: record the theme the page is in when the print dialog would open
  await page.addInitScript(() => {
    (window as any).__printed = [];
    window.print = () => { (window as any).__printed.push(document.documentElement.getAttribute('data-theme')); };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(PAGE);
  const open = page.locator('#pdf-open'), dlg = page.locator('#pdf-dlg');

  // Open from the keyboard so focus can return to the button (Safari does not focus buttons on click)
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#pdf-light')).toBeChecked(); // follows the current theme
  await expect(page.locator('#pdf-go')).toBeFocused();
  await expect(page.locator('#pdf-frame')).toBeHidden();
  await page.locator('#pdf-cancel').click();
  await expect(dlg).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  await open.click();
  await page.mouse.click(3, 3); // the dimmed backdrop
  await expect(dlg).toBeHidden();

  await open.click();
  await page.locator('label.opt-r', { has: page.locator('#pdf-dark') }).click();
  await page.locator('#pdf-go').click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toEqual(['dark']);
  // The page goes back to the visitor's own setting afterwards
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('reliability chart: sort and select a platform', async ({ page }) => {
  await page.goto(PAGE);
  const rows = page.locator('#db .db-row');
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText('Retell'); // highest pass^3
  await page.locator('#gap .seg button[data-sort="lat"]').click();
  await expect(rows.first()).toContainText('ElevenLabs'); // fastest turn time
  await page.locator('#db .db-row', { hasText: 'Gemini Live' }).click();
  await expect(page.locator('#db .db-row', { hasText: 'Gemini Live' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#db-detail')).toContainText('Gemini Live: of 82 scenarios');
});

test('economics calculator: presets and sliders update the outputs', async ({ page }) => {
  await page.goto(PAGE);
  const save = page.locator('#t-save');
  const base = await save.textContent();
  await page.locator('#calc-ctrls [data-preset="cons"]').click();
  await expect(page.locator('#calc-ctrls [data-preset="cons"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(save).not.toHaveText(base!);
  await expect(page.locator('#scen .sc')).toHaveCount(3);
  await page.locator('#c-calls').fill('60000');
  await expect(page.locator('#o-calls')).toHaveText((60000).toLocaleString('en-US'));
  await expect(page.locator('#calc-ctrls [data-preset="cons"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#res-chart path')).toHaveCount(2);
});

test('router demo: utterances and threshold change the verdict', async ({ page }) => {
  await page.goto(PAGE);
  const verdict = page.locator('#rverdict .verdict');
  // Default: the multi-intent example at threshold 0.75; neither intent clears it, so hand off
  await expect(page.locator('#o-th')).toHaveText('0.75');
  await expect(verdict).toHaveClass(/v-fb/);
  await page.locator('#r-th').fill('0.65');
  await expect(page.locator('#o-th')).toHaveText('0.65');
  await expect(verdict).toHaveClass(/v-multi/);
  await page.locator('#utts .utt', { hasText: 'chest has been hurting' }).click();
  await expect(verdict).toHaveClass(/v-esc/);
  await page.locator('#utts .utt', { hasText: 'about the thing from before' }).click();
  await expect(verdict).toHaveClass(/v-fb/);
  await page.locator('#utts .utt', { hasText: 'charged twice' }).click();
  await expect(verdict).toHaveClass(/v-go/);
  await expect(verdict).toContainText('Route to Billing & payments sub-agent');
  await page.locator('#r-th').fill('0.95');
  await expect(verdict).toHaveClass(/v-fb/);
});

test('thinker-responder, memory, options, personas, use cases, pilot and latency tools respond', async ({ page }) => {
  await page.goto(PAGE);
  // Thinker-responder vs one LLM
  const other = page.locator('#tr-mode button:not([aria-pressed="true"])').first();
  await other.click();
  await expect(page.locator('#tr-note')).toContainText('filler');
  // Limited-memory demo: delete the record
  await page.locator('#lm-del').click();
  await expect(page.locator('#lm-del')).toHaveText('Restore record');
  await expect(page.locator('#lm-note')).toContainText('Rows deleted');
  // Options
  await page.locator('#opts .opt').first().click();
  await expect(page.locator('#opts .opt').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#opt-detail')).toContainText('Strong for the pilot itself.');
  // Personas
  await page.locator('#personas .persona', { hasText: 'CFO' }).click();
  await expect(page.locator('#pdetail')).toContainText('Fund a pilot, not a platform.');
  // Use cases
  await page.locator('#ucg .uc', { hasText: 'Nurse triage lines' }).click();
  await expect(page.locator('#uc-detail')).toContainText('Not yet');
  // After the pilot
  await page.locator('#after-mode button[data-o="stop"]').click();
  await expect(page.locator('#after')).toContainText('Kill criterion hit');
  // Latency budget presets
  const total = page.locator('#lat-total');
  const seq = await total.textContent();
  await page.locator('#t-latency .seg button[data-lp="fd"]').click();
  await expect(total).not.toHaveText(seq!);
  await expect(total).toHaveText('0.72 s');
  // pass^k
  await page.locator('#pk-p').fill('90');
  await expect(page.locator('#o-pk')).toHaveText('90.0%');
  await expect(page.locator('#pk .col')).toHaveCount(5);
});

test('"How to read this report" opens', async ({ page }) => {
  await page.goto(PAGE);
  const howto = page.locator('#howto');
  await howto.locator('summary').click();
  await expect(howto).toHaveAttribute('open', '');
});

test('Ask Bolt is switched off: no launcher, no panel, no backend calls', async ({ page }) => {
  // Bolt is paused (BOLT_ENABLED = false; worker/README.md). Its worker would call the Claude API
  // (paid), so no test ever sends it a question. Any request to a workers.dev host fails this test.
  const backend: string[] = [];
  page.on('request', r => { if (/workers\.dev|api\.anthropic\.com/.test(r.url())) backend.push(r.url()); });
  await page.goto(PAGE);
  await expect(page.locator('#bolt-open')).toBeHidden();
  await expect(page.locator('#bolt-panel')).toBeHidden();
  await page.waitForLoadState('networkidle');
  expect(backend).toEqual([]);
});

test('comments load from utterances near the end of the page', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('iframe.utterances-frame')).toHaveCount(0); // lazy until scrolled near
  await page.locator('#comments').scrollIntoViewIfNeeded();
  const frame = page.locator('iframe.utterances-frame');
  await expect(frame).toBeAttached({ timeout: 20_000 });
  expect(await frame.getAttribute('src')).toMatch(/^https:\/\/utteranc\.es\/utterances\.html\?/);
  expect(await frame.getAttribute('src')).toContain('repo=sbmadhav%2Fstate-of-voice-agents');
});
