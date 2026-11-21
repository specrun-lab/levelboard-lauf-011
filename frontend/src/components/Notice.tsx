interface Props {
  kind: 'missing' | 'invalid' | 'unavailable';
}

const TEXT: Record<Props['kind'], string> = {
  missing: 'Keine Ergebnisse gefunden. Die Datei results.json fehlt.',
  invalid: 'Die Ergebnisdatei ist ungültig. Es werden keine Ergebnisse angezeigt.',
  unavailable: 'Backend nicht erreichbar. Neuer Versuch alle 5 Sekunden.',
};

export default function Notice({ kind }: Props) {
  return (
    <div className="notice" role="alert" data-testid="notice" data-kind={kind}>
      <span className="notice-icon" aria-hidden="true">!</span>
      <span>{TEXT[kind]}</span>
    </div>
  );
}
