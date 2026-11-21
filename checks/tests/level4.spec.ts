import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const API = process.env.API_URL || 'http://127.0.0.1:8081';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ok = (durationMs: number) => ({ checks: [{ name: 'Probe', ok: true }], durationMs });

test.describe('level-4', () => {
  test.describe.configure({ mode: 'serial' });

  test('Meldungen erscheinen in der Historie, neueste zuerst', async ({ request }) => {
    expect((await request.post(`${API}/api/levels/1/result`, { data: ok(101) })).status()).toBe(200);
    expect((await request.post(`${API}/api/levels/1/result`, { data: ok(102) })).status()).toBe(200);
    const res = await request.get(`${API}/api/levels/1/history`);
    expect(res.status()).toBe(200);
    const h = await res.json();
    expect(h.level).toBe(1);
    expect(h.entries[0].durationMs).toBe(102);
    expect(h.entries[1].durationMs).toBe(101);
    expect(h.entries[0].id).toBeGreaterThan(h.entries[1].id);
    expect(h.entries[0].status).toBe('bestanden');
    expect(h.entries[1].status).toBe('bestanden');
  });

  test('Historie begrenzt mit limit', async ({ request }) => {
    const one = await request.get(`${API}/api/levels/1/history?limit=1`);
    expect(one.status()).toBe(200);
    expect((await one.json()).entries).toHaveLength(1);
    expect((await request.get(`${API}/api/levels/1/history?limit=0`)).status()).toBe(400);
    expect((await request.get(`${API}/api/levels/1/history?limit=501`)).status()).toBe(400);
  });

  test('Daten überstehen einen Neustart des Backends', async ({ request }) => {
    test.setTimeout(90_000);
    const hist = await (await request.get(`${API}/api/levels/1/history?limit=500`)).json();
    const levels = await (await request.get(`${API}/api/levels`)).json();
    execFileSync('make', ['restart-backend'], { cwd: root, stdio: 'pipe', timeout: 80_000 });
    const hist2 = await (await request.get(`${API}/api/levels/1/history?limit=500`)).json();
    const levels2 = await (await request.get(`${API}/api/levels`)).json();
    expect(hist2).toEqual(hist);
    expect(levels2).toEqual(levels);
  });

  test('Abgelehnte Meldungen landen nicht in der Historie', async ({ request }) => {
    const fail = await request.post(`${API}/api/levels/1/result`, {
      data: { checks: [{ name: 'Probe', ok: false }], durationMs: 1 },
    });
    expect(fail.status()).toBe(200);
    const before = (await (await request.get(`${API}/api/levels/2/history?limit=500`)).json()).entries.length;
    const res = await request.post(`${API}/api/levels/2/result`, { data: ok(1) });
    expect(res.status()).toBe(409);
    const after = (await (await request.get(`${API}/api/levels/2/history?limit=500`)).json()).entries.length;
    expect(after).toBe(before);
  });

  test('Datenbank hat das vorgegebene Schema', async () => {
    const db = new DatabaseSync(path.join(root, '.run', 'levelboard.db'), { readOnly: true });
    try {
      const uv = db.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(uv.user_version).toBe(1);
      const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols('levels')).toEqual(['level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics']);
      expect(cols('reports')).toEqual(['id', 'level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics']);
      expect(cols('meta')).toEqual(['key', 'value']);
      const cnt = db.prepare('SELECT COUNT(*) AS n FROM levels').get() as { n: number };
      expect(cnt.n).toBe(10);
    } finally {
      db.close();
    }
  });
});
