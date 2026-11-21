import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL || 'http://127.0.0.1:8081';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATUSES = ['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt'];

test.describe('level-3', () => {
  test.describe.configure({ mode: 'serial' });

  test('Backend antwortet auf /api/health', async ({ request }) => {
    const res = await request.get(`${API}/api/health`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/json');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['commit', 'status', 'version']);
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.commit).toBeNull();
  });

  test('GET /api/levels liefert alle 10 Levels im Schema', async ({ request }) => {
    const res = await request.get(`${API}/api/levels`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['levels', 'run']);
    expect(body.levels).toHaveLength(10);
    body.levels.forEach((l: { level: number; status: string; checks: unknown }, i: number) => {
      expect(l.level).toBe(i + 1);
      expect(STATUSES).toContain(l.status);
      expect(Array.isArray(l.checks)).toBe(true);
    });
  });

  test('Ergebnis melden setzt Status und Zeitpunkt', async ({ request }) => {
    const res = await request.post(`${API}/api/levels/1/result`, {
      data: { checks: [{ name: 'Probe', ok: true }], durationMs: 10 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const l1 = body.levels[0];
    expect(l1.status).toBe('bestanden');
    expect(Number.isNaN(Date.parse(l1.checkedAt))).toBe(false);
    expect(l1.durationMs).toBe(10);
  });

  test('Fehlschlag sperrt höhere Levels', async ({ request }) => {
    const res = await request.post(`${API}/api/levels/1/result`, {
      data: { checks: [{ name: 'Probe', ok: false }], durationMs: 10 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.levels[0].status).toBe('fehlgeschlagen');
    for (const l of body.levels.slice(1)) expect(l.status).toBe('gesperrt');
  });

  test('Falsche Reihenfolge ergibt 409', async ({ request }) => {
    const res = await request.post(`${API}/api/levels/2/result`, {
      data: { checks: [{ name: 'Probe', ok: true }], durationMs: 10 },
    });
    expect(res.status()).toBe(409);
    expect(typeof (await res.json()).error).toBe('string');
  });

  test('Ungültige Anfragen ergeben 400', async ({ request }) => {
    const bodies = ['{kaputt', JSON.stringify({ durationMs: 1 }), JSON.stringify({ checks: [], durationMs: 1 })];
    for (const b of bodies) {
      const res = await request.post(`${API}/api/levels/1/result`, {
        headers: { 'Content-Type': 'application/json' },
        data: b,
      });
      expect(res.status(), b).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
    }
  });

  test('Unbekanntes Level ergibt 404', async ({ request }) => {
    for (const n of ['0', '11', 'abc']) {
      const res = await request.get(`${API}/api/levels/${n}`);
      expect(res.status(), n).toBe(404);
    }
  });

  test('Go-Tests bestehen', async () => {
    test.setTimeout(120_000);
    execFileSync('go', ['test', '-count=1', './...'], { cwd: path.join(root, 'backend'), stdio: 'pipe' });
  });
});
