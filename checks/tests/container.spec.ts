import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { root } from './gh';

function compose(args: string[]): string {
  return execFileSync('docker', ['compose', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
}

async function firstJs(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/')).text();
  const m = html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/);
  expect(m).not.toBeNull();
  return m![1];
}

test.describe('container', () => {
  test.describe.configure({ mode: 'serial' });

  test('Seite läuft im Container und liest aus dem Backend', async ({ page, request }) => {
    expect(await (await request.get('/config.json')).json()).toEqual({ source: 'api' });
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
  });

  test('/api/ wird an den Backend-Container weitergeleitet', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/json');
    expect((await res.json()).status).toBe('ok');
    expect((await request.get('/api/unbekannt')).status()).toBe(404);
  });

  test('Meldung erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const res = await request.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Container-Probe', ok: true }], durationMs: 4242 },
    });
    expect(res.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
  });

  test('Daten überstehen einen Neustart des Backend-Containers', async ({ request }) => {
    test.setTimeout(120_000);
    const before = await (await request.get('/api/levels/1/history?limit=500')).json();
    expect(before.entries.length).toBeGreaterThan(0);
    compose(['restart', 'backend']);
    const deadline = Date.now() + 60_000;
    let ok = false;
    while (Date.now() < deadline) {
      try {
        const r = await request.get('/api/health', { timeout: 2000 });
        if (r.status() === 200) {
          ok = true;
          break;
        }
      } catch {
        // noch nicht bereit
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(ok, '/api/health nach Neustart').toBe(true);
    const after = await (await request.get('/api/levels/1/history?limit=500')).json();
    expect(after).toEqual(before);
  });

  test('Cache- und gzip-Regeln gelten im Container', async ({ request }) => {
    const index = await request.get('/', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(index.headers()['cache-control']).toBe('no-cache');
    expect(index.headers()['content-encoding']).toBe('gzip');
    expect(index.headers()['server']).toBe('nginx');
    const js = await request.get(await firstJs(request));
    expect(js.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request.get('/config.json')).headers()['cache-control']).toBe('no-store');
    expect((await request.get('/gibt-es-nicht.json')).status()).toBe(404);
  });

  test('Backend-Container läuft nicht als root', async () => {
    const uid = compose(['exec', '-T', 'backend', 'id', '-u']).trim();
    expect(uid).not.toBe('0');
    expect(uid).toMatch(/^\d+$/);
  });
});
