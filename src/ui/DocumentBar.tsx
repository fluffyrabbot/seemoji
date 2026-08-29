import { useRef } from 'react';
import type { WorkspaceDocument } from '../domain/workspaceDocument';

interface Props {
  readonly name: string;
  readonly documents: readonly WorkspaceDocument[];
  readonly currentId: string | null;
  readonly draftStatus: 'loading' | 'saved' | 'saving' | 'error';
  readonly historyLength: number;
  readonly onNameChange: (name: string) => void;
  readonly onNew: () => void;
  readonly onSave: () => void;
  readonly onOpen: (id: string) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
  readonly onImport: (file: File) => void;
  readonly onRestoreHistory: (index: number) => void;
}

export default function DocumentBar({ name, documents, currentId, draftStatus, historyLength,
  onNameChange, onNew, onSave, onOpen, onDelete, onExport, onImport, onRestoreHistory }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const shownHistory = Array.from({ length: Math.min(8, historyLength) }, (_, index) =>
    historyLength - Math.min(8, historyLength) + index);
  return (
    <section className="document-bar" aria-label="Document controls">
      <div className="document-identity">
        <input aria-label="Document name" maxLength={80} value={name}
          onChange={(event) => onNameChange(event.target.value)} />
        <span className={`draft-status ${draftStatus}`} role="status">
          {draftStatus === 'loading' ? 'Recovering…' : draftStatus === 'saving' ? 'Saving draft…'
            : draftStatus === 'saved' ? 'Draft saved' : 'Draft unavailable'}
        </span>
      </div>
      <div className="document-actions">
        <button type="button" onClick={onNew}>New</button>
        <button type="button" className="primary" onClick={onSave}>Save</button>
        <select aria-label="Open document" value={currentId ?? ''}
          onChange={(event) => event.target.value && onOpen(event.target.value)}>
          <option value="">Open…</option>
          {documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}
        </select>
        <button type="button" disabled={!currentId} onClick={onDelete}>Delete</button>
        <button type="button" onClick={onExport}>Export JSON</button>
        <button type="button" onClick={() => importRef.current?.click()}>Import JSON</button>
        <details className="shortcut-help">
          <summary>Shortcuts</summary>
          <p><kbd>V</kbd> select · <kbd>B</kbd> brush · <kbd>E</kbd> erase · <kbd>F</kbd> fill · <kbd>H</kbd> pan</p>
          <p><kbd>R</kbd> rectangle · <kbd>O</kbd> ellipse · <kbd>L</kbd> line · <kbd>T</kbd> text</p>
          <p><kbd>⌘D</kbd> duplicate · <kbd>⌘G</kbd> group · <kbd>⇧⌘G</kbd> ungroup · <kbd>⌘S</kbd> save</p>
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
