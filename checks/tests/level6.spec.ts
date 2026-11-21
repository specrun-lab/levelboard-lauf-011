import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, gh, ghApi, git, head, latestRun } from './gh';

test.describe('level-6', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Repo existiert und ist öffentlich', async () => {
    const repo = ghApi(`repos/${REPO}`);
    expect(repo.full_name).toBe(REPO);
    expect(repo.visibility).toBe('public');
    expect(repo.default_branch).toBe('main');
  });

  test('Lokaler Stand ist gepusht', async () => {
    expect(git(['status', '--porcelain'])).toBe('');
    const branch = ghApi(`repos/${REPO}/branches/main`);
    expect(head()).toBe(branch.commit.sha);
  });

  test('Letzter Pipeline-Lauf ist grün', async () => {
    const run = latestRun();
    expect(run, 'CI-Lauf für HEAD').toBeTruthy();
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
  });

  test('Report enthält Level 1–5 bestanden', async () => {
    const run = latestRun();
    expect(run).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelboard-report-'));
    try {
      gh(['run', 'download', String(run.id), '--repo', REPO, '--name', 'levelboard-report', '--dir', dir]);
      const candidates = [path.join(dir, 'results.json'), path.join(dir, 'frontend', 'dist', 'results.json')];
      const file = candidates.find((f) => fs.existsSync(f));
      expect(file, 'results.json im Artefakt').toBeTruthy();
      const data = JSON.parse(fs.readFileSync(file!, 'utf8'));
      for (let n = 1; n <= 5; n++) {
        const l = data.levels.find((x: any) => x.level === n);
        expect(l.status, `Level ${n}`).toBe('bestanden');
        expect(l.checks.length, `Level ${n} Checks`).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
