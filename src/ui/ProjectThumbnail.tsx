import { useEffect, useRef } from 'react';
import type { RenderCoordinator } from '../application/renderCoordinator';
import type { Project } from '../domain/project';

interface Props {
  readonly project: Project;
  readonly renderer: RenderCoordinator;
  readonly className?: string;
}

export default function ProjectThumbnail({ project, renderer, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    renderer.render(project.design, 64).then((frame) => {
      if (!active || !canvasRef.current) return;
      canvasRef.current.getContext('2d')?.drawImage(frame.canvas, 0, 0);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [project, renderer]);
  return <canvas ref={canvasRef} className={className} width={64} height={64} aria-hidden="true" />;
}
