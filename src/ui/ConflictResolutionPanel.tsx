import type { RenderCoordinator } from '../application/renderCoordinator';
import type { ProjectConflictResolution } from '../application/workspaceController';
import type { Project } from '../domain/project';
import ProjectThumbnail from './ProjectThumbnail';

interface Props {
  readonly projects: readonly Project[];
  readonly renderer: RenderCoordinator;
  readonly onResolve: (conflictProjectId: string, resolution: ProjectConflictResolution) => void;
}

const formatTimestamp = (timestamp: number) => new Date(timestamp).toLocaleString([], {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default function ConflictResolutionPanel({ projects, renderer, onResolve }: Props) {
  const pairs = projects.flatMap((conflictProject) => {
    if (!conflictProject.conflict) return [];
    const sourceProject = projects.find(
      (project) => project.id === conflictProject.conflict!.sourceProjectId,
    );
    return sourceProject ? [{ conflictProject, sourceProject }] : [];
  });
  if (pairs.length === 0) return null;

  return (
    <section className="conflict-resolution-panel" aria-labelledby="conflict-resolution-heading">
      <h2 id="conflict-resolution-heading">Resolve concurrent edits</h2>
      {pairs.map(({ conflictProject, sourceProject }) => (
        <article className="conflict-resolution-item" key={conflictProject.id}>
          <p>
            Both versions are safe. Choose which project should remain after comparing them.
          </p>
          <div className="conflict-comparison">
            <figure>
              <ProjectThumbnail project={sourceProject} renderer={renderer} />
              <figcaption>
                <span>Original</span>
                <strong>{sourceProject.name}</strong>
                <small>Updated {formatTimestamp(sourceProject.updatedAt)}</small>
              </figcaption>
            </figure>
            <figure>
              <ProjectThumbnail project={conflictProject} renderer={renderer} />
              <figcaption>
                <span>Conflict edit</span>
                <strong>{conflictProject.name.replace(/ \(conflict copy\)$/u, '')}</strong>
                <small>Detected {formatTimestamp(conflictProject.conflict!.createdAt)}</small>
              </figcaption>
            </figure>
          </div>
          <div className="conflict-resolution-actions">
            <button type="button" onClick={() => onResolve(conflictProject.id, 'keep-source')}>
              Keep original
            </button>
            <button type="button" className="primary"
              onClick={() => onResolve(conflictProject.id, 'keep-conflict')}>
              Keep conflict edit
            </button>
            <button type="button" onClick={() => onResolve(conflictProject.id, 'keep-both')}>
              Keep both
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
