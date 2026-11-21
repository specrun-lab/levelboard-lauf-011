// Lasttest: 10 gleichzeitige Schleifen, 30 s, abwechselnd / und /api/levels.
// Aufruf: node loadtest.mjs <basis-url>
const CONNECTIONS = 10;
const DURATION_S = 30;
const TIMEOUT_MS = 10000;

async function one(url) {
  const t0 = performance.now();
  let error = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    await res.arrayBuffer();
    if (res.status !== 200) error = true;
  } catch {
    error = true;
  }
  return { ms: performance.now() - t0, error };
}

function nearestRank(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[idx - 1];
}

export async function loadtest(base) {
  const b = base.replace(/\/+$/, '');
  const targets = [`${b}/`, `${b}/api/levels`];
  const times = [];
  let errors = 0;
  const start = performance.now();
  const end = start + DURATION_S * 1000;
  async function loop() {
    let i = 0;
    while (performance.now() < end) {
      const r = await one(targets[i % 2]);
      i++;
      times.push(r.ms);
      if (r.error) errors++;
    }
  }
  await Promise.all(Array.from({ length: CONNECTIONS }, loop));
  const elapsedS = (performance.now() - start) / 1000;
  const sorted = [...times].sort((a, b) => a - b);
  return {
    connections: CONNECTIONS,
    durationS: DURATION_S,
    requests: times.length,
    errors,
    rps: Math.round((times.length / elapsedS) * 10) / 10,
    p50Ms: Math.round(nearestRank(sorted, 50)),
    p95Ms: Math.round(nearestRank(sorted, 95)),
    maxMs: Math.round(sorted.length ? sorted[sorted.length - 1] : 0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  if (!base) {
    console.error('Aufruf: node loadtest.mjs <basis-url>');
    process.exit(2);
  }
  console.log(JSON.stringify(await loadtest(base), null, 2));
}
