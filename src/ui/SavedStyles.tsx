import { useEffect, useState, useSyncExternalStore } from 'react';
import type { EmojiStyleLibrary } from '../application/emojiStyleLibrary';
import type { Appearance, EmojiLayer, Transform } from '../domain/design';
import { applyEmojiStyle, EMOJI_STYLE_CAPACITY, EMOJI_STYLE_NAME_LIMIT } from '../domain/emojiStyle';
import './SavedStyles.css';

export interface SavedStylesProps {
  readonly loadLibrary: () => Promise<EmojiStyleLibrary>;
  readonly selectedLayer: EmojiLayer | null;
  readonly onApply: (transform: Transform, appearance: Appearance) => void;
}

export default function SavedStyles({ loadLibrary, selectedLayer, onApply }: SavedStylesProps) {
  const [retry, setRetry] = useState(0);
  const [resource, setResource] = useState<{
    readonly loader: SavedStylesProps['loadLibrary'];
    readonly library: EmojiStyleLibrary | null;
    readonly error: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void loadLibrary().then((library) => {
      if (active) setResource({ loader: loadLibrary, library, error: null });
    }).catch(() => {
      if (active) setResource({ loader: loadLibrary, library: null, error: 'Saved styles could not be opened.' });
    });
    return () => { active = false; };
  }, [loadLibrary, retry]);
  const current = resource?.loader === loadLibrary ? resource : null;
  if (current?.error) return <p role="alert">{current.error} <button type="button" onClick={() => setRetry(retry + 1)}>Retry saved styles</button></p>;
  if (!current?.library) return <p role="status">Opening saved styles…</p>;
  return <StyleLibrary library={current.library} selectedLayer={selectedLayer} onApply={onApply} />;
}

function StyleLibrary({ library, selectedLayer, onApply }: Omit<SavedStylesProps, 'loadLibrary'> & { readonly library: EmojiStyleLibrary }) {
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    void library.load();
    const refresh = () => { void library.load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [library]);
  return <section className="saved-style-library" aria-label="Saved emoji style library" aria-busy={snapshot.busy}>
    <div className="saved-style-heading"><h3>Your styles</h3>
      <button type="button" disabled={snapshot.busy} onClick={() => { setNotice(null); void library.load(); }}>Refresh styles</button>
    </div>
    <p>Save this emoji’s look, then reuse it on another emoji. Position and artwork stay with the selected object.</p>
    <form className="saved-style-form" onSubmit={(event) => {
      event.preventDefault();
      if (!selectedLayer || snapshot.busy || !name.trim()) return;
      const submittedName = name;
      setNotice(null);
      void library.save(name, selectedLayer).then((saved) => {
        if (saved) {
          setName((current) => current === submittedName ? '' : current);
          setNotice(`Saved “${submittedName.trim()}”.`);
        }
      });
    }}>
      <label><span>Style name</span><input type="text" maxLength={EMOJI_STYLE_NAME_LIMIT}
        placeholder="e.g. Mint sticker" value={name} disabled={!selectedLayer || snapshot.busy}
        onChange={(event) => { setName(event.target.value); setNotice(null); }} /></label>
      <button type="submit" disabled={!selectedLayer || snapshot.busy || !name.trim()}>Save style</button>
    </form>
    {!selectedLayer && <p>Select one emoji to save or apply a style.</p>}
    {snapshot.error && <p className="saved-style-error" role="alert">{snapshot.error}</p>}
    {notice && !snapshot.error && <p role="status">{notice}</p>}
    {(snapshot.status === 'idle' || snapshot.status === 'loading') && <p role="status">Loading your styles…</p>}
    {snapshot.status === 'ready' && snapshot.styles.length === 0 && <p className="saved-style-empty">No saved styles yet. Give this look a name to keep it.</p>}
    <ul className="saved-style-list">
      {snapshot.styles.map((style) => <li key={style.id}>
        <div><strong>{style.name}</strong><small>{style.transform.rotate}° · {style.appearance.outline ? 'outlined' : 'no outline'}</small></div>
        <button type="button" aria-label={`Apply ${style.name}`} disabled={!selectedLayer || snapshot.busy} onClick={() => {
          if (!selectedLayer) return;
          const applied = applyEmojiStyle(selectedLayer, style);
          onApply(applied.transform, applied.appearance);
          setNotice(`Applied “${style.name}”. Undo restores the previous look.`);
        }}>Apply</button>
        <button type="button" aria-label={`Delete ${style.name}`} disabled={snapshot.busy} onClick={() => {
          setNotice(null);
          void library.remove(style.id).then((removed) => { if (removed) setNotice(`Deleted “${style.name}”.`); });
        }}>Delete</button>
      </li>)}
    </ul>
    {snapshot.issues.map((issue, index) => <p className="saved-style-error" role="alert" key={issue.id ?? index}>
      A saved style could not be read: {issue.error}{' '}
      {issue.id && <button type="button" disabled={snapshot.busy} aria-label={`Delete unreadable style ${issue.id}`}
        onClick={() => { void library.remove(issue.id!); }}>Delete unreadable style</button>}
    </p>)}
    <p className="saved-style-capacity">{snapshot.styles.length} of {EMOJI_STYLE_CAPACITY} styles · Saved in this browser</p>
  </section>;
}
