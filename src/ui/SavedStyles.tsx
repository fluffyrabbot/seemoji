import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EmojiStyleImportPreview, EmojiStyleLibrary, EmojiStyleLibrarySnapshot } from '../application/emojiStyleLibrary';
import { EMOJI_STYLE_ARCHIVE_MAX_BYTES } from '../domain/emojiStyleArchive';
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
    <p>Back up or import your styles with any selection. Select one emoji to save its look or apply a style.</p>
    <StyleArchive library={library} snapshot={snapshot} onNotice={setNotice} />
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
        placeholder="e.g. Mint sticker" value={name} disabled={!selectedLayer}
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
    {snapshot.issues.map((issue, index) => <p className="saved-style-error" role="alert" key={issue.recoveryToken ?? index}>
      A saved style could not be read: {issue.error}{' '}
      {issue.recoveryToken && <button type="button" disabled={snapshot.busy} aria-label={`Delete unreadable style ${issue.id || index + 1}`}
        onClick={() => {
          setNotice(null);
          void library.removeUnreadable(issue.recoveryToken!).then((removed) => {
            if (removed) setNotice('Deleted the unreadable style.');
          });
        }}>Delete unreadable style</button>}
    </p>)}
    <p className="saved-style-capacity">{snapshot.styles.length} of {EMOJI_STYLE_CAPACITY} styles · Saved in this browser</p>
  </section>;
}


type DuplicatePolicy = 'keep-both' | 'skip-matching';
interface ImportSource { readonly name: string; readonly text: string | null }

function StyleArchive({ library, snapshot, onNotice }: {
  readonly library: EmojiStyleLibrary;
  readonly snapshot: EmojiStyleLibrarySnapshot;
  readonly onNotice: (notice: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [policy, setPolicy] = useState<DuplicatePolicy>('keep-both');
  const [preview, setPreview] = useState<EmojiStyleImportPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => {
    generation.current += 1;
    library.cancelImport();
  }, [library]);
  const busy = snapshot.busy || working;
  const cancel = () => {
    generation.current += 1;
    library.cancelImport();
    setSource(null);
    setPreview(null);
    setError(null);
    setWorking(false);
    if (input.current) input.current.value = '';
  };
  const prepare = async (file: ImportSource, selectedPolicy: DuplicatePolicy, request: number) => {
    if (file.text === null) return;
    try {
      const next = await library.prepareImport(file.text, selectedPolicy);
      if (request === generation.current) setPreview(next);
    } catch {
      if (request === generation.current) setError('The import preview could not be prepared. Try refreshing it.');
    } finally {
      if (request === generation.current) setWorking(false);
    }
  };
  const replan = (selectedPolicy: DuplicatePolicy) => {
    if (!source || source.text === null || busy) return;
    const request = ++generation.current;
    library.cancelImport();
    setPolicy(selectedPolicy);
    setPreview(null);
    setError(null);
    setWorking(true);
    onNotice(null);
    void prepare(source, selectedPolicy, request);
  };
  const chooseFile = async (file: File) => {
    const request = ++generation.current;
    library.cancelImport();
    setSource({ name: file.name, text: null });
    setPreview(null);
    setError(null);
    setWorking(true);
    onNotice(null);
    if (file.size > EMOJI_STYLE_ARCHIVE_MAX_BYTES) {
      setError(`Choose a style backup no larger than ${EMOJI_STYLE_ARCHIVE_MAX_BYTES / 1024} KB.`);
      setWorking(false);
      return;
    }
    try {
      const text = await file.text();
      if (request !== generation.current) return;
      const selected = { name: file.name, text };
      setSource(selected);
      await prepare(selected, policy, request);
    } catch {
      if (request === generation.current) {
        setError('This file could not be read. Choose the file again to retry.');
        setWorking(false);
      }
    }
  };
  const confirm = async () => {
    if (!preview || busy) return;
    const request = generation.current;
    setWorking(true);
    setError(null);
    onNotice(null);
    try {
      const result = await library.importPreview(preview.id);
      if (request !== generation.current) return;
      if (result) {
        cancel();
        onNotice(`Imported ${result.importedCount} ${result.importedCount === 1 ? 'style' : 'styles'}. ${result.skippedCount} skipped; ${result.renamedCount} renamed.`);
      } else {
        setPreview(null);
        setError('The import was not applied. Refresh the preview before trying again.');
      }
    } catch {
      if (request === generation.current) {
        setPreview(null);
        setError('The import could not be completed. Refresh the preview before trying again.');
      }
    } finally {
      if (request === generation.current) setWorking(false);
    }
  };
  const exportStyles = async () => {
    setWorking(true);
    setError(null);
    onNotice(null);
    try {
      const result = await library.exportArchive();
      if (result) onNotice(result.omittedCount
        ? `Exported ${result.styleCount} readable ${result.styleCount === 1 ? 'style' : 'styles'}. ${result.omittedCount} unreadable ${result.omittedCount === 1 ? 'record was' : 'records were'} omitted; the backup records these omissions.`
        : `Exported ${result.styleCount} ${result.styleCount === 1 ? 'style' : 'styles'}.`);
    } catch {
      setError('Styles could not be exported. Please try Export styles again.');
    } finally { setWorking(false); }
  };
  return <div className="style-archive">
    <div className="style-archive-actions">
      <button type="button" disabled={busy} onClick={() => void exportStyles()}>Export styles</button>
      <button type="button" disabled={busy} onClick={() => input.current?.click()}>Import styles</button>
      <input ref={input} type="file" accept="application/json,.json" aria-label="Import styles"
        className="style-archive-file" disabled={busy} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void chooseFile(file);
        }} />
    </div>
    <p className="style-archive-hint">JSON backups · Up to {EMOJI_STYLE_ARCHIVE_MAX_BYTES / 1024} KB</p>
    {error && <p className="saved-style-error" role="alert">{error}</p>}
    {source && <section className="style-import-preview" aria-label="Import preview" aria-busy={busy}>
      <h4>Review import</h4>
      <p className="style-import-filename">{source.name}</p>
      <label className="style-import-policy"><span>Duplicate names</span>
        <select value={policy} disabled={busy || source.text === null}
          onChange={(event) => replan(event.currentTarget.value as DuplicatePolicy)}>
          <option value="keep-both">Keep both (rename)</option>
          <option value="skip-matching">Skip matching names</option>
        </select>
      </label>
      {working && <p role="status">Preparing your styles…</p>}
      {preview && <>
        <p className="style-import-counts" role="status">{preview.incomingCount} in file · {preview.importCount} to import · {preview.skippedCount} skipped · {preview.renamedCount} renamed</p>
        {preview.importCount === 0 && <p>No new styles to import with this option.</p>}
        <ul className="style-import-entries" aria-label="Incoming styles">
          {preview.entries.map((entry, index) => <li key={`${entry.sourceId}:${index}`}>
            <span>{entry.originalName}{entry.name !== entry.originalName && <> → <strong>{entry.name}</strong></>}</span>
            <small>{entry.action === 'skip' ? 'Skip' : entry.name !== entry.originalName ? 'Import with new name' : 'Import'}</small>
          </li>)}
        </ul>
        {preview.omissions.length > 0 && <div className="style-import-omissions" role="alert">
          <p>This backup lists {preview.omissions.length} unreadable {preview.omissions.length === 1 ? 'record' : 'records'} that cannot be restored.</p>
          <ul>{preview.omissions.map((issue, index) => <li key={index}>{issue.error}</li>)}</ul>
        </div>}
      </>}
      <div className="style-import-actions">
        {preview ? <button type="button" className="primary" disabled={busy || preview.importCount === 0}
          onClick={() => void confirm()}>Confirm import</button>
          : source.text !== null && <button type="button" disabled={busy}
            onClick={() => replan(policy)}>Refresh import preview</button>}
        <button type="button" disabled={snapshot.busy} onClick={cancel}>Cancel import</button>
      </div>
    </section>}
  </div>;
}
