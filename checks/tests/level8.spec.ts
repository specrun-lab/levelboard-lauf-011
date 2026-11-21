import { test, expect } from '@playwright/test';
import { head, jobOf, latestRun } from './gh';

const LIVE = (process.env.LIVE_URL || '').replace(/\/+$/, '');

test.describe('level-8', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job deploy des letzten Laufs ist grün', async () => {
    const run = latestRun();
    expect(run, 'CI-Lauf für HEAD').toBeTruthy();
    const job = jobOf(run.id, 'deploy');
    expect(job, 'Job deploy').toBeTruthy();
    expect(job.conclusion).toBe('success');
  });

  test('Live-Seite antwortet über HTTPS', async ({ page, request }) => {
    expect(LIVE.startsWith('https://')).toBe(true);
    const res = await request.get(`${LIVE}/`);
    expect(res.status()).toBe(200);
    await page.goto(`${LIVE}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
  });

  test('Live-Seite meldet den aktuellen Commit', async ({ page, request }) => {
    const sha = head();
    const res = await request.get(`${LIVE}/api/health`);
    expect(res.status()).toBe(200);
    expect((await res.json()).commit).toBe(sha);
    await page.goto(`${LIVE}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    await expect(page.getByTestId('run-commit')).toHaveText(sha.slice(0, 7));
  });

  test('Live-Seite zeigt die Ergebnisse der Pipeline', async ({ request }) => {
    const res = await request.get(`${LIVE}/api/levels`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe(process.env.RUN_ID);
    for (let n = 1; n <= 5; n++) {
      expect(body.levels.find((l: any) => l.level === n).status, `Level ${n}`).toBe('bestanden');
    }
  });
});
