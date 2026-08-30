import { useEffect, useState } from 'react';
import { createEmojiAssetRef, firstGrapheme, toCodepoint } from '../domain/emoji';
import type { PackId, PackSnapshot, PackStyle, PackSummary } from '../domain/pack';
import type { EmojiPackCatalog } from '../ports/emojiPackCatalog';

const CURATED = [
  '😀', '😄', '😁', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍',
  '😘', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '😐',
  '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '🤤',
  '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥴', '😵', '🤯', '🤠',
  '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲',
  '😳', '🥺', '😦', '😨', '😰', '😥', '😢', '😭', '😱', '😖',
  '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬',
  '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '🤖', '🎃',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '✌️', '🤞', '👋',
] as const;

interface Props {
  readonly emoji: string;
  readonly catalog: EmojiPackCatalog;
  readonly snapshot: PackSnapshot;
  readonly packs: readonly PackSummary[];
  readonly onPick: (emoji: string) => Promise<boolean>;
  readonly onSnapshotChange: (snapshot: PackSnapshot) => Promise<void>;
}

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
  catalog,
  snapshot,
  packs,
  onPick,
  onSnapshotChange,
}: Props) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [candidates, setCandidates] = useState<readonly string[]>(CURATED);
  const snapshotKey = `${snapshot.pack}@${snapshot.packVersion}/${snapshot.style ?? ''}`;
  const [artwork, setArtwork] = useState<{
    readonly snapshotKey: string;
    readonly urls: ReadonlyMap<string, string>;
  } | null>(null);
  const [brokenArtwork, setBrokenArtwork] = useState<{
    readonly snapshotKey: string;
    readonly codepoints: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    let current = true;
    void catalog.get(snapshot).then(async (manifest) => {
      if (!current || !manifest.ok) return;
      const covered = new Set(manifest.value.glyphs);
      const visible = CURATED.filter((candidate) => covered.has(toCodepoint(candidate)));
      const resolved = await Promise.all(visible.map(async (candidate) => {
        const result = await catalog.assetUrl(createEmojiAssetRef(candidate, snapshot));
        return [candidate, result.ok ? result.value.toString() : null] as const;
      }));
      if (!current) return;
      setCandidates(visible);
      setArtwork({
        snapshotKey,
        urls: new Map(resolved.flatMap(([candidate, url]) => url ? [[candidate, url]] : [])),
      });
    });
    return () => { current = false; };
  }, [catalog, snapshot, snapshotKey]);

  const selectedPack = packs.find((pack) => pack.id === snapshot.pack) ?? null;
  const selectedVersion = selectedPack?.versions.find(
    (version) => version.version === snapshot.packVersion,
  ) ?? null;

  const updateSnapshot = async (next: PackSnapshot) => {
    setSnapshotPending(true);
    try {
      await onSnapshotChange(next);
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
    if (selectedPack) {
      await updateSnapshot(selection(selectedPack, snapshot.packVersion, style));
    }
  };

  const choose = async (grapheme: string) => {
    setPending(grapheme);
    const accepted = await onPick(grapheme);
    setPending(null);
    if (accepted) setText('');
  };

  const applyText = async () => {
    const grapheme = firstGrapheme(text);
    if (grapheme) await choose(grapheme);
  };

  return (
    <div className="panel picker-panel">
      <h2>Pick an emoji</h2>
      {packs.length > 1 && (
        <div className="pack-selectors">
          <label>
            <span>Library</span>
            <select
              aria-label="Emoji library"
              value={snapshot.pack}
              disabled={snapshotPending}
              onChange={(event) => void changePack(event.target.value as PackId)}
            >
              {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
            </select>
          </label>
          {selectedPack && selectedPack.versions.length > 1 && (
            <label>
              <span>Version</span>
              <select aria-label="Emoji library version" value={snapshot.packVersion}
                disabled={snapshotPending}
                onChange={(event) => void changeVersion(event.target.value)}>
                {selectedPack.versions.map((version) => (
                  <option key={version.version} value={version.version}>{version.version}</option>
                ))}
              </select>
            </label>
          )}
          {selectedVersion && selectedVersion.styles.length > 1 && (
            <label>
              <span>Style</span>
              <select aria-label="Emoji library style" value={snapshot.style}
                disabled={snapshotPending}
                onChange={(event) => void changeStyle(event.target.value as PackStyle)}>
                {selectedVersion.styles.map((style) => (
                  <option key={style} value={style}>{style}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="emoji-grid" aria-label="Curated emoji">
        {candidates.map((candidate) => {
          const currentArtwork = artwork?.snapshotKey === snapshotKey ? artwork.urls : null;
          const imageUrl = currentArtwork?.get(candidate);
          const broken = (brokenArtwork?.snapshotKey === snapshotKey
            && brokenArtwork.codepoints.has(candidate)) || (currentArtwork !== null && !imageUrl);
          return (
          <button
            key={candidate}
            aria-label={`Use ${candidate}`}
            aria-pressed={candidate === emoji}
            disabled={pending !== null || snapshotPending || broken}
            onClick={() => void choose(candidate)}
          >
            {imageUrl && !broken ? <img alt="" src={imageUrl} onError={() => {
              setBrokenArtwork((current) => ({
                snapshotKey,
                codepoints: new Set(
                  current?.snapshotKey === snapshotKey ? current.codepoints : [],
                ).add(candidate),
              }));
            }} /> : broken ? null : candidate}
          </button>
          );
        })}
      </div>
      <form
        className="emoji-input"
        onSubmit={(event) => {
          event.preventDefault();
          void applyText();
        }}
      >
        <label className="sr-only" htmlFor="custom-emoji">
          Paste another emoji
        </label>
        <input
          id="custom-emoji"
          type="text"
          placeholder="…or paste any emoji"
          value={text}
          disabled={pending !== null || snapshotPending}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={!text.trim() || pending !== null || snapshotPending}>
          {pending ? 'Checking…' : 'Use'}
        </button>
      </form>
    </div>
  );
}
