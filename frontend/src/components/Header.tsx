import { DASH, shortCommit } from '../results';
import type { Run, Source } from '../results';

interface Props {
  run: Run | null;
  source: Source;
}

export default function Header({ run, source }: Props) {
  const sourceText = source === 'api' ? 'Backend' : source === 'file' ? 'Datei' : DASH;
  const commit = run?.commit ?? null;
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">▮▮▮</span>
        <span className="brand-name">Levelboard</span>
      </div>
      <dl className="run">
        <div className="run-pair">
          <dt>Durchlauf</dt>
          <dd data-testid="run-id">{run?.id ?? DASH}</dd>
        </div>
        <div className="run-pair">
          <dt>Version</dt>
          <dd data-testid="run-version">{run?.version ?? DASH}</dd>
        </div>
        <div className="run-pair run-pair-extra">
          <dt>Commit</dt>
          <dd data-testid="run-commit" title={commit ?? undefined}>{shortCommit(commit)}</dd>
        </div>
        <div className="run-pair run-pair-extra">
          <dt>Quelle</dt>
          <dd data-testid="run-source" data-source={source ?? ''}>{sourceText}</dd>
        </div>
      </dl>
    </header>
  );
}
