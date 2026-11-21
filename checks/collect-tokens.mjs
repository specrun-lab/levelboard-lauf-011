// Verbrauch pro Level aus den Claude-Code-Session-Protokollen (~/.claude/projects/**/*.jsonl).
// Regeln: spec/05-datenmodell.md, „Verbrauch pro Level“.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_DIR = path.join(process.env.HOME || os.homedir(), '.claude', 'projects');

// USD pro Million Tokens: [Eingabe, Cache 5 min, Cache 1 h, Cache lesen, Ausgabe]
export const PRICES = {
  'claude-opus-5-5': [4, 5, 8, 0.2, 20],
  'claude-sonnet-5-5': [2, 2.5, 4, 0.1, 10],
  'claude-haiku-5-5': [0.1, 0.125, 0.2, 0.01, 0.5],
};
const HAIKU_LONG = [0.5, 0.625, 1, 0.05, 2.5];

function listJsonl(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsonl(p));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out.sort();
}

const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function textOf(line) {
  const c = line?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && typeof b.text === 'string') return b.text;
        if (b && typeof b.content === 'string') return b.content;
        if (b && Array.isArray(b.content)) return b.content.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n');
        return '';
      })
      .join('\n');
  }
  return '';
}

/** Liest alle Protokolle: Antworten, Befehle und Ausgaben. */
export function readLogs(dir = DEFAULT_DIR) {
  const responses = [];
  const seen = new Set();
  const commands = new Map();
  const outputs = [];
  for (const file of listJsonl(dir)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const l of raw.split('\n')) {
      if (!l.trim()) continue;
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        continue;
      }
      if (!o || typeof o !== 'object') continue;
      if (o.type === 'assistant' && o.message && typeof o.message === 'object') {
        const msg = o.message;
        if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b && b.type === 'tool_use' && b.name === 'Bash' && typeof b.id === 'string') {
              const cmd = b.input && typeof b.input.command === 'string' ? b.input.command : '';
              if (!commands.has(b.id)) commands.set(b.id, cmd);
            }
          }
        }
        if (msg.usage && typeof msg.usage === 'object') {
          const id = msg.id;
          if (id !== undefined && id !== null) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          if (msg.model === '<synthetic>') continue;
          const t = Date.parse(o.timestamp);
          if (Number.isNaN(t)) continue;
          responses.push({ t, model: msg.model, usage: msg.usage });
        }
      } else if (o.type === 'user') {
        const t = Date.parse(o.timestamp);
        if (Number.isNaN(t)) continue;
        const tur = o.toolUseResult;
        if (tur && typeof tur === 'object' && ('stdout' in tur || 'stderr' in tur)) {
          const content = Array.isArray(o.message?.content) ? o.message.content : [];
          const tr = content.find((b) => b && b.type === 'tool_result');
          if (tr && typeof tr.tool_use_id === 'string') {
            const text = `${tur.stdout ?? ''}\n${tur.stderr ?? ''}`;
            outputs.push({ t, id: tr.tool_use_id, text });
          }
          continue;
        }
        const text = textOf(o);
        if (text.includes('<task-notification>')) {
          const m = text.match(/<tool-use-id>([^<]*)<\/tool-use-id>/);
          if (m) outputs.push({ t, id: m[1].trim(), text });
        }
      }
    }
  }
  responses.sort((a, b) => a.t - b.t);
  outputs.sort((a, b) => a.t - b.t);
  return { responses, commands, outputs };
}

/** Höchstes n, für das „Level 1: bestanden“ … „Level n: bestanden“ alle im Text vorkommen. */
export function reachedInText(text) {
  let n = 0;
  while (text.includes(`Level ${n + 1}: bestanden`)) n++;
  return n;
}

/** Phasengrenzen aus den Ausgaben von `make check`. */
export function boundaries(logs) {
  const out = [];
  let best = 0;
  for (const o of logs.outputs) {
    const cmd = logs.commands.get(o.id);
    if (typeof cmd !== 'string' || !/make\s+check\b/.test(cmd)) continue;
    const n = reachedInText(o.text);
    if (n > best) {
      out.push({ t: o.t, from: best + 1, to: n });
      best = n;
    }
  }
  return out;
}

function priceFor(model, usage) {
  if (model === 'claude-haiku-5-5') {
    const prompt = n0(usage.input_tokens) + n0(usage.cache_creation_input_tokens) + n0(usage.cache_read_input_tokens);
    return prompt > 100000 ? HAIKU_LONG : PRICES[model];
  }
  const p = PRICES[model];
  if (!p) throw new Error(`Unbekanntes Modell ohne Preis: ${model}`);
  return p;
}

/** Token-Objekt für eine Liste von Antworten; `start` ist der Beginn der Phase (ms). */
export function tokenObject(resps, start) {
  const models = new Set();
  let input = 0, cw5 = 0, cw1 = 0, cr = 0, out = 0, cost = 0;
  for (const r of resps) {
    const u = r.usage;
    const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
    const i = n0(u.input_tokens);
    const w5 = cc ? n0(cc.ephemeral_5m_input_tokens) : n0(u.cache_creation_input_tokens);
    const w1 = cc ? n0(cc.ephemeral_1h_input_tokens) : 0;
    const rd = n0(u.cache_read_input_tokens);
    const o = n0(u.output_tokens);
    const p = priceFor(r.model, u);
    cost += (i * p[0] + w5 * p[1] + w1 * p[2] + rd * p[3] + o * p[4]) / 1e6;
    input += i; cw5 += w5; cw1 += w1; cr += rd; out += o;
    if (typeof r.model === 'string') models.add(r.model);
  }
  const first = resps[0];
  const last = resps[resps.length - 1];
  return {
    models: [...models].sort(),
    responses: resps.length,
    input,
    cacheWrite5m: cw5,
    cacheWrite1h: cw1,
    cacheRead: cr,
    output: out,
    total: input + cw5 + cw1 + cr + out,
    costUsd: Math.round(cost * 100) / 100,
    from: first ? new Date(first.t).toISOString() : null,
    until: last ? new Date(last.t).toISOString() : null,
    buildS: last && start !== null && start !== undefined ? Math.round((last.t - start) / 1000) : 0,
  };
}

function normCurrent(current) {
  if (Array.isArray(current)) {
    return current
      .map((c, i) => (Array.isArray(c) ? { level: c[0], status: c[1] } : typeof c === 'string' ? { level: i + 1, status: c } : c))
      .sort((a, b) => a.level - b.level);
  }
  return Object.entries(current || {})
    .map(([k, v]) => ({ level: Number(k), status: v }))
    .sort((a, b) => a.level - b.level);
}

/**
 * Verbrauch je Level.
 * @param current Status je geprüftem Level dieses Laufs, aufsteigend:
 *   [{level, status}] oder {1: 'bestanden', …}
 * @returns Objekt Level → Token-Objekt oder { inLevel: n } (nur geprüfte Levels)
 */
export function levelTokens(current, dir = DEFAULT_DIR) {
  const logs = readLogs(dir);
  const cur = normCurrent(current);
  const result = {};
  if (logs.responses.length === 0) return result;

  const bounds = boundaries(logs);
  const all = {};
  let prevT = null;
  const firstT = logs.responses[0].t;
  for (const b of bounds) {
    const resps = logs.responses.filter((r) => (prevT === null || r.t > prevT) && r.t <= b.t);
    all[b.to] = tokenObject(resps, prevT === null ? firstT : prevT);
    for (let k = b.from; k < b.to; k++) all[k] = { inLevel: b.to };
    prevT = b.t;
  }
  const best = bounds.length ? bounds[bounds.length - 1].to : 0;

  // laufende Phase
  const running = logs.responses.filter((r) => prevT === null || r.t > prevT);
  const start = prevT === null ? firstT : prevT;
  let curReached = 0;
  for (const c of cur) {
    if (c.level === curReached + 1 && c.status === 'bestanden') curReached++;
    else break;
  }
  const failed = cur.find((c) => c.status === 'fehlgeschlagen');
  if (curReached > best) {
    all[curReached] = tokenObject(running, start);
    for (let k = best + 1; k < curReached; k++) all[k] = { inLevel: curReached };
    if (failed && failed.level > curReached) all[failed.level] = tokenObject([], null);
  } else if (failed && failed.level > best) {
    all[failed.level] = tokenObject(running, start);
  }

  for (const c of cur) {
    if (all[c.level]) result[c.level] = all[c.level];
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Aufruf: node collect-tokens.mjs [<n> …] – zeigt den Verbrauch für „Level 1…n bestanden“
  const levels = process.argv.slice(2).map(Number);
  const cur = levels.map((l) => ({ level: l, status: 'bestanden' }));
  console.log(JSON.stringify(levelTokens(cur), null, 2));
}
