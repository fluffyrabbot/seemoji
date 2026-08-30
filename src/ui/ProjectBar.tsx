import { useRef } from 'react';
import type { Project } from '../domain/project';

interface Props {
  readonly name: string;
  readonly projects: readonly Project[];
  readonly currentId: string;
  readonly persistenceStatus: 'loading' | 'saved' | 'saving' | 'conflict' | 'error';
  readonly starred: boolean;
  readonly historyLength: number;
  readonly onNameChange: (name: string) => void;
  readonly onNew: () => void;
  readonly onFlush: () => void;
  readonly onToggleStar: () => void;
  readonly onOpen: (id: string) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
  readonly onImport: (file: File) => void;
  readonly onRestoreHistory: (index: number) => void;
}

export default function ProjectBar({ name, projects, currentId, persistenceStatus, starred, historyLength,
  onNameChange, onNew, onFlush, onToggleStar, onOpen, onDelete, onExport, onImport,
  onRestoreHistory }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const shownHistory = Array.from({ length: Math.min(8, historyLength) }, (_, index) =>
    historyLength - Math.min(8, historyLength) + index);
  return (
    <section className="project-bar" aria-label="Project controls">
      <div className="project-identity">
        <input aria-label="Project name" maxLength={80} value={name}
          onChange={(event) => onNameChange(event.target.value)} />
        <span className={`persistence-status ${persistenceStatus}`} role="status">
          {persistenceStatus === 'loading' ? 'Opening workspace…'
            : persistenceStatus === 'saving' ? 'Saving locally…'
              : persistenceStatus === 'saved' ? 'Saved locally'
                : persistenceStatus === 'conflict' ? 'Conflict needs resolution' : 'Local save failed'}
        </span>
      </div>
      <div className="project-actions">
        <button type="button" onClick={onNew}>New</button>
        <button type="button" className="primary" onClick={onFlush}>Save now</button>
        <button type="button" aria-pressed={starred} onClick={onToggleStar}>
          {starred ? '★ Starred' : '☆ Star'}
        </button>
        <select aria-label="Open project" value={currentId}
          onChange={(event) => event.target.value && onOpen(event.target.value)}>
          <option value="" disabled>Open…</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button type="button" onClick={onDelete}>Delete</button>
        <button type="button" onClick={onExport}>Export JSON</button>
        <button type="button" onClick={() => importRef.current?.click()}>Import JSON</button>
        <details className="shortcut-help">
          <summary>Shortcuts</summary>
          <p><kbd>V</kbd> select · <kbd>B</kbd> brush · <kbd>E</kbd> erase · <kbd>F</kbd> fill · <kbd>H</kbd> pan</p>
          <p><kbd>R</kbd> rectangle · <kbd>O</kbd> ellipse · <kbd>L</kbd> line · <kbd>T</kbd> text</p>
          <p><kbd>⌘D</kbd> duplicate · <kbd>⌘G</kbd> group · <kbd>⇧⌘G</kbd> ungroup · <kbd>⌘S</kbd> save now</p>
        </details>
        <input ref={importRef} className="sr-only" type="file" accept="application/json,.json"
          aria-label="Import design JSON" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.currentTarget.value = '';
          }} />
      </div>
      <div className="history-timeline" aria-label="History timeline">
        <span>History</span>
        {shownHistory.map((index) => (
          <button type="button" key={index} aria-label={`Restore history step ${index + 1}`}
            title={`Restore step ${index + 1}`} onClick={() => onRestoreHistory(index)}>
            {index + 1}
          </button>
        ))}
        <i aria-label="Current design" title="Current design" />
      </div>
    </section>
  );
}
