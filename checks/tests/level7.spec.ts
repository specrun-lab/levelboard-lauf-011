import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, gh, head, jobOf, latestRun } from './gh';
import { ghcrToken } from '../collect-report.mjs';

const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

function countSpecs(suites: any[]): { total: number; failed: number } {
  let total = 0;
  let failed = 0;
  for (const s of suites || []) {
    for (const spec of s.specs || []) {
      total++;
      const good = spec.ok && (spec.tests || []).every((t: any) => t.status === 'expected' || t.status === 'flaky');
      if (!good) failed++;
    }
    const sub = countSpecs(s.suites);
    total += sub.total;
    failed += sub.failed;
  }
  return { total, failed };
}

test.describe('level-7', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job images des letzten Laufs ist grün', async () => {
    const run = latestRun();
    expect(run, 'CI-Lauf für HEAD').toBeTruthy();
    const job = jobOf(run.id, 'images');
    expect(job, 'Job images').toBeTruthy();
    expect(job.conclusion).toBe('success');
  });

  test('Beide Images liegen öffentlich in der GHCR', async ({ request }) => {
    const sha = head();
    for (const part of ['frontend', 'backend']) {
      const name = `${REPO}-${part}`;
      const token = await ghcrToken(name);
      const res = await request.head(`https://ghcr.io/v2/${name}/manifests/${sha}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
      });
      expect(res.status(), name).toBeGreaterThanOrEqual(200);
      expect(res.status(), name).toBeLessThan(300);
    }
  });

  test('Report der Container-Suite enthält nur bestandene Checks', async () => {
    const run = latestRun();
    expect(run).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelboard-container-'));
    try {
      gh(['run', 'download', String(run.id), '--repo', REPO, '--name', 'levelboard-container-report', '--dir', dir]);
      const file = [path.join(dir, 'playwright.json'), path.join(dir, 'checks', '.out', 'playwright.json')].find((f) =>
        fs.existsSync(f),
      );
      expect(file, 'playwright.json im Artefakt').toBeTruthy();
      const report = JSON.parse(fs.readFileSync(file!, 'utf8'));
      const { total, failed } = countSpecs(report.suites);
      expect(total).toBeGreaterThanOrEqual(6);
      expect(failed).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
