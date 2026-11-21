import {
  STATUS_LABEL, TITLES, cardBuildTime, cardCost, cardOutput, formatChecks, formatDate, formatDuration, levelCode, tokensOf,
} from '../results';
import type { Level } from '../results';

interface Props {
  level: Level;
}

export function Badge({ status, testId }: { status: Level['status']; testId?: string }) {
  return (
    <span className={`badge status-${status}`} data-testid={testId}>
      <span className="badge-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function LevelCard({ level }: Props) {
  const tok = tokensOf(level);
  return (
    <article className={`card status-${level.status}`} data-testid="level-card" data-level={level.level} data-status={level.status}>
      <div className="card-head">
        <span className="card-num">{levelCode(level.level)}</span>
        <Badge status={level.status} testId="level-status" />
      </div>
      <h2 className="card-title" data-testid="level-title">{TITLES[level.level - 1]}</h2>
      <dl className="facts">
        <div className="fact">
          <dt>Geprüft</dt>
          <dd data-testid="level-checked-at">{formatDate(level.checkedAt)}</dd>
        </div>
        <div className="fact">
          <dt>Checkdauer</dt>
          <dd data-testid="level-duration">{formatDuration(level.durationMs)}</dd>
        </div>
        <div className="fact">
          <dt>Checks</dt>
          <dd data-testid="level-checks">{formatChecks(level.checks)}</dd>
        </div>
        <div className="fact">
          <dt>Bauzeit</dt>
          <dd data-testid="level-build-time">{cardBuildTime(tok)}</dd>
        </div>
        <div className="fact">
          <dt>Kosten</dt>
          <dd data-testid="level-cost">{cardCost(tok)}</dd>
        </div>
        <div className="fact">
          <dt>Tokens (Ausgabe)</dt>
          <dd data-testid="level-output">{cardOutput(tok)}</dd>
        </div>
      </dl>
    </article>
  );
}
