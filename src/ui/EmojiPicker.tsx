import { useState } from 'react';
import { firstGrapheme } from '../domain/emoji';

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
  readonly onPick: (emoji: string) => Promise<boolean>;
}

export default function EmojiPicker({ emoji, onPick }: Props) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);

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
      <div className="emoji-grid" aria-label="Curated emoji">
        {CURATED.map((candidate) => (
          <button
            key={candidate}
            aria-label={`Use ${candidate}`}
            aria-pressed={candidate === emoji}
            disabled={pending !== null}
            onClick={() => void choose(candidate)}
          >
            {candidate}
          </button>
        ))}
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
          disabled={pending !== null}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={!text.trim() || pending !== null}>
          {pending ? 'Checking…' : 'Use'}
        </button>
      </form>
    </div>
  );
}
