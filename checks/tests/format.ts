// Erwartete Anzeigeformate nach spec/06-design.md (unabhängig vom Frontend implementiert).
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const usd = (v: number) => `${v.toFixed(2).replace('.', ',')} USD`;
export const int = (v: number) => v.toLocaleString('de-CH');
export const dec1 = (v: number) => v.toFixed(1).replace('.', ',');
export function buildTime(s: number): string {
  const r = Math.round(s);
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)}:${pad2(r % 60)} min`;
}
export const isOwn = (t: any) => t && typeof t === 'object' && typeof t.inLevel !== 'number';

export function cardValues(t: any): { build: string; cost: string; output: string } {
  if (!t) return { build: '–', cost: '–', output: '–' };
  if (!isOwn(t)) return { build: `in L${pad2(t.inLevel)}`, cost: `in L${pad2(t.inLevel)}`, output: '–' };
  return {
    build: typeof t.buildS === 'number' ? buildTime(t.buildS) : '–',
    cost: usd(t.costUsd),
    output: int(t.output),
  };
}

export function sums(tokens: any[]) {
  const own = tokens.filter(isOwn);
  const cost = Math.round(own.reduce((s, t) => s + t.costUsd, 0) * 100) / 100;
  const output = own.reduce((s, t) => s + t.output, 0);
  const build = own.every((t) => typeof t.buildS === 'number') ? own.reduce((s, t) => s + t.buildS, 0) : null;
  return { cost, output, build };
}
