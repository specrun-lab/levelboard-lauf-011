// Meldet die Ergebnisse aus einer results.json an eine (Live-)API.
// Aufruf: node report-live.mjs <results.json> <basis-url>
import fs from 'node:fs';

const [file, baseArg] = process.argv.slice(2);
if (!file || !baseArg) {
  console.error('Aufruf: node report-live.mjs <results.json> <basis-url>');
  process.exit(2);
}
const base = baseArg.replace(/\/+$/, '');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const levels = [...data.levels].sort((a, b) => a.level - b.level);

let reported = 0;
for (const l of levels) {
  if ((l.status !== 'bestanden' && l.status !== 'fehlgeschlagen') || !Array.isArray(l.checks) || l.checks.length === 0) break;
  let status = 0;
  let text = '';
  try {
    const res = await fetch(`${base}/api/levels/${l.level}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks: l.checks, durationMs: l.durationMs }),
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    text = e.message;
  }
  if (status < 200 || status >= 300) {
    console.error(`Meldung für Level ${l.level} fehlgeschlagen: ${status} ${text}`);
    process.exit(1);
  }
  reported++;
  console.log(`Level ${l.level} an ${base} gemeldet (${l.status})`);
  if (l.status === 'fehlgeschlagen') break;
}
if (reported === 0) {
  console.error('Nichts gemeldet.');
  process.exit(1);
}
