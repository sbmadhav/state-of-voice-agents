import { test, expect } from './fixtures';

/* Every link on the rendered report (after its scripts build the sources and claim check):
   - #anchors point at an element that exists,
   - same-origin URLs return 200,
   - external URLs answer from the test runner. Sites that block bots (401/403/429/999, or a
     Cloudflare challenge) and timeouts are soft: annotated, not failed. 404/410, other 4xx,
     5xx and DNS failures fail.
   Runs once (chromium project); external checks are deduped and run 10 at a time. */

const PAGE = '/state-of-voice-agents/';
const SOFT_STATUS = new Set([401, 403, 429, 999]);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

type Check = { url: string; status: number | string; soft?: string };

async function check(url: string): Promise<Check> {
  let last: Check = { url, status: 'no response' };
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, {
        method, redirect: 'follow', signal: AbortSignal.timeout(20_000),
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      });
      r.body?.cancel().catch(() => {});
      last = { url, status: r.status };
      // Many servers reject HEAD; retry those with GET
      if (method === 'HEAD' && r.status >= 400) continue;
      if (r.headers.get('cf-mitigated') === 'challenge') return { ...last, soft: 'Cloudflare bot challenge' };
      if (SOFT_STATUS.has(r.status)) return { ...last, soft: `blocks automated requests (${r.status})` };
      return last;
    } catch (e: any) {
      const code = e?.cause?.code || e?.name || String(e);
      last = { url, status: code };
      if (method === 'GET') {
        if (/Timeout|Abort|ECONNRESET|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT/i.test(code)) return { ...last, soft: `network: ${code}` };
        return last;
      }
    }
  }
  if (typeof last.status === 'number' && SOFT_STATUS.has(last.status)) return { ...last, soft: `blocks automated requests (${last.status})` };
  return last;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function links(page: import('@playwright/test').Page) {
  await page.goto(PAGE);
  await expect(page.locator('#src li').first()).toBeAttached();
  return page.locator('a[href]').evaluateAll(as => as.map(a => ({
    raw: a.getAttribute('href')!,
    abs: (a as HTMLAnchorElement).href,
  })));
}

test.describe('links', () => {
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'chromium', 'link checks run once, in the chromium project'));

  test('every #anchor on the page has a target', async ({ page }) => {
    const all = await links(page);
    const anchors = [...new Set(all.map(l => l.raw).filter(h => h.startsWith('#') && h.length > 1))];
    expect(anchors.length).toBeGreaterThan(50);
    const missing = await page.evaluate(ids => ids.filter(h => !document.getElementById(decodeURIComponent(h.slice(1)))), anchors);
    expect(missing, 'anchors without a target').toEqual([]);
    // Every citation is numbered and points at a listed source
    const cites = await page.locator('a.c').evaluateAll(as => as.map(a => ({ s: (a as HTMLElement).dataset.s, href: a.getAttribute('href'), text: a.textContent })));
    const unresolved = cites.filter(c => !c.href || !/^\[\d+\]$/.test(c.text || ''));
    expect(unresolved, 'citations with no matching source').toEqual([]);
  });

  test('every same-origin link resolves', async ({ page, request, baseURL }) => {
    const all = await links(page);
    const origin = new URL(baseURL!).origin;
    const same = [...new Set(all.map(l => l.abs.split('#')[0])
      .filter(u => u.startsWith(origin) || u.startsWith('https://sbmadhav.com/')))];
    expect(same.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const u of same) {
      const p = new URL(u);
      const r = await request.get(p.pathname + p.search);
      if (r.status() !== 200) bad.push(`${r.status()} ${u}`);
    }
    expect(bad).toEqual([]);
  });

  test('every external link answers', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const all = await links(page);
    const origin = new URL(baseURL!).origin;
    const ext = [...new Set(all.map(l => l.abs.split('#')[0])
      .filter(u => /^https?:/.test(u) && !u.startsWith(origin) && !u.startsWith('https://sbmadhav.com/')))].sort();
    expect(ext.length).toBeGreaterThan(50);
    const results = await pool(ext, 10, check);
    const soft = results.filter(r => r.soft);
    for (const s of soft) testInfo.annotations.push({ type: 'soft link', description: `${s.status} ${s.url} (${s.soft})` });
    const hard = results.filter(r => !r.soft && !(typeof r.status === 'number' && r.status < 400));
    testInfo.annotations.push({ type: 'link summary', description: `${ext.length} external links: ${ext.length - soft.length - hard.length} ok, ${soft.length} soft, ${hard.length} broken` });
    expect(hard.map(h => `${h.status} ${h.url}`), 'broken external links').toEqual([]);
  });
});
