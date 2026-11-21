import { DASH, STATUS_LABEL, formatDate, reachedLevel } from '../results';
import type { Level } from '../results';

interface Props {
  levels: Level[];
  updatedAt: string | null;
}

export default function Summary({ levels, updatedAt }: Props) {
  const n = reachedLevel(levels);
  const time = updatedAt ? formatDate(updatedAt) : DASH;
  return (
    <section className="summary" aria-label="Zusammenfassung">
      <div className="summary-left">
        <div className="summary-label">Erreichtes Level</div>
        <div className="summary-value" data-testid="summary-reached">
          {n} <span className="summary-of">/ 10</span>
        </div>
      </div>
      <div className="summary-right">
        <div className="progress" role="img" aria-label={`${n} von 10 Levels erreicht`} data-testid="summary-progress">
          {levels.map((l) => (
            <div
              key={l.level}
              className={`progress-seg status-${l.status}`}
              title={`Level ${l.level}: ${STATUS_LABEL[l.status]}`}
            />
          ))}
        </div>
        <div className="summary-updated">
          Zuletzt aktualisiert: <span data-testid="summary-updated">{time}</span>
        </div>
      </div>
    </section>
  );
}
