import { useRef } from 'react';
import type { StorageHealth } from '../application/services';

interface Props {
  readonly starred: boolean;
  readonly storageHealth: StorageHealth | null;
  readonly busy: boolean;
  readonly onSaveNow: () => void;
  readonly onToggleStar: () => void;
  readonly onDelete: () => void;
  readonly onExportProject: () => void;
  readonly onImportProject: (file: File) => void;
  readonly onExportWorkspace: () => void;
  readonly onImportWorkspace: (file: File) => void;
  readonly onRequestPersistence: () => void;
}

export default function WorkspaceMenu({ starred, storageHealth, busy, onSaveNow, onToggleStar,
  onDelete, onExportProject, onImportProject, onExportWorkspace, onImportWorkspace,
  onRequestPersistence }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const projectImportRef = useRef<HTMLInputElement>(null);
  const workspaceImportRef = useRef<HTMLInputElement>(null);
  const close = () => detailsRef.current?.removeAttribute('open');
  const run = (action: () => void) => {
    close();
    action();
  };

  return (
    <details className="workspace-menu" ref={detailsRef}>
      <summary>Project menu</summary>
      <div className="workspace-menu-popover" aria-label="Project and workspace actions">
        <strong>Project</strong>
        <button type="button" onClick={() => run(onToggleStar)}>
          {starred ? '★ Remove from templates' : '☆ Add to templates'}
        </button>
        <button type="button" onClick={() => run(onSaveNow)}>
          <span>Save now</span><kbd>⌘S</kbd>
        </button>
        <button type="button" onClick={() => run(onExportProject)}>Export editable project</button>
        <button type="button" onClick={() => projectImportRef.current?.click()}>
          Import editable project
        </button>
        <button type="button" className="danger" onClick={() => run(onDelete)}>Delete project…</button>
        <input ref={projectImportRef} className="sr-only" type="file" accept="application/json,.json"
          aria-label="Import editable project" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportProject(file);
            event.currentTarget.value = '';
            close();
          }} />

        <hr />
        <strong>Workspace</strong>
        <button type="button" disabled={busy} onClick={() => run(onExportWorkspace)}>
          Back up all projects
        </button>
        <button type="button" disabled={busy} onClick={() => workspaceImportRef.current?.click()}>
          Restore workspace backup
        </button>
        <input ref={workspaceImportRef} className="sr-only" type="file" accept="application/json,.json"
          aria-label="Restore workspace backup" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportWorkspace(file);
            event.currentTarget.value = '';
            close();
          }} />
        {storageHealth?.durability === 'best-effort' && (
          <button type="button" disabled={busy} onClick={() => run(onRequestPersistence)}>
            Protect browser storage
          </button>
        )}

        <hr />
        <strong>Shortcuts</strong>
        <p><kbd>V</kbd> select · <kbd>B</kbd> brush · <kbd>E</kbd> erase · <kbd>F</kbd> fill · <kbd>H</kbd> pan</p>
        <p><kbd>R</kbd> rectangle · <kbd>O</kbd> ellipse · <kbd>L</kbd> line · <kbd>T</kbd> text</p>
        <p><kbd>⌘D</kbd> duplicate · <kbd>⌘G</kbd> group · <kbd>⇧⌘G</kbd> ungroup</p>
      </div>
    </details>
  );
}
