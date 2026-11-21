// Typen, Laden, Prüfen, Auswerten, Formatieren

export type Status = 'offen' | 'bestanden' | 'fehlgeschlagen' | 'gesperrt';
export const STATUSES: Status[] = ['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt'];

export const STATUS_LABEL: Record<Status, string> = {
  offen: 'Offen',
  bestanden: 'Bestanden',
  fehlgeschlagen: 'Fehlgeschlagen',
  gesperrt: 'Gesperrt',
};

export const TITLES: string[] = [
  'Statische Seite',
  'Webserver',
  'REST-Backend',
  'Datenbank',
  'Frontend + Backend',
  'Repo + CI',
  'Images in der Pipeline',
  'Deployment',
  'Live-Prüfung',
  'Metriken veröffentlicht',
];

export interface Check {
  name: string;
  ok: boolean;
}

export interface Level {
  level: number;
  title: string;
  status: Status;
  checkedAt: string | null;
  durationMs: number | null;
  checks: Check[];
  metrics: Record<string, unknown>;
}

export interface Run {
  id: string;
  version: string;
  commit: string | null;
  updatedAt: string | null;
}

export interface Results {
  run: Run;
  levels: Level[];
}

export type LoadState = 'loading' | 'ok' | 'missing' | 'invalid' | 'unavailable';
export type Source = 'file' | 'api' | null;

export interface TokenObject {
  models: string[];
  responses: number;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  total: number;
  costUsd: number;
  from: string | null;
  until: string | null;
  buildS?: number;
}

// ---------- Prüfen ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasExactKeys(o: Record<string, unknown>, keys: string[]): boolean {
  const k = Object.keys(o);
  if (k.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(o, key));
}

function isDateOrNull(v: unknown): boolean {
  if (v === null) return true;
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function isCheck(v: unknown): v is Check {
  return (
    isObject(v) &&
    hasExactKeys(v, ['name', 'ok']) &&
    typeof v.name === 'string' &&
    v.name.length > 0 &&
    typeof v.ok === 'boolean'
  );
}

function isLevel(v: unknown): v is Level {
  if (!isObject(v)) return false;
  if (!hasExactKeys(v, ['level', 'title', 'status', 'checkedAt', 'durationMs', 'checks', 'metrics'])) return false;
  if (typeof v.level !== 'number' || !Number.isInteger(v.level) || v.level < 1 || v.level > 10) return false;
  if (typeof v.title !== 'string') return false;
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status as Status)) return false;
  if (!isDateOrNull(v.checkedAt)) return false;
  if (v.durationMs !== null) {
    if (typeof v.durationMs !== 'number' || !Number.isInteger(v.durationMs) || v.durationMs < 0) return false;
  }
  if (!Array.isArray(v.checks) || !v.checks.every(isCheck)) return false;
  if (!isObject(v.metrics)) return false;
  return true;
}

export function validate(data: unknown): Results | null {
  if (!isObject(data) || !hasExactKeys(data, ['run', 'levels'])) return null;
  const run = data.run;
  if (!isObject(run) || !hasExactKeys(run, ['id', 'version', 'commit', 'updatedAt'])) return null;
  if (typeof run.id !== 'string' || run.id.length === 0) return null;
  if (typeof run.version !== 'string' || run.version.length === 0) return null;
  if (run.commit !== null && typeof run.commit !== 'string') return null;
  if (!isDateOrNull(run.updatedAt)) return null;
  const levels = data.levels;
  if (!Array.isArray(levels) || levels.length !== 10) return null;
  if (!levels.every(isLevel)) return null;
  const nums = new Set((levels as Level[]).map((l) => l.level));
  if (nums.size !== 10) return null;
  const sorted = [...(levels as Level[])].sort((a, b) => a.level - b.level);
  return { run: run as unknown as Run, levels: sorted };
}

// ---------- Laden ----------

function isHtml(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

export async function loadSource(): Promise<'file' | 'api'> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok || isHtml(res)) return 'file';
    const data: unknown = await res.json();
    return isObject(data) && data.source === 'api' ? 'api' : 'file';
  } catch {
    return 'file';
  }
}

export interface LoadResult {
  state: Exclude<LoadState, 'loading'>;
  data: Results | null;
}

export async function loadFile(): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch('/results.json', { cache: 'no-store' });
  } catch {
    return { state: 'missing', data: null };
  }
  if (res.status === 404) return { state: 'missing', data: null };
  if (res.ok && isHtml(res)) return { state: 'missing', data: null };
  if (!res.ok) return { state: 'invalid', data: null };
  return parseBody(res);
}

export async function loadApi(): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch('/api/levels', { cache: 'no-store' });
  } catch {
    return { state: 'unavailable', data: null };
  }
  if (!res.ok || isHtml(res)) return { state: 'unavailable', data: null };
  return parseBody(res);
}

async function parseBody(res: Response): Promise<LoadResult> {
  let data: unknown;
  try {
    data = JSON.parse(await res.text());
  } catch {
    return { state: 'invalid', data: null };
  }
  const v = validate(data);
  return v ? { state: 'ok', data: v } : { state: 'invalid', data: null };
}

// ---------- Auswerten ----------

export function emptyLevels(): Level[] {
  return TITLES.map((title, i) => ({
    level: i + 1,
    title,
    status: 'offen' as Status,
    checkedAt: null,
    durationMs: null,
    checks: [],
    metrics: {},
  }));
}

export function reachedLevel(levels: Level[]): number {
  let n = 0;
  for (const l of levels) {
    if (l.status === 'bestanden' && l.level === n + 1) n++;
    else break;
  }
  return n;
}

export type TokensEntry = { kind: 'own'; t: TokenObject } | { kind: 'in'; n: number } | null;

export function tokensOf(level: Level): TokensEntry {
  const t = level.metrics.tokens;
  if (!isObject(t)) return null;
  if (typeof t.inLevel === 'number') return { kind: 'in', n: t.inLevel };
  return { kind: 'own', t: t as unknown as TokenObject };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface TokenSum {
  models: string[];
  responses: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  total: number;
  costUsd: number;
  buildS: number | null;
  count: number;
}

export function sumTokens(levels: Level[]): TokenSum {
  const models = new Set<string>();
  const s: TokenSum = {
    models: [], responses: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0, costUsd: 0, buildS: 0, count: 0,
  };
  let buildMissing = false;
  for (const l of levels) {
    const e = tokensOf(l);
    if (!e || e.kind !== 'own') continue;
    const t = e.t;
    s.count++;
    if (Array.isArray(t.models)) for (const m of t.models) if (typeof m === 'string') models.add(m);
    s.responses += num(t.responses);
    s.input += num(t.input);
    s.cacheWrite += num(t.cacheWrite5m) + num(t.cacheWrite1h);
    s.cacheRead += num(t.cacheRead);
    s.output += num(t.output);
    s.total += num(t.total);
    s.costUsd += num(t.costUsd);
    if (typeof t.buildS === 'number') s.buildS = (s.buildS ?? 0) + t.buildS;
    else buildMissing = true;
  }
  if (buildMissing || s.count === 0) s.buildS = null;
  s.costUsd = Math.round(s.costUsd * 100) / 100;
  s.models = [...models].sort();
  return s;
}

// ---------- Formatieren ----------

export const DASH = '–';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return DASH;
  const d = new Date(t);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export function formatChecks(checks: Check[]): string {
  if (checks.length === 0) return DASH;
  return `${checks.filter((c) => c.ok).length}/${checks.length}`;
}

export function formatBuildS(s: number | null | undefined): string {
  if (typeof s !== 'number' || !Number.isFinite(s)) return DASH;
  const r = Math.round(s);
  if (r < 60) return `${r} s`;
  return `${Math.floor(r / 60)}:${pad2(r % 60)} min`;
}

export function formatUsd(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} USD`;
}

export function formatInt(v: number): string {
  return v.toLocaleString('de-CH');
}

export function formatDec1(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

export function levelCode(n: number): string {
  return `L${pad2(n)}`;
}

export function cardBuildTime(e: TokensEntry): string {
  if (!e) return DASH;
  if (e.kind === 'in') return `in ${levelCode(e.n)}`;
  return formatBuildS(e.t.buildS);
}

export function cardCost(e: TokensEntry): string {
  if (!e) return DASH;
  if (e.kind === 'in') return `in ${levelCode(e.n)}`;
  return typeof e.t.costUsd === 'number' ? formatUsd(e.t.costUsd) : DASH;
}

export function cardOutput(e: TokensEntry): string {
  if (!e || e.kind === 'in') return DASH;
  return typeof e.t.output === 'number' ? formatInt(e.t.output) : DASH;
}

export function shortCommit(c: string | null | undefined): string {
  return c ? c.slice(0, 7) : DASH;
}
