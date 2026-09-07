import { firstGrapheme, toCodepoint } from '../domain/emoji';

export interface EmojiSearchEntry {
  readonly emoji: string;
  readonly name: string;
  readonly keywords: string;
}

// The initial grid has its complete names and keywords without loading search data.
const POPULAR: readonly (readonly [string, string, string])[] = [
  ['😀', 'Grinning face', 'happy smile cheerful'],
  ['😂', 'Face with tears of joy', 'laugh laughing lol funny crying'],
  ['😍', 'Smiling face with heart eyes', 'love hearts crush adore'],
  ['🥳', 'Partying face', 'party celebrate birthday confetti'],
  ['😎', 'Smiling face with sunglasses', 'cool shades summer sun'],
  ['🤔', 'Thinking face', 'think hmm question wonder'],
  ['🥺', 'Pleading face', 'please puppy eyes begging cute'],
  ['😭', 'Loudly crying face', 'sad sob cry tears'],
  ['🤯', 'Exploding head', 'mind blown amazed shocked'],
  ['👻', 'Ghost', 'spooky halloween boo'],
  ['👍', 'Thumbs up', 'yes good like approve okay'],
  ['👋', 'Waving hand', 'wave hello hi goodbye bye'],
  ['❤️', 'Red heart', 'love romance valentine'],
  ['✨', 'Sparkles', 'magic shiny glitter stars'],
  ['🔥', 'Fire', 'hot lit flame'],
  ['🎉', 'Party popper', 'celebrate birthday confetti'],
  ['🐱', 'Cat face', 'kitten pet animal'],
  ['🍕', 'Pizza', 'food cheese slice'],
];

export const POPULAR_EMOJI_ENTRIES: readonly EmojiSearchEntry[] = POPULAR.map(
  ([emoji, name, keywords]) => ({ emoji, name, keywords }),
);

/** Requested only by a search or collection-expansion interaction. */
export const loadEmojiSearchEntries = (): Promise<readonly EmojiSearchEntry[]> =>
  import('./emojiSearchCorpus').then((corpus) => corpus.EMOJI_SEARCH_ENTRIES);

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[-_]/g, ' ').trim();

export function describeEmoji(
  emoji: string,
  entries: readonly EmojiSearchEntry[] = POPULAR_EMOJI_ENTRIES,
): EmojiSearchEntry {
  const codepoint = toCodepoint(emoji);
  return entries.find((entry) => toCodepoint(entry.emoji) === codepoint)
    ?? { emoji, name: 'Pasted emoji', keywords: '' };
}

/** Search text never becomes an emoji merely because its first character is one. */
export function searchEmoji(
  query: string,
  entries: readonly EmojiSearchEntry[] = POPULAR_EMOJI_ENTRIES,
): readonly EmojiSearchEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return entries;
  const grapheme = firstGrapheme(trimmed);
  if (grapheme === trimmed
    && /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(trimmed)) {
    return [describeEmoji(trimmed, entries)];
  }
  const words = normalize(trimmed).split(/\s+/);
  return entries
    .filter((entry) => words.every((word) => normalize(`${entry.name} ${entry.keywords}`).includes(word)))
    .sort((left, right) => Number(normalize(right.name) === normalize(trimmed))
      - Number(normalize(left.name) === normalize(trimmed)));
}

export function compactEmojiCollection(
  recents: readonly string[],
  entries: readonly EmojiSearchEntry[] = POPULAR_EMOJI_ENTRIES,
): readonly EmojiSearchEntry[] {
  const seen = new Set<string>();
  return [...recents.slice(0, 6), ...POPULAR_EMOJI_ENTRIES.map((entry) => entry.emoji)].flatMap((emoji) => {
    const codepoint = toCodepoint(emoji);
    if (seen.has(codepoint)) return [];
    seen.add(codepoint);
    return [describeEmoji(emoji, entries)];
  }).slice(0, 18);
}
