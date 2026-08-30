import { EMOJITWO_LICENSE } from './canonical.mjs';
import { canonicalSequence, ingestFlatPack } from './flat-pack.mjs';

await ingestFlatPack({
  id: 'emojitwo',
  name: 'EmojiTwo',
  format: 'svg',
  assetDirectory: 'assets/svg',
  minimumGlyphs: 1_800,
  maxAssetBytes: 65_536,
  unicodeLevel: '9.0',
  license: EMOJITWO_LICENSE,
  codepointFor: (filename) => {
    const stem = filename.slice(0, -'.svg'.length);
    return /^[0-9a-f]+(?:-[0-9a-f]+)*$/i.test(stem)
      ? canonicalSequence(stem.split('-'))
      : null;
  },
});
