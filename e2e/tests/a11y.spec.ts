import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/* Accessibility: axe-core WCAG 2.x A/AA rules, failing on serious or critical issues.
   Runs in chromium only (axe results do not depend on the engine and the pass is slow).
   If a live violation cannot be fixed right away, record it as a test.fixme naming the rule and
   element rather than excluding it here. */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function serious(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(TAGS);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .flatMap(v => v.nodes.map(n => ({ rule: v.id, impact: v.impact, target: n.target.join(' '), summary: n.failureSummary })));
}

test.describe('accessibility', () => {
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'chromium', 'axe runs once, in the chromium project'));
  test.describe.configure({ timeout: 90_000 });

  for (const scheme of ['light', 'dark'] as const) {
    for (const url of ['/state-of-voice-agents/', '/state-of-voice-agents/editions/2026-10/']) {
      test(`${url} has no serious or critical axe violations (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        const found = await serious(page);
        expect(found, JSON.stringify(found, null, 2)).toEqual([]);
      });
    }

    test(`filtered views have no serious or critical axe violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/state-of-voice-agents/');
      await page.locator('#vf button[data-f="u"]').click();
      await page.locator('#sf button[data-f="ven"]').click();
      await page.locator('#howto summary').click();
      const found = await serious(page, 'main');
      expect(found, JSON.stringify(found, null, 2)).toEqual([]);
    });

    test(`Explore menu and PDF dialog have no serious or critical axe violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/state-of-voice-agents/');
      await page.locator('#pdf-open').click();
      await expect(page.locator('#pdf-dlg')).toBeVisible();
      const pdf = await serious(page, '#pdf-dlg');
      expect(pdf, JSON.stringify(pdf, null, 2)).toEqual([]);
      await page.locator('#pdf-cancel').click();
      await page.locator('#exploreBtn').click();
      await expect(page.locator('dialog.xpm')).toBeVisible();
      const menu = await serious(page, 'dialog.xpm');
      expect(menu, JSON.stringify(menu, null, 2)).toEqual([]);
    });
  }
});
