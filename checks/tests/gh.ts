import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO = process.env.GITHUB_REPO || `specrun-lab/levelboard-${process.env.RUN_ID || 'lokal'}`;

export function gh(args: string[]): string {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 100_000 });
}

export function ghApi<T = any>(p: string): T {
  return JSON.parse(gh(['api', p])) as T;
}

export function git(args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function head(): string {
  return git(['rev-parse', 'HEAD']);
}

export function latestRun(): any {
  const r = ghApi(`repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${head()}&per_page=1`);
  return r.workflow_runs?.[0];
}

export function jobOf(runId: number, name: string): any {
  const r = ghApi(`repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`);
  return (r.jobs || []).find((j: any) => j.name === name);
}
