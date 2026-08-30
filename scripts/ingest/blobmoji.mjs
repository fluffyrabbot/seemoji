import { BLOBMOJI_LICENSE } from './canonical.mjs';
import { canonicalSequence, ingestFlatPack } from './flat-pack.mjs';

await ingestFlatPack({
  id: 'blobmoji',
  name: 'Blobmoji',
  format: 'svg',
  assetDirectory: 'svg',
  minimumGlyphs: 2_500,
  maxAssetBytes: 524_288,
  unicodeLevel: '13.1',
  license: BLOBMOJI_LICENSE,
  codepointFor: (filename) => {
    const match = /^emoji_u([0-9a-f]+(?:_[0-9a-f]+)*)\.svg$/i.exec(filename);
    return match ? canonicalSequence(match[1].split('_')) : null;
  },
});
