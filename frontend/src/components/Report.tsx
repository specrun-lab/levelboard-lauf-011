import type { ReactNode } from 'react';
import {
  DASH, STATUS_LABEL, TITLES, formatBuildS, formatDate, formatDec1, formatInt, formatUsd, levelCode, reachedLevel,
  shortCommit, sumTokens,
} from '../results';
import type { Level, Run } from '../results';

interface Props {
  levels: Level[];
  run: Run | null;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div className="tile-row">
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

function Tile({ title, missing, children, extra }: { title: string; missing?: string; children?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="tile">
      <h3>{title}</h3>
      {missing ? (
        <p className="tile-missing" data-testid={`report-${missing}-missing`}>noch nicht erreicht</p>
      ) : (
        <>
          <dl>{children}</dl>
          {extra}
        </>
      )}
    </div>
  );
}

function jobS(jobs: Obj | null, name: string): string {
  const v = jobs ? n(jobs[name]) : null;
  return v === null ? DASH : `${v} s`;
}

export default function Report({ levels, run }: Props) {
  const ready = levels.some((l) => l.checkedAt);
  const lvl = (k: number) => levels.find((l) => l.level === k);
  const complete = lvl(10)?.status === 'bestanden';

  if (!ready) {
    return (
      <section className="report" aria-label="Abschlussbericht" data-testid="report" data-state="empty" data-complete={complete ? 'true' : 'false'}>
        <h2>Abschlussbericht</h2>
        <p className="report-empty" data-testid="report-empty">
          Noch kein Abschlussbericht – er erscheint, sobald das erste Level geprüft ist.
        </p>
      </section>
    );
  }

  const reached = reachedLevel(levels);
  const sum = sumTokens(levels);
  const loadtest = obj(lvl(9)?.metrics.loadtest);
  const images = obj(lvl(7)?.metrics.images);
  const pipeline = obj(lvl(6)?.metrics.pipeline);
  const jobs = pipeline ? obj(pipeline.jobs) : null;
  const pipeUrl = pipeline && typeof pipeline.url === 'string' ? pipeline.url : undefined;
  const mb = (v: unknown) => (n(v) === null ? DASH : `${formatDec1(n(v)!)} MB`);
  const ms = (v: unknown) => (n(v) === null ? DASH : `${Math.round(n(v)!)} ms`);

  return (
    <section className="report" aria-label="Abschlussbericht" data-testid="report" data-state="ready" data-complete={complete ? 'true' : 'false'}>
      <h2>Abschlussbericht</h2>
      <div className="tiles">
        <Tile title="Ergebnis">
          <Row label="Erreicht" testId="report-reached">{`${reached} / 10`}</Row>
          <Row label="Score" testId="report-score">{`${reached * 10} / 100`}</Row>
          <Row label="Vollständig" testId="report-complete">{complete ? 'ja' : 'nein'}</Row>
          <Row label="Bauzeit gesamt" testId="report-build-time">{formatBuildS(sum.buildS)}</Row>
          <Row label="Commit" testId="report-commit">{shortCommit(run?.commit)}</Row>
          <Row label="Stand" testId="report-time">{formatDate(run?.updatedAt)}</Row>
        </Tile>
        <Tile title="Tokens" missing={sum.count === 0 ? 'tokens' : undefined}>
          <Row label="Modell" testId="report-model">{sum.models.length ? sum.models.join(', ') : DASH}</Row>
          <Row label="Antworten" testId="report-responses">{formatInt(sum.responses)}</Row>
          <Row label="Eingabe" testId="report-tokens-input">{formatInt(sum.input)}</Row>
          <Row label="Cache schreiben" testId="report-tokens-cache-write">{formatInt(sum.cacheWrite)}</Row>
          <Row label="Cache lesen" testId="report-tokens-cache-read">{formatInt(sum.cacheRead)}</Row>
          <Row label="Ausgabe" testId="report-tokens-output">{formatInt(sum.output)}</Row>
          <Row label="Gesamt" testId="report-tokens-total">{formatInt(sum.total)}</Row>
          <Row label="Kosten (API-Preis)" testId="report-cost">{formatUsd(sum.costUsd)}</Row>
        </Tile>
        <Tile title="Lasttest" missing={loadtest ? undefined : 'loadtest'}>
          {loadtest && (
            <>
              <Row label="p50" testId="report-p50">{ms(loadtest.p50Ms)}</Row>
              <Row label="p95" testId="report-p95">{ms(loadtest.p95Ms)}</Row>
              <Row label="Durchsatz" testId="report-rps">
                {n(loadtest.rps) === null ? DASH : `${formatDec1(n(loadtest.rps)!)} Anfragen/s`}
              </Row>
              <Row label="Fehler" testId="report-errors">{n(loadtest.errors) === null ? DASH : String(loadtest.errors)}</Row>
            </>
          )}
        </Tile>
        <Tile title="Images" missing={images ? undefined : 'images'}>
          {images && (
            <>
              <Row label="Frontend" testId="report-image-frontend">{mb(images.frontendMB)}</Row>
              <Row label="Backend" testId="report-image-backend">{mb(images.backendMB)}</Row>
            </>
          )}
        </Tile>
        <Tile
          title="Pipeline"
          missing={pipeline ? undefined : 'pipeline'}
          extra={
            <a className="tile-link" data-testid="report-pipeline-link" href={pipeUrl} target="_blank" rel="noreferrer">
              Lauf ansehen
            </a>
          }
        >
          {pipeline && (
            <>
              <Row label="check" testId="report-job-check">{jobS(jobs, 'check')}</Row>
              <Row label="images" testId="report-job-images">{jobS(jobs, 'images')}</Row>
              <Row label="deploy" testId="report-job-deploy">{jobS(jobs, 'deploy')}</Row>
              <Row label="Gesamt" testId="report-pipeline-total">
                {n(pipeline.totalS) === null ? DASH : `${pipeline.totalS} s`}
              </Row>
            </>
          )}
        </Tile>
      </div>
      <ol className="report-levels" data-testid="report-levels">
        {levels.map((l) => (
          <li key={l.level} className="report-level" data-testid="report-level" data-level={l.level} data-status={l.status}>
            <span className="rl-title">{`${levelCode(l.level)} ${TITLES[l.level - 1]}`}</span>
            <span className={`rl-status status-${l.status}`}>{STATUS_LABEL[l.status]}</span>
            <span className="rl-time">{formatDate(l.checkedAt)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
