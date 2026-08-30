import { useRef } from 'react';
import type { StorageHealth } from '../application/services';
import type { WorkspaceSnapshot } from '../application/workspaceController';
import type { ProjectQuarantineRecord } from '../domain/projectQuarantine';

interface Props {
  readonly health: StorageHealth | null;
  readonly issues: WorkspaceSnapshot['issues'];
  readonly busy: boolean;
  readonly onRequestPersistence: () => void;
  readonly onExport: () => void;
  readonly onImport: (file: File) => void;
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

export default function WorkspaceRecoveryPanel({ health, issues, busy, onRequestPersistence,
  onExport, onImport, onExportQuarantined, onPurgeQuarantined }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const durability = health?.durability === 'persistent' ? 'Persistent storage granted'
    : health?.durability === 'best-effort' ? 'Best-effort browser storage'
      : health?.durability === 'unavailable' ? 'Storage status unavailable' : 'Checking storage…';
  return (
    <details className="workspace-recovery-panel">
      <summary>Storage &amp; recovery</summary>
      <div className="workspace-recovery-content">
        <div>
          <strong>{durability}</strong>
          <small>
            {health ? `${formatBytes(health.usageBytes)} used of ${formatBytes(health.quotaBytes)}`
              : 'Usage and quota are being inspected.'}
          </small>
        </div>
        <div className="workspace-recovery-actions">
          {health?.durability === 'best-effort' && (
            <button type="button" disabled={busy} onClick={onRequestPersistence}>
              Request persistent storage
            </button>
          )}
          <button type="button" disabled={busy} onClick={onExport}>Export workspace archive</button>
          <button type="button" disabled={busy} onClick={() => importRef.current?.click()}>
            Import workspace archive
          </button>
          <input ref={importRef} className="sr-only" type="file" accept="application/json,.json"
            aria-label="Import workspace archive" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.currentTarget.value = '';
            }} />
        </div>
        {issues.length > 0 && (
          <div className="workspace-recovery-issues" role="alert">
            <strong>Isolated recovery records</strong>
            <p>
              Valid projects remain usable. Export a raw recovery record before permanently
              purging it. Records are never removed automatically.
            </p>
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.recordId ?? 'unknown'}-${index}`}>
                  <div>
                    <code>{issue.recordId ?? 'unknown record'}</code>: {issue.error}
                    <small>{formatBytes(issue.byteSize)} · <code>{issue.contentHash}</code></small>
                  </div>
                  <div className="workspace-recovery-record-actions">
                    <button type="button" disabled={busy}
                      onClick={() => onExportQuarantined(issue)}>
                      Export raw record
                    </button>
                    <button type="button" disabled={busy}
                      onClick={() => onPurgeQuarantined(issue)}>
                      Permanently purge
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
