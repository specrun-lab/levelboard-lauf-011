import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, head, root } from './gh';
import { pipelineOf, imageSizeMB } from '../collect-report.mjs';
import { levelTokens } from '../collect-tokens.mjs';
import { buildTime, cardValues, dec1, int, isOwn, sums, usd } from './format';

const LIVE = (process.env.LIVE_URL || '').replace(/\/+$/, '');
const outDir = path.join(root, 'checks', '.out');
const berichtFile = path.join(outDir, 'bericht.json');

function readBericht() {
  return JSON.parse(fs.readFileSync(berichtFile, 'utf8'));
}

async function openWith(page: Page, mutate: (levels: any[]) => void) {
  await page.route('**/api/levels', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    mutate(body.levels);
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`${LIVE}/`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
}

test.describe('level-10', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Alle Teile des Berichts sind vorhanden', async () => {
    const sha = head();
    const pipeline = pipelineOf(REPO, sha);
    for (const j of ['check', 'images', 'deploy']) expect(pipeline.jobs[j], `Job ${j}`).toBeGreaterThan(0);
    const images = {
      frontendMB: await imageSizeMB(`${REPO}-frontend`, sha),
      backendMB: await imageSizeMB(`${REPO}-backend`, sha),
    };
    expect(images.frontendMB).toBeGreaterThan(0);
    expect(images.backendMB).toBeGreaterThan(0);
    const loadtest = JSON.parse(fs.readFileSync(path.join(outDir, 'loadtest.json'), 'utf8'));
    expect(loadtest.requests).toBeGreaterThan(0);
    const tokens = levelTokens(Array.from({ length: 10 }, (_, i) => ({ level: i + 1, status: 'bestanden' })));
    for (let n = 1; n <= 10; n++) expect(tokens[n], `tokens Level ${n}`).toBeTruthy();
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(berichtFile, JSON.stringify({ pipeline, images, loadtest, tokens }, null, 2) + '\n');
  });

  test('Vollständiger Bericht wird dargestellt', async ({ page }) => {
    const b = readBericht();
    const now = new Date().toISOString();
    await openWith(page, (levels) => {
      for (const l of levels) {
        l.status = 'bestanden';
        l.checkedAt = now;
        l.metrics = { tokens: b.tokens[l.level] };
        if (l.level === 6) l.metrics.pipeline = b.pipeline;
        if (l.level === 7) l.metrics.images = b.images;
        if (l.level === 9) l.metrics.loadtest = b.loadtest;
      }
    });
    const report = page.getByTestId('report');
    await expect(report).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('report-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-complete')).toHaveText('ja');
    const all = Array.from({ length: 10 }, (_, i) => b.tokens[i + 1]);
    const s = sums(all);
    await expect(page.getByTestId('report-cost')).toHaveText(usd(s.cost));
    await expect(page.getByTestId('report-tokens-output')).toHaveText(int(s.output));
    await expect(page.getByTestId('report-build-time')).toHaveText(s.build === null ? '–' : buildTime(s.build));
    await expect(page.getByTestId('report-p95')).toHaveText(`${b.loadtest.p95Ms} ms`);
    await expect(page.getByTestId('report-image-frontend')).toHaveText(`${dec1(b.images.frontendMB)} MB`);
    for (const j of ['check', 'images', 'deploy']) {
      await expect(page.getByTestId(`report-job-${j}`)).toHaveText(`${b.pipeline.jobs[j]} s`);
    }
    await expect(page.getByTestId('report-pipeline-link')).toHaveAttribute('href', b.pipeline.url);
    for (let n = 1; n <= 10; n++) {
      const card = page.locator(`[data-testid="level-card"][data-level="${n}"]`);
      const v = cardValues(b.tokens[n]);
      await expect(card.getByTestId('level-build-time'), `L${n} Bauzeit`).toHaveText(v.build);
      await expect(card.getByTestId('level-cost'), `L${n} Kosten`).toHaveText(v.cost);
      await expect(card.getByTestId('level-output'), `L${n} Ausgabe`).toHaveText(v.output);
    }
  });

  test('Teilbericht zeigt fehlende Teile', async ({ page }) => {
    const b = readBericht();
    const own = Object.values(b.tokens).find(isOwn);
    expect(own, 'ein eigenes Token-Objekt').toBeTruthy();
    const now = new Date().toISOString();
    await openWith(page, (levels) => {
      for (const l of levels) {
        if (l.level <= 2) {
          l.status = 'bestanden';
          l.checkedAt = now;
          l.durationMs = 1000;
          l.checks = [{ name: 'Probe', ok: true }];
          l.metrics = { tokens: own };
        } else {
          l.status = 'offen';
          l.checkedAt = null;
          l.durationMs = null;
          l.checks = [];
          l.metrics = {};
        }
      }
    });
    const report = page.getByTestId('report');
    await expect(report).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('report-reached')).toHaveText('2 / 10');
    await expect(page.getByTestId('report-complete')).toHaveText('nein');
    for (const part of ['pipeline', 'images', 'loadtest']) {
      await expect(page.getByTestId(`report-${part}-missing`)).toHaveText('noch nicht erreicht');
    }
    await expect(page.getByTestId('report-tokens-missing')).toHaveCount(0);
  });
});
