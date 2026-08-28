import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { editorReducer, INITIAL_EDITOR_STATE } from '../application/editor';
import type { AppServices } from '../application/services';
import { createEmojiAssetRef } from '../domain/emoji';
import { createFavorite, type Favorite } from '../domain/favorite';
import Controls from './Controls';
import EmojiPicker from './EmojiPicker';
import FavoritesBar from './FavoritesBar';
import Preview from './Preview';

export type Notice = {
  readonly kind: 'status' | 'error';
  readonly message: string;
};

interface Props {
  readonly services: AppServices;
}

export default function App({ services }: Props) {
  const [editor, dispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE);
  const [favorites, setFavorites] = useState<readonly Favorite[]>([]);
  const [favoriteName, setFavoriteName] = useState('');
  const [namingFavorite, setNamingFavorite] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const showNotice = useCallback((next: Notice) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next.kind === 'status') {
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4_000);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    let active = true;
    services.favorites
      .list()
      .then((saved) => active && setFavorites(saved))
      .catch((cause: unknown) => {
        if (active) {
          showNotice({
            kind: 'error',
            message: `Favorites unavailable: ${String(cause)}`,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [services.favorites, showNotice]);

  const selectEmoji = async (grapheme: string): Promise<boolean> => {
    const source = createEmojiAssetRef(grapheme);
    try {
      await services.renderer.validateSource(source);
      dispatch({ type: 'set-source', source });
      return true;
    } catch (cause) {
      showNotice({ kind: 'error', message: String(cause) });
      return false;
    }
  };

  const saveFavorite = async () => {
    try {
      const favorite = createFavorite({
        id: crypto.randomUUID(),
        name: favoriteName,
        design: editor.design,
        createdAt: Date.now(),
      });
      setFavorites(await services.favorites.save(favorite));
      setFavoriteName('');
      setNamingFavorite(false);
      showNotice({ kind: 'status', message: `Saved “${favorite.name}”.` });
    } catch (cause) {
      showNotice({
        kind: 'error',
        message: `Could not save favorite: ${String(cause)}`,
      });
    }
  };

  const removeFavorite = async (id: string) => {
    try {
      setFavorites(await services.favorites.remove(id));
      showNotice({ kind: 'status', message: 'Favorite removed.' });
    } catch (cause) {
      showNotice({
        kind: 'error',
        message: `Could not remove favorite: ${String(cause)}`,
      });
    }
  };

  return (
    <>
      <header className="app-header">
        <div>
          <h1>seemoji</h1>
          <p>Slightly edited emoji, ready to paste.</p>
        </div>
      </header>

      <main className="editor-layout">
        <section className="picker-region" aria-label="Emoji source">
          <EmojiPicker emoji={editor.design.source.grapheme} onPick={selectEmoji} />
        </section>

        <section className="controls-region" aria-label="Editing controls">
          <Controls
            design={editor.design}
            onTransformChange={(transform) =>
              dispatch({ type: 'update-transform', transform })
            }
            onAppearanceChange={(appearance) =>
              dispatch({ type: 'update-appearance', appearance })
            }
            onReset={() => dispatch({ type: 'reset' })}
          />
          {!namingFavorite ? (
            <button className="favorite-start" onClick={() => setNamingFavorite(true)}>
              ☆ Save this tweak
            </button>
          ) : (
            <form
              className="favorite-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveFavorite();
              }}
            >
              <label htmlFor="favorite-name">Favorite name</label>
              <div>
                <input
                  id="favorite-name"
                  autoFocus
                  maxLength={80}
                  value={favoriteName}
                  onChange={(event) => setFavoriteName(event.target.value)}
                />
                <button type="submit" disabled={!favoriteName.trim()}>
                  Save
                </button>
                <button type="button" onClick={() => setNamingFavorite(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="preview-region" aria-label="Preview and export">
          <Preview
            design={editor.design}
            size={editor.exportSize}
            services={services}
            onSizeChange={(size) => dispatch({ type: 'set-size', size })}
            onNotice={showNotice}
          />
          <FavoritesBar
            favorites={favorites}
            renderer={services.renderer}
            onApply={(favorite) =>
              dispatch({ type: 'replace-design', design: favorite.design })
            }
            onRemove={(id) => void removeFavorite(id)}
          />
        </section>
      </main>

      <footer className="app-footer">
        Emoji artwork by{' '}
        <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer">
          Twemoji
        </a>{' '}
        under{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        .
      </footer>

      {notice && (
        <div
          className={`notice ${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span>{notice.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
