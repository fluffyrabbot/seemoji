import type { ReactNode } from 'react';
import type { Project } from '../domain/project';

interface Props {
  readonly name: string;
  readonly projects: readonly Project[];
  readonly currentId: string;
  readonly persistenceStatus:
    | 'loading'
    | 'saved'
    | 'saving'
    | 'reconciling'
    | 'conflict'
    | 'error';
  readonly busy: boolean;
  readonly onNameChange: (name: string) => void;
  readonly onNew: () => void;
  readonly onOpen: (id: string) => void;
  readonly menu: ReactNode;
}

export default function ProjectBar({ name, projects, currentId, persistenceStatus,
  busy, onNameChange, onNew, onOpen, menu }: Props) {
  return (
    <section className="project-bar" aria-label="Project controls">
      <div className="project-identity">
        <input aria-label="Project name" maxLength={80} value={name} disabled={busy}
          onChange={(event) => onNameChange(event.target.value)} />
        <span className={`persistence-status ${persistenceStatus}`} role="status">
          {persistenceStatus === 'loading' ? 'Opening workspace…'
            : persistenceStatus === 'saving' ? 'Saving locally…'
              : persistenceStatus === 'reconciling' ? 'Preserving concurrent edits…'
              : persistenceStatus === 'saved' ? 'Saved locally'
                : persistenceStatus === 'conflict' ? 'Conflict needs resolution' : 'Local save failed'}
        </span>
      </div>
      <div className="project-actions">
        <button type="button" disabled={busy} onClick={onNew}>New</button>
        <select aria-label="Open project" value={currentId} disabled={busy}
          onChange={(event) => event.target.value && onOpen(event.target.value)}>
          <option value="" disabled>Open…</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        {menu}
      </div>
    </section>
  );
}
