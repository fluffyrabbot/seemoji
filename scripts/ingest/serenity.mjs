import { SERENITY_LICENSE } from './canonical.mjs';
import { canonicalSequence, ingestFlatPack } from './flat-pack.mjs';

await ingestFlatPack({
  id: 'serenity',
  name: 'SerenityOS Emoji',
  format: 'png',
  assetDirectory: 'Base/res/emoji',
  minimumGlyphs: 2_000,
  maxAssetBytes: 65_536,
  unicodeLevel: '17.0',
  license: SERENITY_LICENSE,
  codepointFor: (filename) => {
    const stem = filename.slice(0, -'.png'.length);
    if (!/^U\+[0-9a-f]+(?:_U\+[0-9a-f]+)*$/i.test(stem)) return null;
    return canonicalSequence(stem.split('_').map((part) => part.slice(2)));
  },
});
