import type { RenderCoordinator } from '../application/renderCoordinator';
import type { Project } from '../domain/project';
import ProjectThumbnail from './ProjectThumbnail';

interface Props {
  readonly projects: readonly Project[];
  readonly renderer: RenderCoordinator;
  readonly busy: boolean;
  readonly onOpen: (id: string) => void;
  readonly onUseAsTemplate: (id: string) => void;
}

export default function StarredProjectsBar({ projects, renderer, busy, onOpen, onUseAsTemplate }: Props) {
  const starred = projects
    .filter((project) => project.starredAt !== null)
    .sort((a, b) => b.starredAt! - a.starredAt!);
  if (starred.length === 0) return null;
  return (
    <section className="starred-projects-panel" aria-labelledby="starred-heading">
      <h2 id="starred-heading">Starred projects</h2>
      <div className="starred-project-list">
        {starred.map((project) => (
          <article className="starred-project-item" key={project.id}>
            <button className="starred-project-open" title={`Open “${project.name}”`}
              disabled={busy}
              onClick={() => onOpen(project.id)}>
              <ProjectThumbnail project={project} renderer={renderer} />
              <span>{project.name}</span>
            </button>
            <button className="starred-project-template" aria-label={`Use “${project.name}” as a template`}
              title="Use as template" disabled={busy} onClick={() => onUseAsTemplate(project.id)}>
              +
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
