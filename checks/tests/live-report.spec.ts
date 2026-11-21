import { test, expect } from '@playwright/test';
import { buildTime, dec1, isOwn, sums, usd } from './format';

const LIVE = (process.env.LIVE_URL || '').replace(/\/+$/, '');

test.describe('live-bericht', () => {
  test('Live-Seite zeigt den gemeldeten Abschlussbericht', async ({ page, request }) => {
    test.setTimeout(120_000);
    const res = await request.get(`${LIVE}/api/levels`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    for (const l of data.levels) {
      expect(l.status, `Level ${l.level}`).toBe('bestanden');
      expect(l.metrics.tokens, `tokens Level ${l.level}`).toBeTruthy();
    }
    const lv = (n: number) => data.levels.find((l: any) => l.level === n);
    expect(lv(6).metrics.pipeline).toBeTruthy();
    expect(lv(7).metrics.images).toBeTruthy();
    expect(lv(9).metrics.loadtest).toBeTruthy();

    await page.goto(`${LIVE}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    await expect(page.getByTestId('report')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('summary-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-score')).toHaveText('100 / 100');
    await expect(page.getByTestId('report-commit')).toHaveText(String(data.run.commit).slice(0, 7));
    const s = sums(data.levels.map((l: any) => l.metrics.tokens).filter(isOwn));
    await expect(page.getByTestId('report-cost')).toHaveText(usd(s.cost));
    await expect(page.getByTestId('report-build-time')).toHaveText(s.build === null ? '–' : buildTime(s.build));
    await expect(page.getByTestId('report-p95')).toHaveText(`${lv(9).metrics.loadtest.p95Ms} ms`);
    await expect(page.getByTestId('report-image-backend')).toHaveText(`${dec1(lv(7).metrics.images.backendMB)} MB`);
    await expect(page.getByTestId('report-pipeline-total')).toHaveText(`${lv(6).metrics.pipeline.totalS} s`);
    const items = page.getByTestId('report-level');
    await expect(items).toHaveCount(10);
    await expect(page.locator('[data-testid="report-level"][data-status="bestanden"]')).toHaveCount(10);
  });
});
