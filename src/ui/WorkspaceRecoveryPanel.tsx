import type { WorkspaceSnapshot } from '../application/workspaceController';
import type { ProjectQuarantineRecord } from '../domain/projectQuarantine';

interface Props {
  readonly issues: WorkspaceSnapshot['issues'];
  readonly busy: boolean;
  readonly onExportQuarantined: (record: ProjectQuarantineRecord) => void;
  readonly onPurgeQuarantined: (record: ProjectQuarantineRecord) => void;
}

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return 'Unknown';
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
};

export default function WorkspaceRecoveryPanel({ issues, busy, onExportQuarantined,
  onPurgeQuarantined }: Props) {
  if (issues.length === 0) return null;
  return (
    <section className="workspace-recovery-panel" role="alert" aria-labelledby="recovery-heading">
      <strong id="recovery-heading">Recovery attention needed</strong>
      <p>
        Valid projects remain usable. Export an isolated record before permanently purging it.
      </p>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.recordId ?? 'unknown'}-${index}`}>
            <div>
              <code>{issue.recordId ?? 'unknown record'}</code>: {issue.error}
              <small>{formatBytes(issue.byteSize)} · <code>{issue.contentHash}</code></small>
            </div>
            <div className="workspace-recovery-record-actions">
              <button type="button" disabled={busy} onClick={() => onExportQuarantined(issue)}>
                Export isolated record
              </button>
              <button type="button" className="danger" disabled={busy}
                onClick={() => onPurgeQuarantined(issue)}>
                Permanently purge
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
