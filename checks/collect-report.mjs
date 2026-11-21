// Kennzahlen aus GitHub: Pipeline-Dauer (Level 6) und Image-Größen (Level 7).
import { execFileSync } from 'node:child_process';

function ghApi(path) {
  const out = execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  return JSON.parse(out);
}

const secs = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;

/** Lauf von CI für sha auf main: { runId, url, jobs, totalS } */
export function pipelineOf(repo, sha) {
  if (!repo) throw new Error('GITHUB_REPO fehlt');
  const runs = ghApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`);
  const run = runs.workflow_runs?.[0];
  if (!run) throw new Error(`kein CI-Lauf für ${sha}`);
  const jobsResp = ghApi(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
  const jobs = {};
  let latest = null;
  for (const j of jobsResp.jobs || []) {
    if (!j.started_at || !j.completed_at) continue;
    jobs[j.name] = Math.round(secs(j.started_at, j.completed_at));
    if (latest === null || Date.parse(j.completed_at) > Date.parse(latest)) latest = j.completed_at;
  }
  const totalS = latest ? Math.round(secs(run.run_started_at, latest)) : 0;
  return { runId: run.id, url: run.html_url, jobs, totalS };
}

const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export async function ghcrToken(name) {
  const res = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
  if (!res.ok) throw new Error(`Token für ${name}: HTTP ${res.status}`);
  const j = await res.json();
  if (!j.token) throw new Error(`kein Token für ${name}`);
  return j.token;
}

async function manifest(name, ref, token) {
  const res = await fetch(`https://ghcr.io/v2/${name}/manifests/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  });
  if (!res.ok) throw new Error(`Manifest ${name}:${ref}: HTTP ${res.status}`);
  return res.json();
}

/** Größe des Images ghcr.io/<name>:<tag> in MB (Summe der Layer, 1 Nachkommastelle). */
export async function imageSizeMB(name, tag) {
  const token = await ghcrToken(name);
  let m = await manifest(name, tag, token);
  if (Array.isArray(m.manifests)) {
    const entry = m.manifests.find((x) => x.platform?.os === 'linux' && x.platform?.architecture === 'amd64');
    if (!entry) throw new Error(`kein linux/amd64 in ${name}:${tag}`);
    m = await manifest(name, entry.digest, token);
  }
  if (!Array.isArray(m.layers)) throw new Error(`keine Layer in ${name}:${tag}`);
  const bytes = m.layers.reduce((s, l) => s + (l.size || 0), 0);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
