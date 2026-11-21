import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './gh';
import { loadtest } from '../loadtest.mjs';

const LIVE = (process.env.LIVE_URL || '').replace(/\/+$/, '');

test.describe('level-9', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Live-Seite zeigt Kopfzeile und 10 Karten', async ({ page }) => {
    expect(LIVE.startsWith('https://')).toBe(true);
    await page.goto(`${LIVE}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    await expect(page.getByTestId('run-id')).toHaveText(process.env.RUN_ID || '');
    await expect(page.getByTestId('run-commit')).toHaveText(/^[0-9a-f]{7}$/);
    await expect(page.getByTestId('level-card')).toHaveCount(10);
  });

  test('Cache- und gzip-Regeln gelten live', async ({ request }) => {
    const index = await request.get(`${LIVE}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(index.status()).toBe(200);
    expect(index.headers()['cache-control']).toBe('no-cache');
    expect(index.headers()['content-encoding']).toBe('gzip');
    const m = (await index.text()).match(/(?:src|href)="(\/assets\/[^"]+\.js)"/);
    expect(m, 'JS-Datei unter /assets/').not.toBeNull();
    const js = await request.get(`${LIVE}${m![1]}`);
    expect(js.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request.get(`${LIVE}/config.json`)).headers()['cache-control']).toBe('no-store');
    expect((await request.get(`${LIVE}/gibt-es-nicht.json`)).status()).toBe(404);
  });

  test('Live-API antwortet laut Spec', async ({ request }) => {
    const health = await request.get(`${LIVE}/api/health`);
    expect(health.status()).toBe(200);
    expect(health.headers()['content-type']).toBe('application/json');
    const levels = await request.get(`${LIVE}/api/levels`);
    expect((await levels.json()).levels).toHaveLength(10);
    const nf = await request.get(`${LIVE}/api/levels/0`);
    expect(nf.status()).toBe(404);
    expect(typeof (await nf.json()).error).toBe('string');
    const del = await request.delete(`${LIVE}/api/levels`);
    expect(del.status()).toBe(405);
    expect(del.headers()['allow']).toBe('GET');
    const bad = await request.post(`${LIVE}/api/levels/1/result`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"checks":[]}',
    });
    expect(bad.status()).toBe(400);
    const plain = await request.post(`${LIVE}/api/levels/1/result`, {
      headers: { 'Content-Type': 'text/plain' },
      data: '{"checks":[]}',
    });
    expect(plain.status()).toBe(415);
  });

  test('Meldung erscheint live ohne Neuladen', async ({ page, request }) => {
    await page.goto(`${LIVE}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    const res = await request.post(`${LIVE}/api/levels/1/result`, {
      data: { checks: [{ name: 'Live-Probe', ok: true }], durationMs: 4242 },
    });
    expect(res.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
    const h = await (await request.get(`${LIVE}/api/levels/1/history?limit=1`)).json();
    expect(h.entries[0].checks.map((c: any) => c.name)).toContain('Live-Probe');
  });

  test('Lasttest: 10 Verbindungen, 30 s, ohne Fehler, p95 unter 1 s', async () => {
    const result = await loadtest(LIVE);
    const out = path.join(root, 'checks', '.out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'loadtest.json'), JSON.stringify(result, null, 2) + '\n');
    expect(result.requests).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
    expect(result.p95Ms).toBeLessThan(1000);
  });
});
