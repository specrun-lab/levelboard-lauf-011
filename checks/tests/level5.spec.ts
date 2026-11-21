import { test, expect } from '@playwright/test';

const API = process.env.API_URL || 'http://127.0.0.1:8081';

test.describe('level-5', () => {
  test.describe.configure({ mode: 'serial' });

  test('Seite liest aus dem Backend', async ({ page, request }) => {
    const cfg = await request.get('/config.json');
    expect(await cfg.json()).toEqual({ source: 'api' });
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const src = page.getByTestId('run-source');
    await expect(src).toHaveAttribute('data-source', 'api');
    await expect(src).toHaveText('Backend');
  });

  test('nginx leitet /api/ an das Backend weiter', async ({ request }) => {
    const viaNginx = await request.get('/api/health');
    expect(viaNginx.status()).toBe(200);
    expect(viaNginx.headers()['content-type']).toBe('application/json');
    const direct = await request.get(`${API}/api/health`);
    expect(await viaNginx.json()).toEqual(await direct.json());
    const unknown = await request.get('/api/unbekannt');
    expect(unknown.status()).toBe(404);
    expect(typeof (await unknown.json()).error).toBe('string');
  });

  test('Gemeldetes Ergebnis erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const res = await request.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Probe', ok: true }], durationMs: 4242 },
    });
    expect(res.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
    await expect(card).toHaveAttribute('data-status', 'bestanden', { timeout: 8000 });
  });

  test('Backend-Ausfall wird angezeigt', async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await page.route('**/api/levels', (route) =>
      route.fulfill({ status: 502, contentType: 'text/html', body: '<html><body>502 Bad Gateway</body></html>' }),
    );
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'unavailable', { timeout: 8000 });
    const cards = page.getByTestId('level-card');
    await expect(cards).toHaveCount(10);
    await expect(page.locator('[data-testid="level-card"][data-status="offen"]')).toHaveCount(10);
    await page.unroute('**/api/levels');
    await expect(notice).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
  });

  test('Meldungen über nginx landen in der Historie', async ({ request }) => {
    const res = await request.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Probe über nginx', ok: true }], durationMs: 5151 },
    });
    expect(res.status()).toBe(200);
    const h = await request.get('/api/levels/1/history?limit=1');
    expect(h.status()).toBe(200);
    const body = await h.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].checks).toEqual([{ name: 'Probe über nginx', ok: true }]);
    expect(body.entries[0].durationMs).toBe(5151);
    expect(body.entries[0].status).toBe('bestanden');
  });
});
