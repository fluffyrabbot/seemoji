import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI_LAYER } from './design';
import { createEmojiStyle, EMOJI_STYLE_CAPACITY, type EmojiStyle } from './emojiStyle';
import { decodeEmojiStyleArchive, EMOJI_STYLE_ARCHIVE_MAX_BYTES, parseEmojiStyleArchive, planEmojiStyleImport, serializeEmojiStyleArchive, type EmojiStyleArchive } from './emojiStyleArchive';

const style = (id: number, name = `Look ${id}`): EmojiStyle => {
  const decoded = createEmojiStyle(`source-${id}`, name, 100 + id, DEFAULT_EMOJI_LAYER);
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.value;
};
const archive = (styles: readonly EmojiStyle[] = [style(1)]): EmojiStyleArchive => ({
  format: 'seemoji-styles', version: 1, exportedAt: 123, styles, omissions: [],
});

describe('portable style archive', () => {
  it('round-trips reusable looks and explicit omissions with a versioned envelope', () => {
    const original = { ...archive(), omissions: [{ id: 'broken', error: 'Unreadable format' }] };
    const encoded = serializeEmojiStyleArchive(original);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(parseEmojiStyleArchive(encoded.value)).toEqual({ ok: true, value: original });
    expect(encoded.value).not.toContain('nameKey');
    expect(encoded.value).not.toContain('source.grapheme');
  });

  it('rejects malformed JSON, unsupported formats, byte overflow and oversized collections', () => {
    expect(parseEmojiStyleArchive('{')).toMatchObject({ ok: false, error: expect.stringContaining('JSON') });
    expect(parseEmojiStyleArchive(JSON.stringify({ ...archive(), version: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining('version') });
    expect(parseEmojiStyleArchive(JSON.stringify({ ...archive(), format: 'project' }))).toMatchObject({ ok: false, error: expect.stringContaining('not a seemoji') });
    expect(parseEmojiStyleArchive(' '.repeat(EMOJI_STYLE_ARCHIVE_MAX_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringContaining('256 KiB') });
    expect(parseEmojiStyleArchive('😀'.repeat(EMOJI_STYLE_ARCHIVE_MAX_BYTES / 3))).toMatchObject({ ok: false, error: expect.stringContaining('256 KiB') });
    expect(decodeEmojiStyleArchive(archive(Array.from({ length: 65 }, (_, id) => style(id))))).toMatchObject({ ok: false });
  });

  it('rejects an entire archive for an invalid later style or duplicate identity', () => {
    expect(decodeEmojiStyleArchive({ ...archive([style(1), style(2)]), styles: [style(1), { ...style(2), transform: { ...style(2).transform, rotate: 900 } }] }))
      .toMatchObject({ ok: false, error: expect.stringContaining('Style 2') });
    expect(decodeEmojiStyleArchive(archive([style(1), style(1, 'Different name')]))).toMatchObject({ ok: false, error: expect.stringContaining('duplicate identities') });
    expect(decodeEmojiStyleArchive({ ...archive(), omissions: [{ id: 'x'.repeat(101), error: 'bad' }] })).toMatchObject({ ok: false });
  });

  it('previews deterministic Keep both names across existing and incoming duplicates', () => {
    const existing = [style(10, 'Mint'), style(11, 'Mint (2)')];
    const planned = planEmojiStyleImport(archive([style(1, 'Mint'), style(2, 'Mint')]), existing, 'keep-both');
    expect(planned).toMatchObject({ ok: true, value: { importCount: 2, renamedCount: 2, skippedCount: 0,
      entries: [{ originalName: 'Mint', name: 'Mint (3)', action: 'import' }, { originalName: 'Mint', name: 'Mint (4)', action: 'import' }],
    } });
    expect(existing.map(({ name }) => name)).toEqual(['Mint', 'Mint (2)']);
  });

  it('resolves Unicode-equivalent names and safely truncates a long duplicate name for a suffix', () => {
    const plan = planEmojiStyleImport(archive([style(1, ' ＭＩＮＴ '), style(2, 'Other'), style(3, 'other')]), [style(10, 'mint')], 'skip-matching');
    expect(plan).toMatchObject({ ok: true, value: { importCount: 1, skippedCount: 2, renamedCount: 0 } });
    const long = 'a'.repeat(48);
    expect(planEmojiStyleImport(archive([style(1, long)]), [style(10, long)], 'keep-both'))
      .toMatchObject({ ok: true, value: { entries: [{ name: `${'a'.repeat(44)} (2)` }] } });
  });

  it('checks resulting capacity after the chosen resolution policy', () => {
    const full = Array.from({ length: EMOJI_STYLE_CAPACITY }, (_, id) => style(100 + id));
    const incoming = archive([style(1, full[0]!.name)]);
    expect(planEmojiStyleImport(incoming, full, 'keep-both')).toMatchObject({ ok: false, error: expect.stringContaining('exceed 64') });
    expect(planEmojiStyleImport(incoming, full, 'skip-matching')).toMatchObject({ ok: true, value: { importCount: 0, skippedCount: 1 } });
  });
});
