import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmojiLayer } from '../domain/design';
import { createEmojiAssetRef, toCodepoint } from '../domain/emoji';
import type { PackId, PackSnapshot, PackStyle, PackSummary } from '../domain/pack';
import type { EmojiPackCatalog } from '../ports/emojiPackCatalog';
import type { EmojiPickTarget } from './editor/contracts';
import {
  compactEmojiCollection, describeEmoji, loadEmojiSearchEntries, POPULAR_EMOJI_ENTRIES,
  searchEmoji, type EmojiSearchEntry,
} from './emojiSearch';

interface Props {
  readonly emoji: string;
  readonly selectedLayer: EmojiLayer | null;
  readonly catalog: EmojiPackCatalog;
  readonly snapshot: PackSnapshot;
  readonly packs: readonly PackSummary[];
  readonly onPick: (emoji: string, target: EmojiPickTarget) => Promise<boolean>;
  readonly onSnapshotChange: (snapshot: PackSnapshot, layerId: string | null) => Promise<void>;
}

type CollectionState =
  | { readonly snapshotKey: string; readonly status: 'ready'; readonly covered: ReadonlySet<string> }
  | { readonly snapshotKey: string; readonly status: 'error' };

type PickerMode = 'add' | 'replace';

const selection = (
  summary: PackSummary,
  versionName: string,
  preferredStyle?: PackStyle,
): PackSnapshot => {
  const version = summary.versions.find((candidate) => candidate.version === versionName)
    ?? summary.versions.find((candidate) => candidate.version === summary.defaultVersion)!;
  const style = preferredStyle !== undefined && version.styles.includes(preferredStyle)
    ? preferredStyle
    : version.defaultStyle ?? undefined;
  const base: PackSnapshot = { pack: summary.id, packVersion: version.version };
  return style === undefined ? base : { ...base, style };
};

export default function EmojiPicker({
  emoji,
  selectedLayer,
  catalog,
  snapshot,
  packs,
  onPick,
  onSnapshotChange,
}: Props) {
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [searchEntries, setSearchEntries] = useState<readonly EmojiSearchEntry[]>(POPULAR_EMOJI_ENTRIES);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const searchRequest = useRef<Promise<void> | null>(null);
  const requestSearch = () => {
    if (searchRequest.current) return;
    setSearchStatus('loading');
    searchRequest.current = loadEmojiSearchEntries().then((entries) => {
      setSearchEntries(entries);
      setSearchStatus('ready');
    }).catch(() => {
      searchRequest.current = null;
      setSearchStatus('error');
    });
  };
  // The picker stays mounted across panel changes; recents belong to this editing session.
  const [recents, setRecents] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const selectedId = selectedLayer?.id ?? null;
  const [modeChoice, setModeChoice] = useState<{ readonly selectedId: string | null; readonly mode: PickerMode }>({
    selectedId,
    mode: selectedLayer ? 'replace' : 'add',
  });
  // A manual Add choice applies only while that selection remains active.
  // Remember each transition so returning to an earlier object cannot revive it.
  if (modeChoice.selectedId !== selectedId) {
    setModeChoice({ selectedId, mode: selectedLayer ? 'replace' : 'add' });
  }
  const mode = modeChoice.selectedId === selectedId ? modeChoice.mode : selectedLayer ? 'replace' : 'add';
  const target: EmojiPickTarget = mode === 'replace' && selectedLayer
    ? { kind: 'replace', layerId: selectedLayer.id }
    : { kind: 'add' };
  const busy = pending !== null || snapshotPending;
  const snapshotKey = `${snapshot.pack}@${snapshot.packVersion}/${snapshot.style ?? ''}#${retry}`;
  const [collection, setCollection] = useState<CollectionState | null>(null);
  const [artwork, setArtwork] = useState<{
    readonly snapshotKey: string;
    readonly urls: ReadonlyMap<string, string>;
    readonly failed: ReadonlySet<string>;
  } | null>(null);
  const [brokenArtwork, setBrokenArtwork] = useState<{
    readonly snapshotKey: string;
    readonly codepoints: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    let current = true;
    void catalog.get(snapshot).then((manifest) => {
      if (!current) return;
      setCollection(manifest.ok
        ? { snapshotKey, status: 'ready', covered: new Set(manifest.value.glyphs) }
        : { snapshotKey, status: 'error' });
    }).catch(() => {
      if (current) setCollection({ snapshotKey, status: 'error' });
    });
    return () => { current = false; };
  }, [catalog, snapshot, snapshotKey, retry]);

  const currentCollection = collection?.snapshotKey === snapshotKey ? collection : null;
  const searching = text.trim().length > 0;
  const matches = useMemo(() => searching || showAll
    ? searchEmoji(text, searchEntries)
    : compactEmojiCollection(recents, searchEntries), [text, searching, showAll, recents, searchEntries]);
  const candidates = useMemo(() => currentCollection?.status === 'ready'
    ? matches.filter((candidate) => currentCollection.covered.has(toCodepoint(candidate.emoji)))
    : [], [currentCollection, matches]);

  useEffect(() => {
    if (candidates.length === 0) return;
    let current = true;
    void Promise.all(candidates.map(async ({ emoji: candidate }) => {
      try {
        const result = await catalog.assetUrl(createEmojiAssetRef(candidate, snapshot));
        return [candidate, result.ok ? result.value.toString() : null] as const;
      } catch {
        return [candidate, null] as const;
      }
    })).then((resolved) => {
      if (!current) return;
      setArtwork((previous) => ({
        snapshotKey,
        urls: new Map([
          ...(previous?.snapshotKey === snapshotKey ? previous.urls : []),
          ...resolved.flatMap(([candidate, url]) => url ? [[candidate, url] as const] : []),
        ]),
        failed: new Set(resolved.flatMap(([candidate, url]) => url ? [] : [candidate])),
      }));
    });
    return () => { current = false; };
  }, [catalog, snapshot, snapshotKey, candidates]);

  const selectedPack = packs.find((pack) => pack.id === snapshot.pack) ?? null;
  const selectedVersion = selectedPack?.versions.find(
    (version) => version.version === snapshot.packVersion,
  ) ?? null;
  const currentArtwork = artwork?.snapshotKey === snapshotKey ? artwork : null;
  const artworkFailed = (candidate: string) => currentArtwork?.failed.has(candidate)
    || (brokenArtwork?.snapshotKey === snapshotKey && brokenArtwork.codepoints.has(candidate));
  const firstCandidate = candidates[0];
  const canSubmit = firstCandidate !== undefined
    && currentArtwork?.urls.has(firstCandidate.emoji)
    && !artworkFailed(firstCandidate.emoji)
    && !busy;
  const hasArtworkFailure = candidates.some(({ emoji: candidate }) => artworkFailed(candidate));

  const updateSnapshot = async (next: PackSnapshot) => {
    setSnapshotPending(true);
    setNotice(null);
    try {
      await onSnapshotChange(next, target.kind === 'replace' ? target.layerId : null);
    } catch {
      setNotice('Couldn’t change the artwork pack. Please try again.');
    } finally {
      setSnapshotPending(false);
    }
  };

  const changePack = async (pack: PackId) => {
    const summary = packs.find((candidate) => candidate.id === pack);
    if (summary) await updateSnapshot(selection(summary, summary.defaultVersion));
  };

  const changeVersion = async (version: string) => {
    if (selectedPack) await updateSnapshot(selection(selectedPack, version, snapshot.style));
  };

  const changeStyle = async (style: PackStyle) => {
    if (selectedPack) await updateSnapshot(selection(selectedPack, snapshot.packVersion, style));
  };

  const choose = async (grapheme: string) => {
    if (busy) return;
    setPending(grapheme);
    setNotice(null);
    try {
      const accepted = await onPick(grapheme, target);
      if (accepted) {
        setRecents((previous) => [grapheme, ...previous.filter((recent) => toCodepoint(recent) !== toCodepoint(grapheme))].slice(0, 6));
        setText('');
        setShowAll(false);
      } else {
        setNotice('This emoji couldn’t be used. Try another emoji or artwork pack.');
      }
    } catch {
      setNotice('This emoji couldn’t load. Please try again.');
    } finally {
      setPending(null);
    }
  };

  const action = target.kind === 'replace' ? 'Replace' : 'Add';
  const selectedName = selectedLayer ? describeEmoji(selectedLayer.source.grapheme, searchEntries).name : null;
  const packName = selectedPack?.name ?? 'this artwork pack';

  return (
    <div className="panel picker-panel">
      <h2>Find your emoji</h2>
      <form className="emoji-input picker-search" onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && firstCandidate) void choose(firstCandidate.emoji);
      }}>
        <label className="sr-only" htmlFor="emoji-search">Search emoji by name or paste an emoji</label>
        <input
          id="emoji-search"
          type="search"
          autoComplete="off"
          placeholder="Search happy, pizza… or paste emoji"
          value={text}
          disabled={busy}
          onFocus={requestSearch}
          onChange={(event) => {
            setText(event.target.value); setNotice(null);
            if (event.target.value.trim()) requestSearch();
          }}
        />
        <button type="submit" disabled={!searching || !canSubmit}
          aria-label={firstCandidate ? `${action} ${firstCandidate.name}` : `${action} emoji`}>
          {pending ? 'Loading…' : action}
        </button>
      </form>
      <div className="picker-mode" role="group" aria-label="Emoji action">
        <button type="button" aria-pressed={target.kind === 'replace'} disabled={!selectedLayer || busy}
          onClick={() => setModeChoice({ selectedId, mode: 'replace' })}>Replace selected</button>
        <button type="button" aria-pressed={target.kind === 'add'} disabled={busy}
          onClick={() => setModeChoice({ selectedId, mode: 'add' })}>Add emoji</button>
      </div>
      <p className="picker-target">
        {target.kind === 'replace'
          ? `Replacing: ${selectedLayer?.name === 'Emoji' ? selectedName : selectedLayer?.name ?? selectedName}`
          : 'Add a new emoji to your design.'}
      </p>
      <div className="picker-results-heading">
        <span>{searching ? `${candidates.length} ${candidates.length === 1 ? 'match' : 'matches'}`
          : showAll ? 'All emoji' : recents.length ? 'Recent & popular' : 'Popular emoji'}</span>
        {!searching && <button className="picker-more" type="button" onClick={() => {
          if (!showAll) requestSearch();
          setShowAll(!showAll);
        }}>
          {showAll ? 'Show less' : 'See all'}
        </button>}
      </div>
      {searchStatus === 'loading' && (searching || showAll) && <p className="picker-status" role="status">
        Loading more emoji…
      </p>}
      {searchStatus === 'error' && <p className="picker-status" role="status">
        More emoji couldn’t load. <button type="button" onClick={requestSearch}>Retry search</button>
      </p>}
      {!currentCollection && <p className="picker-status" role="status">Loading {packName}…</p>}
      {currentCollection?.status === 'error' && <p className="picker-status" role="alert">
        Couldn’t load {packName}. <button type="button" onClick={() => setRetry(retry + 1)}>Try again</button>
      </p>}
      {currentCollection?.status === 'ready' && searchStatus !== 'loading'
        && (searchStatus !== 'error' || matches.length > 0)
        && candidates.length === 0 && <p className="picker-status" role="status">
        {matches.length === 0
          ? 'No emoji match that search. Try a name like “happy” or paste one emoji.'
          : searching
            ? `${packName} doesn’t include this emoji or these search matches. Try another artwork pack.`
            : `No emoji from this collection are available in ${packName}. Search or paste an emoji, or try another artwork pack.`}
      </p>}
      <div className="emoji-grid" aria-label={searching ? 'Emoji search results' : showAll ? 'All emoji' : 'Recent and popular emoji'}>
        {candidates.map(({ emoji: candidate, name }) => {
          const imageUrl = currentArtwork?.urls.get(candidate);
          const broken = artworkFailed(candidate);
          return (
            <button key={candidate} type="button"
              aria-label={`${action}${target.kind === 'replace' ? ' selected with' : ''} ${name} ${candidate}${broken ? ' (artwork unavailable)' : ''}`}
              title={`${name}${broken ? ' — artwork unavailable' : ''}`}
              aria-pressed={selectedLayer !== null && toCodepoint(candidate) === toCodepoint(emoji)}
              disabled={busy || !imageUrl || broken}
              onClick={() => void choose(candidate)}>
              {imageUrl && !broken ? <img alt="" src={imageUrl} onError={() => {
                setBrokenArtwork((current) => ({
                  snapshotKey,
                  codepoints: new Set(current?.snapshotKey === snapshotKey ? current.codepoints : []).add(candidate),
                }));
              }} /> : <span className="picker-artwork-placeholder" aria-hidden="true">{broken ? '!' : '·'}</span>}
            </button>
          );
        })}
      </div>
      {hasArtworkFailure && <p className="picker-status" role="status">
        Some artwork couldn’t load. <button type="button" onClick={() => setRetry(retry + 1)}>Retry artwork</button>
      </p>}
      {notice && <p className="picker-status" role="alert">{notice}</p>}
      <details className="picker-pack-details">
        <summary>Artwork pack: {packName}{snapshot.style ? ` · ${snapshot.style}` : ''}</summary>
        <p className="picker-target">{target.kind === 'replace'
          ? 'Changing packs updates the selected emoji’s artwork.'
          : 'Choose the artwork for the next emoji you add.'}</p>
        <div className="pack-selectors">
          <label>
            <span>Artwork pack</span>
            <select aria-label="Emoji library" value={snapshot.pack} disabled={busy}
              onChange={(event) => void changePack(event.target.value as PackId)}>
              {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
            </select>
          </label>
          {selectedPack && selectedPack.versions.length > 1 && <label>
            <span>Version</span>
            <select aria-label="Emoji library version" value={snapshot.packVersion} disabled={busy}
              onChange={(event) => void changeVersion(event.target.value)}>
              {selectedPack.versions.map((version) => <option key={version.version} value={version.version}>{version.version}</option>)}
            </select>
          </label>}
          {selectedVersion && selectedVersion.styles.length > 1 && <label>
            <span>Artwork style</span>
            <select aria-label="Emoji library style" value={snapshot.style} disabled={busy}
              onChange={(event) => void changeStyle(event.target.value as PackStyle)}>
              {selectedVersion.styles.map((style) => <option key={style} value={style}>{style}</option>)}
            </select>
          </label>}
        </div>
      </details>
    </div>
  );
}
