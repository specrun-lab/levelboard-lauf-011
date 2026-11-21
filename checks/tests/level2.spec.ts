import { test, expect, type APIRequestContext } from '@playwright/test';

async function firstJs(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/')).text();
  const m = html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/);
  expect(m, 'JS-Datei unter /assets/ in index.html').not.toBeNull();
  return m![1];
}

test.describe('level-2', () => {
  test('Antwort kommt von nginx', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['server']).toBe('nginx');
  });

  test('results.json wird nicht zwischengespeichert', async ({ request }) => {
    const res = await request.get('/results.json');
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
  });

  test('index.html wird nicht zwischengespeichert', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['cache-control']).toBe('no-cache');
  });

  test('Assets werden ein Jahr zwischengespeichert', async ({ request }) => {
    const js = await firstJs(request);
    const res = await request.get(js);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('Fehlende Datei ergibt 404', async ({ request }) => {
    const res = await request.get('/gibt-es-nicht.json');
    expect(res.status()).toBe(404);
  });

  test('Antworten sind gzip-komprimiert', async ({ request }) => {
    const js = await firstJs(request);
    for (const p of ['/', js, '/results.json']) {
      const res = await request.get(p, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(res.status(), p).toBe(200);
      expect(res.headers()['content-encoding'], p).toBe('gzip');
    }
  });

  test('Seite funktioniert über nginx', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('level-card')).toHaveCount(10);
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});
