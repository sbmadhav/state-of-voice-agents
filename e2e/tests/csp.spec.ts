import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from './fixtures';

/* Content-Security-Policy. Every page (the report and each edition) carries a static
   <meta http-equiv="Content-Security-Policy"> that allows only the origins it uses: Google Fonts,
   utterances comments and GoatCounter beacons. These tests use each page the way a reader does and
   fail on any securitypolicyviolation event. */

const REPO = path.resolve(__dirname, '..', '..');
const PAGES = ['/state-of-voice-agents/', ...readdirSync(path.join(REPO, 'editions'))
  .filter(d => existsSync(path.join(REPO, 'editions', d, 'index.html'))).sort()
  .map(d => `/state-of-voice-agents/editions/${d}/`)];

async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
      w.__csp.push(`${e.effectiveDirective || e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
    });
  });
  const console: string[] = [];
  page.on('console', m => { if (/Content.Security.Policy|Refused to/i.test(m.text())) console.push(m.text()); });
  return { console, list: () => page.evaluate(() => (window as any).__csp as string[]) };
}

for (const url of PAGES) {
  test(`${url} carries the policy and runs with no violations`, async ({ page }) => {
    test.setTimeout(60_000);
    const v = await watchViolations(page);
    await page.goto(url, { waitUntil: 'load' });
    const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(meta).toHaveCount(1);
    const csp = (await meta.getAttribute('content'))!;
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/'unsafe-eval'|gc\.zgo\.at/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin');

    // The inline scripts ran (sources list, charts) and the controls work
    await expect(page.locator('#src li').first()).toBeAttached();
    await page.locator('#theme button[data-t="dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#db .db-row').nth(1).click();
    await page.locator('#pdf-open').click();
    await page.locator('#pdf-cancel').click();
    await page.locator('#exploreBtn').click();
    await expect(page.locator('dialog.xpm')).toBeVisible();
    await page.keyboard.press('Escape');

    // Comments: utterances loads its script and frame when the section comes near
    await page.locator('#comments').scrollIntoViewIfNeeded();
    await expect(page.locator('iframe.utterances-frame')).toBeAttached({ timeout: 20_000 });
    await expect.poll(() => page.frames().some(f => /utteranc\.es/.test(f.url()))).toBe(true);

    // GoatCounter as the shared analytics.js uses it (analytics is off on localhost): the main site's
    // count.js, then one request of each kind its beacon uses. The fixtures answer them locally.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/assets/count.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('count.js did not load'));
      document.head.appendChild(s);
    }));
    await page.evaluate(() => {
      navigator.sendBeacon('https://sbmadhav.goatcounter.com/count?e2e=csp');
      new Image().src = 'https://sbmadhav.goatcounter.com/count?e2e=csp-img';
    });
    await page.waitForTimeout(2000);
    expect(await v.list(), 'securitypolicyviolation events').toEqual([]);
    expect(v.console, 'CSP console messages').toEqual([]);
  });
}

test('the policy blocks a script from another origin (negative control)', async ({ page }) => {
  const v = await watchViolations(page);
  await page.goto(PAGES[0], { waitUntil: 'load' });
  await page.evaluate(() => { const s = document.createElement('script'); s.src = 'https://example.com/x.js'; document.body.appendChild(s); });
  await expect.poll(async () => (await v.list()).join(' ')).toMatch(/script-src/);
});
