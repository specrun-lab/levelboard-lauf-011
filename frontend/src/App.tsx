import { useEffect, useState } from 'react';
import Header from './components/Header';
import Summary from './components/Summary';
import LevelCard from './components/LevelCard';
import Notice from './components/Notice';
import Report from './components/Report';
import { emptyLevels, loadApi, loadFile, loadSource } from './results';
import type { LoadState, Results, Source } from './results';

const POLL_MS = 5000;

export default function App() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<Results | null>(null);
  const [source, setSource] = useState<Source>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      const r = await loadApi();
      if (cancelled) return;
      setState(r.state);
      setData(r.data);
      timer = setTimeout(poll, POLL_MS);
    }

    (async () => {
      const src = await loadSource();
      if (cancelled) return;
      setSource(src);
      if (src === 'api') {
        await poll();
      } else {
        const r = await loadFile();
        if (cancelled) return;
        setState(r.state);
        setData(r.data);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const ok = state === 'ok' && data !== null;
  const levels = ok ? data.levels : emptyLevels();
  const run = ok ? data.run : null;
  const showNotice = state === 'missing' || state === 'invalid' || state === 'unavailable';

  return (
    <div className="app" data-testid="board" data-state={state}>
      <Header run={run} source={source} />
      <main className="main">
        {showNotice && <Notice kind={state} />}
        <Summary levels={levels} updatedAt={run?.updatedAt ?? null} />
        <section className="grid" aria-label="Levels">
          {levels.map((l) => (
            <LevelCard key={l.level} level={l} />
          ))}
        </section>
        <Report levels={levels} run={run} />
      </main>
    </div>
  );
}
