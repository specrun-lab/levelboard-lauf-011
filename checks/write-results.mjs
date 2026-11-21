// Schreibt das Ergebnis der Prüfsuite nach frontend/dist/results.json
// und meldet es optional an das Backend (REPORT_API=1) und die Live-API (REPORT_LIVE=1).
// Aufruf: node write-results.mjs <level> [<level> …]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { levelTokens } from './collect-tokens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const reportFile = path.join(here, '.out', 'playwright.json');
const resultsFile = path.join(root, 'frontend', 'dist', 'results.json');
const loadtestFile = path.join(here, '.out', 'loadtest.json');

const levels = process.argv
  .slice(2)
  .map((a) => Number(a))
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10)
  .sort((a, b) => a - b);
if (levels.length === 0) {
  console.error('Aufruf: node write-results.mjs <level> [<level> …]');
  process.exit(2);
}

// 1. Playwright-Report lesen
let report;
try {
  report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
} catch (e) {
  console.error(`Playwright-Report nicht lesbar: ${reportFile} (${e.message})`);
  process.exit(1);
}

// 2. Checks je Level sammeln
function collect(suites, out) {
  for (const s of suites || []) {
    const m = /^level-(\d+)$/.exec(s.title || '');
    if (m) {
      const n = Number(m[1]);
      out[n] ??= { checks: [], duration: 0 };
      gatherSpecs(s, out[n]);
    } else {
      collect(s.suites, out);
    }
  }
}
function gatherSpecs(suite, acc) {
  for (const spec of suite.specs || []) {
    const tests = spec.tests || [];
    const ok =
      spec.ok === true && tests.length > 0 && tests.every((t) => t.status === 'expected' || t.status === 'flaky');
    acc.checks.push({ name: spec.title, ok });
    for (const t of tests) for (const r of t.results || []) acc.duration += r.duration || 0;
  }
  for (const s of suite.suites || []) gatherSpecs(s, acc);
}
const found = {};
collect(report.suites, found);
for (const n of levels) {
  if (!found[n] || found[n].checks.length === 0) {
    console.error(`Keine Checks für Level ${n} im Report gefunden.`);
    process.exit(1);
  }
}

// 3. ausgelieferte results.json lesen
let data;
try {
  data = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
} catch (e) {
  console.error(`results.json nicht lesbar: ${resultsFile} (${e.message})`);
  process.exit(1);
}

// 4./5. Status setzen
const now = new Date().toISOString();
const min = levels[0];
let failed = false;
const checked = []; // { level, status }
for (const lv of data.levels.sort((a, b) => a.level - b.level)) {
  if (lv.level < min) continue;
  if (levels.includes(lv.level) && !failed) {
    const f = found[lv.level];
    const pass = f.checks.every((c) => c.ok);
    lv.status = pass ? 'bestanden' : 'fehlgeschlagen';
    lv.checkedAt = now;
    lv.durationMs = Math.round(f.duration);
    lv.checks = f.checks;
    lv.metrics = {};
    checked.push({ level: lv.level, status: lv.status });
    if (!pass) failed = true;
  } else {
    lv.status = failed ? 'gesperrt' : 'offen';
    lv.checkedAt = null;
    lv.durationMs = null;
    lv.checks = [];
    lv.metrics = {};
  }
}

// Kennzahlen
const byLevel = Object.fromEntries(data.levels.map((l) => [l.level, l]));
try {
  const tokens = levelTokens(checked);
  if (Object.keys(tokens).length === 0) console.log('Kennzahl tokens: kein Session-Protokoll gefunden');
  for (const [k, v] of Object.entries(tokens)) {
    const lv = byLevel[k];
    if (lv && (lv.status === 'bestanden' || lv.status === 'fehlgeschlagen')) lv.metrics.tokens = v;
  }
} catch (e) {
  console.log(`Kennzahl tokens nicht ermittelt: ${e.message}`);
}

function headSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

if (byLevel[6]?.status === 'bestanden') {
  try {
    const { pipelineOf } = await import('./collect-report.mjs');
    byLevel[6].metrics.pipeline = pipelineOf(process.env.GITHUB_REPO, headSha());
  } catch (e) {
    console.log(`Kennzahl pipeline nicht ermittelt: ${e.message}`);
  }
}
if (byLevel[7]?.status === 'bestanden') {
  try {
    const { imageSizeMB } = await import('./collect-report.mjs');
    const repo = process.env.GITHUB_REPO;
    const sha = headSha();
    byLevel[7].metrics.images = {
      frontendMB: await imageSizeMB(`${repo}-frontend`, sha),
      backendMB: await imageSizeMB(`${repo}-backend`, sha),
    };
  } catch (e) {
    console.log(`Kennzahl images nicht ermittelt: ${e.message}`);
  }
}
if (byLevel[9]?.status === 'bestanden') {
  try {
    byLevel[9].metrics.loadtest = JSON.parse(fs.readFileSync(loadtestFile, 'utf8'));
  } catch (e) {
    console.log(`Kennzahl loadtest nicht ermittelt: ${e.message}`);
  }
}

// 6./7. Laufdaten setzen und schreiben
data.run.updatedAt = now;
if (process.env.RUN_ID) data.run.id = process.env.RUN_ID;
fs.writeFileSync(resultsFile, JSON.stringify(data, null, 2) + '\n');

// 8. Ausgabe
for (const n of levels) {
  const lv = byLevel[n];
  const total = lv.checks.length;
  const okCount = lv.checks.filter((c) => c.ok).length;
  console.log(total > 0 ? `Level ${n}: ${lv.status} (${okCount}/${total} Checks)` : `Level ${n}: ${lv.status}`);
}

let exitCode = failed ? 1 : 0;

// Meldungen an Backend und Live-API
async function reportTo(base, label) {
  for (const n of levels) {
    const lv = byLevel[n];
    if (lv.status !== 'bestanden' && lv.status !== 'fehlgeschlagen') break;
    const body = JSON.stringify({ checks: lv.checks, durationMs: lv.durationMs, metrics: lv.metrics });
    let status = 0;
    let text = '';
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/levels/${n}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(30000),
      });
      status = res.status;
      text = await res.text();
    } catch (e) {
      text = e.message;
    }
    if (status !== 200) {
      console.log(`Meldung an ${label} für Level ${n} fehlgeschlagen: ${status} ${text}`.trim());
      return false;
    }
    console.log(`Level ${n} an ${label} gemeldet`);
    if (lv.status === 'fehlgeschlagen') break;
  }
  return true;
}

if (process.env.REPORT_API === '1') {
  const ok = await reportTo(process.env.API_URL || 'http://127.0.0.1:8081', 'das Backend');
  if (!ok) exitCode = 1;
  if (ok && process.env.REPORT_LIVE === '1') {
    const live = process.env.LIVE_URL;
    if (!live) {
      console.log('Meldung an die Live-API für Level 1 fehlgeschlagen: 0 LIVE_URL fehlt');
      exitCode = 1;
    } else if (!(await reportTo(live, 'die Live-API'))) {
      exitCode = 1;
    }
  }
}

process.exit(exitCode);
