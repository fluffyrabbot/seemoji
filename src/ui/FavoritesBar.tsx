import { useEffect, useRef } from 'react';
import type { RenderCoordinator } from '../application/renderCoordinator';
import type { Favorite } from '../domain/favorite';

interface ThumbnailProps {
  readonly favorite: Favorite;
  readonly renderer: RenderCoordinator;
}

function FavoriteThumbnail({ favorite, renderer }: ThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    renderer.render(favorite.design, 64).then((frame) => {
      if (!active || !canvasRef.current) return;
      const canvasContext = canvasRef.current.getContext('2d');
      canvasContext?.drawImage(frame.canvas, 0, 0);
    });
    return () => {
      active = false;
    };
  }, [favorite, renderer]);
  return <canvas ref={canvasRef} width={64} height={64} aria-hidden="true" />;
}

interface Props {
  readonly favorites: readonly Favorite[];
  readonly renderer: RenderCoordinator;
  readonly onApply: (favorite: Favorite) => void;
  readonly onRemove: (id: string) => void;
}

export default function FavoritesBar({ favorites, renderer, onApply, onRemove }: Props) {
  if (favorites.length === 0) return null;
  return (
    <section className="favorites-panel" aria-labelledby="favorites-heading">
      <h2 id="favorites-heading">Favorites</h2>
      <div className="favorite-list">
        {favorites.map((favorite) => (
          <article className="favorite-item" key={favorite.id}>
            <button
              className="favorite-apply"
              title={`Apply “${favorite.name}”`}
              onClick={() => onApply(favorite)}
            >
              <FavoriteThumbnail favorite={favorite} renderer={renderer} />
              <span>{favorite.name}</span>
            </button>
            <button
              className="favorite-remove"
              aria-label={`Remove “${favorite.name}”`}
              onClick={() => onRemove(favorite.id)}
            >
              ×
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
